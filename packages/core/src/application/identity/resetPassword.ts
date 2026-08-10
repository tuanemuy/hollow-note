import { AuthToken } from "@repo/core/domain/identity/authToken";
import { Identity } from "@repo/core/domain/identity/identity";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import { User } from "@repo/core/domain/identity/user";
import { PlainPassword } from "@repo/core/domain/identity/valueObject";
import { ConflictError, isConflictError, NotFoundError } from "../errors";
import type { ServiceArgs } from "../types";
import { IdentityContinuations } from "./continuations";
import type { ResetPasswordView } from "./view";

export type ResetPasswordInput = Readonly<{
  token: string;
  newPassword: string;
}>;

const tokenNotFound = (): NotFoundError =>
  new NotFoundError("AUTH_TOKEN_NOT_FOUND", "Password reset token not found");

/**
 * Consumes a password-reset token, replaces the password, and revokes
 * every session (UC-identity-012,
 * spec/usecases/identity.md#resetpassword).
 *
 * Revocation is the `authEpoch` bump alone: sessions minted under the
 * previous generation stop authenticating the moment this commits,
 * whether there is one of them or ten thousand. The physical rows are
 * reclaimed out of band by the `authResidueCleanup` consumer, whose first
 * continuation is enqueued in this same transaction so a crash right
 * after the commit still leaves the work scheduled.
 *
 * Every way of failing to reach a live token — wrong purpose, already
 * consumed, an epoch bumped since it was issued, a user that has left
 * `active` — collapses to `AUTH_TOKEN_NOT_FOUND`, including the loser of
 * a concurrent consume. Unlike `verifyEmail`, the loser cannot degrade to
 * a success: the two requests carry different passwords, so answering
 * "done" would claim a password that was never set.
 */
export async function resetPassword({
  container,
  input,
}: ServiceArgs<ResetPasswordInput>): Promise<ResetPasswordView> {
  const {
    clock,
    idGenerator,
    passwordHasher,
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
  if (
    token === null ||
    token.purpose !== "password_reset" ||
    token.status !== "pending"
  ) {
    throw tokenNotFound();
  }

  const versionedUser = await userReader.findById(userId);
  if (versionedUser === null || versionedUser.entity.status !== "active") {
    throw tokenNotFound();
  }
  if (token.authEpoch !== versionedUser.entity.authEpoch) {
    throw tokenNotFound();
  }

  const now = clock.now();
  // Throws BusinessRuleError(TokenExpired) past the 1h boundary. Nothing
  // is persisted until the transaction below, so a weak password rejected
  // on the next line leaves the stored token pending.
  const consumed = AuthToken.consume(token, now);
  const password = PlainPassword.create(input.newPassword);
  const passwordHash = await passwordHasher.hash(password);

  try {
    await globalUnitOfWorkProvider.run(async (ctx) => {
      const fresh = await ctx.userRepository.findById(userId);
      if (fresh === null || fresh.entity.status !== "active") {
        throw tokenNotFound();
      }
      const active = fresh.entity;
      if (consumed.authEpoch !== active.authEpoch) {
        throw tokenNotFound();
      }

      const identities = await ctx.identityRepository.listByUserId(userId);
      const existing = IdentityPolicy.findPassword(identities);
      if (existing === null) {
        const created = Identity.createPassword(
          { id: idGenerator.next(), userId, passwordHash },
          now,
        );
        await ctx.identityRepository.insert(created.entity);
        ctx.collectEvents(created.eventDrafts);
      } else {
        const versionedIdentity = await ctx.identityRepository.findById(
          existing.id,
        );
        if (
          versionedIdentity === null ||
          versionedIdentity.entity.kind !== "password"
        ) {
          // Unreachable under snapshot isolation: the row was listed in
          // this very transaction. Surfaced as a conflict so a backend
          // with weaker isolation retries instead of silently inserting
          // a second password identity.
          throw new ConflictError(
            "OPTIMISTIC_LOCK_FAILURE",
            "Password identity changed during the reset",
          );
        }
        const changed = Identity.changePassword(
          versionedIdentity.entity,
          passwordHash,
          now,
        );
        await ctx.identityRepository.save(
          changed.entity,
          versionedIdentity.expectedVersion,
        );
        ctx.collectEvents(changed.eventDrafts);
      }

      const bumped = User.advanceAuthEpoch(active, now);
      await ctx.userRepository.save(bumped, fresh.expectedVersion);

      // Conditional update on the pending row — the single-consumption
      // gate. A concurrent winner makes this throw and rolls the password
      // and the epoch bump back with it.
      await ctx.authTokenRepository.save(consumed);

      ctx.collectEvents([
        IdentityContinuations.userAuthResidueCleanup(
          {
            userId,
            authEpoch: bumped.authEpoch,
            table: "sessions",
            deletionOperationId: null,
          },
          now,
        ),
      ]);
    });
  } catch (error) {
    if (
      isConflictError(error) &&
      error.code === "AUTH_TOKEN_ALREADY_CONSUMED"
    ) {
      throw tokenNotFound();
    }
    throw error;
  }

  return { userId };
}
