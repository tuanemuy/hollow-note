import { AuthToken } from "@repo/core/domain/identity/authToken";
import { Identity } from "@repo/core/domain/identity/identity";
import { User } from "@repo/core/domain/identity/user";
import {
  DisplayName,
  Email,
  PlainPassword,
  type UserId,
} from "@repo/core/domain/identity/valueObject";
import type { RequestContainer } from "../di/types";
import { isConflictError, ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import type { SignUpView } from "./view";

export type SignUpWithPasswordInput = Readonly<{
  email: string;
  password: string;
  displayName: string;
  termsAccepted: boolean;
  /**
   * Accepted but ignored until the Workspace slice: an invalid / expired
   * invitation is spec'd to fall back to a normal sign-up rather than
   * fail, so ignoring every token is a safe degradation.
   */
  invitationToken?: string | null;
}>;

/** TTL of the email uniqueness reservation while the sign-up UoW runs. */
const EMAIL_RESERVATION_TTL_MS = 10 * 60 * 1000;

/** Conflict code of `IdentityUniqueDirectory` for the `email` kind. */
const EMAIL_CONFLICT_CODE = "EMAIL_ALREADY_USED";

/**
 * The response every already-claimed address gets: an
 * `existingAccountNotice` mail and a decoy id, byte-identical in shape
 * to a fresh registration. Mail failures are logged only — surfacing
 * them would put the branch back on the wire.
 */
async function existingAccountResponse(
  container: RequestContainer,
  email: string,
): Promise<SignUpView> {
  const { mailSender, config, idGenerator, logger } = container;
  try {
    await mailSender.send({
      to: email,
      template: {
        kind: "existingAccountNotice",
        signInUrl: `${config.appUrl}/signin`,
      },
      locale: "ja",
    });
  } catch (cause) {
    logger.error("[signUpWithPassword] existing-account notice failed", {
      cause,
    });
  }
  return {
    userId: idGenerator.next(),
    emailVerificationRequired: true,
    sessionToken: null,
  };
}

/**
 * Registers a new user with email + password and sends the verification
 * mail (UC-identity-001, spec/usecases/identity.md#signupwithpassword).
 *
 * Already-registered addresses are indistinguishable from fresh ones in
 * the response: no user is created, an `existingAccountNotice` mail is
 * sent instead, and the returned `userId` is a decoy id minted for shape
 * parity only. Both the body and the cost are equalized — the password
 * is hashed before the directory is consulted, and a `reserve` that
 * loses the uniqueness race answers with the same notice rather than a
 * conflict.
 *
 * Persistence choreography: `reserve` the email key → global UoW
 * (User + PasswordIdentity + email-verification AuthToken under the
 * fresh status/epoch) → `activate` after commit. A failed commit
 * releases the reservation; a lost `activate` response reconciles by
 * re-reading the user and re-issuing the same operation's
 * `activate` / `release`. Mail delivery failures are logged and never
 * fail the registration.
 */
export async function signUpWithPassword({
  container,
  input,
}: ServiceArgs<SignUpWithPasswordInput>): Promise<SignUpView> {
  const {
    clock,
    idGenerator,
    logger,
    config,
    identityUniqueDirectory,
    passwordHasher,
    secureTokenGenerator,
    globalUnitOfWorkProvider,
    mailSender,
  } = container;

  if (!input.termsAccepted) {
    throw new ValidationError(
      "TERMS_NOT_ACCEPTED",
      "The terms of service must be accepted",
    );
  }
  const email = Email.create(input.email);
  const password = PlainPassword.create(input.password);
  DisplayName.create(input.displayName);

  // Hashed before the directory lookup so both branches pay the same
  // scrypt cost. Sign-up carries no throttle, so a hash that ran only on
  // the fresh-email path would make response time a cheap registration
  // oracle — the very thing the uniform body below exists to prevent.
  const passwordHash = await passwordHasher.hash(password);

  const existingUserId = await identityUniqueDirectory.resolve("email", email);
  if (existingUserId !== null) {
    return existingAccountResponse(container, email);
  }

  const now = clock.now();
  const operationId = idGenerator.next();

  const created = User.create(
    { id: idGenerator.next(), email, displayName: input.displayName },
    now,
  );
  const user = created.entity;

  try {
    await identityUniqueDirectory.reserve({
      kind: "email",
      normalizedKey: email,
      userId: user.id,
      operationId,
      expiresAt: new Date(now.getTime() + EMAIL_RESERVATION_TTL_MS),
    });
  } catch (error) {
    // `resolve` deliberately ignores `reserved` rows, so the lookup
    // above misses both a concurrent sign-up and an orphaned
    // reservation left by a failed commit (up to EMAIL_RESERVATION_TTL_MS).
    // Letting the conflict through would answer 409 — with the
    // normalized address in its message — exactly where the response is
    // contracted to be indistinguishable, so it joins the notice path.
    if (isConflictError(error) && error.code === EMAIL_CONFLICT_CODE) {
      return existingAccountResponse(container, email);
    }
    throw error;
  }

  const verification = secureTokenGenerator.issueForUser(user.id);

  let tokenExpiresAt: Date;
  try {
    tokenExpiresAt = await globalUnitOfWorkProvider.run(async (ctx) => {
      await ctx.userRepository.insert(user);
      ctx.collectEvents(created.eventDrafts);

      const identity = Identity.createPassword(
        { id: idGenerator.next(), userId: user.id, passwordHash },
        now,
      );
      await ctx.identityRepository.insert(identity.entity);
      ctx.collectEvents(identity.eventDrafts);

      // Status/epoch re-check is trivially satisfied here — the pending
      // user is created in this very transaction — but the token still
      // records the epoch it was minted under.
      const token = AuthToken.issue(
        {
          id: idGenerator.next(),
          userId: user.id,
          purpose: "email_verification",
          tokenHash: verification.hash,
          authEpoch: user.authEpoch,
        },
        now,
      );
      await ctx.authTokenRepository.insert(token);
      return token.expiresAt;
    });
  } catch (error) {
    try {
      await identityUniqueDirectory.release(operationId);
    } catch (releaseError) {
      logger.error(
        "[signUpWithPassword] reservation release failed after commit failure",
        { cause: error, releaseError },
      );
    }
    throw error;
  }

  await activateWithReconciliation(container, {
    operationId,
    userId: user.id,
    email,
    committedVersion: user.version,
  });

  try {
    await mailSender.send({
      to: email,
      template: {
        kind: "emailVerification",
        verifyUrl: `${config.appUrl}/verify-email?token=${encodeURIComponent(verification.token)}`,
        expiresAt: tokenExpiresAt,
      },
      locale: "ja",
    });
  } catch (cause) {
    logger.error("[signUpWithPassword] verification mail failed", { cause });
  }

  return {
    userId: user.id,
    emailVerificationRequired: true,
    sessionToken: null,
  };
}

/**
 * Post-commit activation with lost-response reconciliation
 * (spec/usecases/identity.md#signupwithpassword 手順9): on a failed
 * `activate`, re-read the user — a matching email means the commit is
 * durable and the same sub-operation id converges the reservation to
 * `active`; a missing or mismatched user releases it instead.
 */
async function activateWithReconciliation(
  container: RequestContainer,
  params: Readonly<{
    operationId: string;
    userId: UserId;
    email: string;
    committedVersion: number;
  }>,
): Promise<void> {
  const { identityUniqueDirectory, userReader, logger } = container;
  try {
    await identityUniqueDirectory.activate(
      params.operationId,
      params.committedVersion,
    );
  } catch (cause) {
    logger.error("[signUpWithPassword] activate response lost; reconciling", {
      cause,
    });
    const current = await userReader.findById(params.userId);
    if (
      current !== null &&
      current.entity.status !== "deleted" &&
      current.entity.email === params.email
    ) {
      await identityUniqueDirectory.activate(
        params.operationId,
        current.entity.version,
      );
    } else {
      await identityUniqueDirectory.release(params.operationId);
    }
  }
}
