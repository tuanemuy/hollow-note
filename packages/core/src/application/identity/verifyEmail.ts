import { AuthToken } from "@repo/core/domain/identity/authToken";
import { Session } from "@repo/core/domain/identity/session";
import { User } from "@repo/core/domain/identity/user";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import { isConflictError, NotFoundError } from "../errors";
import type { ServiceArgs } from "../types";
import type { VerifyEmailView } from "./view";

export type VerifyEmailInput = Readonly<{
  token: string;
}>;

const tokenNotFound = (): NotFoundError =>
  new NotFoundError("AUTH_TOKEN_NOT_FOUND", "Verification token not found");

/**
 * Consumes an email-verification token, activates the user, and issues a
 * session (UC-identity-002, spec/usecases/identity.md#verifyemail).
 *
 * Single consumption rides on `AuthTokenRepository.save` being a
 * conditional update on the `pending` row: a concurrent request that
 * loses the race observes `ConflictError("AUTH_TOKEN_ALREADY_CONSUMED")`,
 * rolls the whole transaction (session included) back, and degrades to
 * the `alreadyVerified: true` response without a session.
 */
export async function verifyEmail({
  container,
  input,
}: ServiceArgs<VerifyEmailInput>): Promise<VerifyEmailView> {
  const {
    clock,
    idGenerator,
    secureTokenGenerator,
    authTokenReader,
    userReader,
    globalUnitOfWorkProvider,
  } = container;

  const userId = secureTokenGenerator.locateUser(input.token);
  if (userId === null) {
    throw tokenNotFound();
  }
  const tokenHash = secureTokenGenerator.hashOf(input.token);

  const token = await authTokenReader.findByTokenHash(userId, tokenHash);
  if (token === null || token.purpose !== "email_verification") {
    throw tokenNotFound();
  }
  if (token.status === "consumed") {
    return alreadyVerified(container, userId);
  }

  const versionedUser = await userReader.findById(userId);
  if (versionedUser === null || versionedUser.entity.status === "deleted") {
    throw new NotFoundError("USER_NOT_FOUND", "User not found");
  }
  if (token.authEpoch !== versionedUser.entity.authEpoch) {
    throw tokenNotFound();
  }

  const now = clock.now();
  // Throws BusinessRuleError(TokenExpired) past the 24h boundary.
  const consumed = AuthToken.consume(token, now);
  const session = secureTokenGenerator.issueForUser(userId);

  try {
    await globalUnitOfWorkProvider.run(async (ctx) => {
      const fresh = await ctx.userRepository.findById(userId);
      if (fresh === null || fresh.entity.status === "deleted") {
        throw new NotFoundError("USER_NOT_FOUND", "User not found");
      }
      if (consumed.authEpoch !== fresh.entity.authEpoch) {
        throw tokenNotFound();
      }
      let currentUser = fresh.entity;
      if (fresh.entity.status === "pending") {
        const verified = User.verifyEmail(fresh.entity, now);
        await ctx.userRepository.save(verified.entity, fresh.expectedVersion);
        ctx.collectEvents(verified.eventDrafts);
        currentUser = verified.entity;
      } else if (fresh.entity.status !== "active") {
        throw new NotFoundError("USER_NOT_FOUND", "User not found");
      }

      // Conditional update on the pending row — the single-consumption
      // gate. A concurrent winner makes this throw and roll everything
      // (the session insert included) back.
      await ctx.authTokenRepository.save(consumed);

      await ctx.sessionRepository.insert(
        Session.create(
          {
            id: idGenerator.next(),
            userId,
            tokenHash: session.hash,
            authEpoch: currentUser.authEpoch,
          },
          now,
        ),
      );
    });
  } catch (error) {
    if (
      isConflictError(error) &&
      error.code === "AUTH_TOKEN_ALREADY_CONSUMED"
    ) {
      return alreadyVerified(container, userId);
    }
    throw error;
  }

  return { userId, sessionToken: session.token, alreadyVerified: false };
}

async function alreadyVerified(
  container: ServiceArgs<never>["container"],
  userId: UserId,
): Promise<VerifyEmailView> {
  const versioned = await container.userReader.findById(userId);
  if (versioned === null || versioned.entity.status !== "active") {
    throw new NotFoundError("USER_NOT_FOUND", "User not found");
  }
  return { userId, sessionToken: null, alreadyVerified: true };
}
