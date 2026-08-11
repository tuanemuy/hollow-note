import { AuthToken } from "@repo/core/domain/identity/authToken";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import { Email } from "@repo/core/domain/identity/valueObject";
import type { ServiceArgs } from "../types";
import type { RequestPasswordResetView } from "./view";

export type RequestPasswordResetInput = Readonly<{
  email: string;
}>;

/** Minimum spacing between two reset mails for one user. */
const REQUEST_INTERVAL_MS = 60 * 1000;

const UNIFORM_RESPONSE: RequestPasswordResetView = {};

/**
 * Issues a password-reset token and mails it
 * (UC-identity-011, spec/usecases/identity.md#requestpasswordreset).
 *
 * Every state of the address resolves to the same empty success: unknown,
 * pending, deleting, and throttled send nothing, an account without a
 * password identity gets the `passwordResetUnavailable` guidance instead,
 * and only an active user with a password identity gets a reset link. The
 * response never reveals which branch ran
 * (spec/adr/028-account-enumeration-resistance.md).
 *
 * Issuing runs in the UserId shard transaction so the status/epoch
 * re-check, the interval read, the removal of the superseded token, and
 * the new one land together: the partial unique index over (`user_id`,
 * `purpose`) permits exactly one live reset token, and splitting these
 * would let a concurrent request leave two.
 */
export async function requestPasswordReset({
  container,
  input,
}: ServiceArgs<RequestPasswordResetInput>): Promise<RequestPasswordResetView> {
  const {
    clock,
    idGenerator,
    logger,
    config,
    identityUniqueDirectory,
    identityReader,
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
  if (versioned === null || versioned.entity.status !== "active") {
    return UNIFORM_RESPONSE;
  }

  const identities = await identityReader.listByUserId(userId);
  if (IdentityPolicy.findPassword(identities) === null) {
    try {
      await mailSender.send({
        to: email,
        template: {
          kind: "passwordResetUnavailable",
          signInUrl: `${config.appUrl}/signin`,
        },
        locale: "ja",
      });
    } catch (cause) {
      logger.error("[requestPasswordReset] unavailable notice failed", {
        cause,
      });
    }
    return UNIFORM_RESPONSE;
  }

  const now = clock.now();
  const reset = secureTokenGenerator.issueForUser(userId);

  const expiresAt = await globalUnitOfWorkProvider.run(async (ctx) => {
    const fresh = await ctx.userRepository.findById(userId);
    if (fresh === null || fresh.entity.status !== "active") {
      return null;
    }
    const live = await ctx.authTokenRepository.findPendingByUserAndPurpose(
      userId,
      "password_reset",
    );
    if (
      live !== null &&
      now.getTime() - live.createdAt.getTime() < REQUEST_INTERVAL_MS
    ) {
      return null;
    }
    await ctx.authTokenRepository.deleteByUserAndPurpose(
      userId,
      "password_reset",
      1,
    );
    const token = AuthToken.issue(
      {
        id: idGenerator.next(),
        userId,
        purpose: "password_reset",
        tokenHash: reset.hash,
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
        kind: "passwordReset",
        resetUrl: `${config.appUrl}/reset-password?token=${encodeURIComponent(reset.token)}`,
        expiresAt,
      },
      locale: "ja",
    });
  } catch (cause) {
    logger.error("[requestPasswordReset] reset mail failed", { cause });
  }

  return UNIFORM_RESPONSE;
}
