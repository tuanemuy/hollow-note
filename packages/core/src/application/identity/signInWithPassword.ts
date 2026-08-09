import { BusinessRuleError } from "@repo/core/domain/error";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import {
  type LoginAttempt,
  LoginThrottlePolicy,
  type ThrottleDecision,
} from "@repo/core/domain/identity/services/loginThrottlePolicy";
import { Session } from "@repo/core/domain/identity/session";
import {
  Email,
  LoginAttemptKey,
  PlainPassword,
} from "@repo/core/domain/identity/valueObject";
import type { RequestContainer } from "../di/types";
import { ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import type { SignInView } from "./view";

export type SignInWithPasswordInput = Readonly<{
  email: string;
  password: string;
  /** Client origin material for the throttle key (IP-derived). */
  clientKey: string;
}>;

const invalidCredentials = (): ValidationError =>
  new ValidationError("INVALID_CREDENTIALS", "Invalid email or password");

const throttled = (waitMs: number): ValidationError =>
  new ValidationError(
    "THROTTLED",
    "Too many failed attempts; wait before retrying",
    { waitSeconds: [String(Math.ceil(waitMs / 1000))] },
  );

const locked = (until: Date): ValidationError =>
  new ValidationError("LOCKED", "Too many failed attempts; sign-in is locked", {
    unlockAt: [until.toISOString()],
  });

const rejectionFor = (decision: ThrottleDecision): ValidationError | null => {
  switch (decision.kind) {
    case "delay":
      return throttled(decision.waitMs);
    case "locked":
      return locked(decision.until);
    case "allow":
      return null;
  }
};

/**
 * Authenticates by email + password and issues a session
 * (UC-identity-004, spec/usecases/identity.md#signinwithpassword).
 *
 * Throttle choreography: `get` → `evaluate` (delay / locked reject
 * before any credential check) → on failure the atomic `recordFailure`
 * whose post-increment record is re-evaluated to upgrade the response
 * to THROTTLED / LOCKED. `login_attempts` writes never join a unit of
 * work, and a failed write is logged without changing the auth verdict.
 * The wait seconds / unlock time ride on the `fieldErrors` payload
 * (`waitSeconds` / `unlockAt`) of the thrown `ValidationError`.
 */
export async function signInWithPassword({
  container,
  input,
}: ServiceArgs<SignInWithPasswordInput>): Promise<SignInView> {
  const {
    clock,
    idGenerator,
    loginAttemptStore,
    identityUniqueDirectory,
    userReader,
    identityReader,
    passwordHasher,
    secureTokenGenerator,
    globalUnitOfWorkProvider,
  } = container;

  const email = Email.create(input.email);
  const key = LoginAttemptKey.forSignIn(email, input.clientKey);
  const now = clock.now();

  const attempt =
    (await loginAttemptStore.get(key)) ?? LoginThrottlePolicy.initial(key);
  const gate = rejectionFor(LoginThrottlePolicy.evaluate(attempt, now));
  if (gate !== null) {
    throw gate;
  }

  const userId = await identityUniqueDirectory.resolve("email", email);
  const versioned = userId !== null ? await userReader.findById(userId) : null;
  const user = versioned?.entity ?? null;

  const verified = await (async (): Promise<boolean> => {
    if (user === null || user.status === "deleted") {
      return false;
    }
    const identities = await identityReader.listByUserId(user.id);
    const passwordIdentity = IdentityPolicy.findPassword(identities);
    if (passwordIdentity === null) {
      return false;
    }
    // Sign-in must not surface WeakPassword: an input that fails the
    // password rules can never match a stored hash, so it collapses to
    // the common INVALID_CREDENTIALS path (and is counted as a failure).
    let plain: PlainPassword;
    try {
      plain = PlainPassword.create(input.password);
    } catch (error) {
      if (error instanceof BusinessRuleError) {
        return false;
      }
      throw error;
    }
    return passwordHasher.verify(plain, passwordIdentity.passwordHash);
  })();

  if (!verified) {
    throw await recordAndClassifyFailure(container, key, now);
  }
  // `user` is non-null here — a missing user cannot verify.
  if (user === null) {
    throw invalidCredentials();
  }
  if (user.status === "pending") {
    // Not recorded: the credentials are correct and a resend fixes it.
    throw new ValidationError("EMAIL_NOT_VERIFIED", "Email is not verified");
  }
  if (user.status === "deleting") {
    throw new ValidationError("ACCOUNT_DELETING", "Account is being deleted");
  }

  try {
    await loginAttemptStore.clear(key);
  } catch (cause) {
    container.logger.error("[signInWithPassword] clear failed", { cause });
  }

  const session = secureTokenGenerator.issueForUser(user.id);
  await globalUnitOfWorkProvider.run(async (ctx) => {
    // Credential issuance is serialized against deletion start: re-read
    // status + epoch inside the final UoW and only insert for an
    // ActiveUser under the current epoch (spec/usecases/identity.md
    // 認証資格発行と削除開始の直列化).
    const fresh = await ctx.userRepository.findById(user.id);
    if (fresh === null || fresh.entity.status !== "active") {
      throw fresh !== null && fresh.entity.status === "deleting"
        ? new ValidationError("ACCOUNT_DELETING", "Account is being deleted")
        : invalidCredentials();
    }
    await ctx.sessionRepository.insert(
      Session.create(
        {
          id: idGenerator.next(),
          userId: fresh.entity.id,
          tokenHash: session.hash,
          authEpoch: fresh.entity.authEpoch,
        },
        now,
      ),
    );
  });

  return { userId: user.id, sessionToken: session.token };
}

async function recordAndClassifyFailure(
  container: RequestContainer,
  key: LoginAttemptKey,
  now: Date,
): Promise<ValidationError> {
  let recorded: LoginAttempt | null = null;
  try {
    recorded = await container.loginAttemptStore.recordFailure(
      key,
      now,
      LoginThrottlePolicy.attemptTtlMs,
    );
  } catch (cause) {
    container.logger.error("[signInWithPassword] recordFailure failed", {
      cause,
    });
  }
  if (recorded !== null) {
    const next = rejectionFor(LoginThrottlePolicy.evaluate(recorded, now));
    if (next !== null) {
      return next;
    }
  }
  return invalidCredentials();
}
