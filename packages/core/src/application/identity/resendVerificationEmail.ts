import { AuthToken } from "@repo/core/domain/identity/authToken";
import { Email } from "@repo/core/domain/identity/valueObject";
import type { ServiceArgs } from "../types";
import type { ResendVerificationEmailView } from "./view";

export type ResendVerificationEmailInput = Readonly<{
  email: string;
}>;

/** Minimum spacing between two verification mails for one user. */
const RESEND_INTERVAL_MS = 60 * 1000;

const UNIFORM_RESPONSE: ResendVerificationEmailView = {};

/**
 * Re-sends the email-verification mail
 * (UC-identity-003, spec/usecases/identity.md#resendverificationemail).
 *
 * Every state of the address — unregistered, already active, pending but
 * throttled, pending and mailed — resolves to the same empty success.
 * The only branch is whether a mail leaves, so the response can never be
 * read as an account oracle (spec/adr/028-account-enumeration-resistance.md).
 *
 * Issuing runs in the UserId shard transaction so the pending-status
 * re-check, the resend-interval read, the removal of the superseded
 * token, and the new one land together: keeping exactly one live
 * verification token per (`user_id`, `purpose`) is this path's own duty
 * — `AuthTokenRepository` permits several pending rows and no
 * storage-level uniqueness catches a slip — so splitting these would let
 * a concurrent resend leave two.
 */
export async function resendVerificationEmail({
  container,
  input,
}: ServiceArgs<ResendVerificationEmailInput>): Promise<ResendVerificationEmailView> {
  const {
    clock,
    idGenerator,
    logger,
    config,
    identityUniqueDirectory,
    secureTokenGenerator,
    globalUnitOfWorkProvider,
    userReader,
    mailSender,
  } = container;

  const email = Email.create(input.email);

  const userId = await identityUniqueDirectory.resolve("email", email);
  if (userId === null) {
    return UNIFORM_RESPONSE;
  }
  const versioned = await userReader.findById(userId);
  if (versioned === null || versioned.entity.status !== "pending") {
    return UNIFORM_RESPONSE;
  }

  const now = clock.now();
  const verification = secureTokenGenerator.issueForUser(userId);

  const expiresAt = await globalUnitOfWorkProvider.run(async (ctx) => {
    const fresh = await ctx.userRepository.findById(userId);
    if (fresh === null || fresh.entity.status !== "pending") {
      return null;
    }
    const live = await ctx.authTokenRepository.findPendingByUserAndPurpose(
      userId,
      "email_verification",
    );
    if (
      live !== null &&
      now.getTime() - live.createdAt.getTime() < RESEND_INTERVAL_MS
    ) {
      return null;
    }
    await ctx.authTokenRepository.deleteByUserAndPurpose(
      userId,
      "email_verification",
      1,
    );
    const token = AuthToken.issue(
      {
        id: idGenerator.next(),
        userId,
        purpose: "email_verification",
        tokenHash: verification.hash,
        authEpoch: fresh.entity.authEpoch,
      },
      now,
    );
    await ctx.authTokenRepository.insert(token);
    return token.expiresAt;
  });

  if (expiresAt === null) {
    return UNIFORM_RESPONSE;
  }

  try {
    await mailSender.send({
      to: email,
      template: {
        kind: "emailVerification",
        verifyUrl: `${config.appUrl}/verify-email?token=${encodeURIComponent(verification.token)}`,
        expiresAt,
      },
      locale: "ja",
    });
  } catch (cause) {
    logger.error("[resendVerificationEmail] verification mail failed", {
      cause,
    });
  }

  return UNIFORM_RESPONSE;
}
