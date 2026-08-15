import { BusinessRuleError } from "@repo/core/domain/error";
import { Identity } from "@repo/core/domain/identity/identity";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import { Session } from "@repo/core/domain/identity/session";
import { User } from "@repo/core/domain/identity/user";
import { PlainPassword, UserId } from "@repo/core/domain/identity/valueObject";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import { IdentityContinuations } from "./continuations";
import type { ChangePasswordView } from "./view";

export type ChangePasswordInput = Readonly<{
  userId: string;
  currentPassword: string;
  newPassword: string;
  currentSessionToken: string;
}>;

const unauthenticated = (): ValidationError =>
  new ValidationError("UNAUTHENTICATED", "Not authenticated");

const invalidCredentials = (): ValidationError =>
  new ValidationError("INVALID_CREDENTIALS", "Current password is incorrect");

/**
 * Replaces the password and drops every other session (UC-identity-013,
 * spec/usecases/identity.md#changepassword).
 *
 * Revocation is the `authEpoch` bump, so it costs the same for one
 * session as for ten thousand; what makes this device survive is the
 * single `refreshAuthEpoch` on the current row, committed in the same
 * transaction. The physical rows of the previous generation are reclaimed
 * by the `authResidueCleanup` consumer, whose first continuation is
 * enqueued here so a crash right after the commit still leaves the work
 * scheduled.
 *
 * The identity version observed while verifying the current password is
 * re-checked inside the transaction: a password change that committed in
 * between makes this one a stale write, answered as
 * `OPTIMISTIC_LOCK_FAILURE` rather than silently overwriting it.
 */
export async function changePassword({
  container,
  input,
}: ServiceArgs<ChangePasswordInput>): Promise<ChangePasswordView> {
  const {
    clock,
    identityReader,
    sessionReader,
    userReader,
    passwordHasher,
    secureTokenGenerator,
    globalUnitOfWorkProvider,
  } = container;

  const userId = UserId.create(input.userId);
  const identities = await identityReader.listByUserId(userId);
  const passwordIdentity = IdentityPolicy.findPassword(identities);
  if (passwordIdentity === null) {
    throw new NotFoundError(
      "PASSWORD_IDENTITY_NOT_FOUND",
      "No password identity for this user",
    );
  }

  const now = clock.now();
  const locatedUserId = secureTokenGenerator.locateUser(
    input.currentSessionToken,
  );
  if (locatedUserId === null || locatedUserId !== userId) {
    throw unauthenticated();
  }
  const session = await sessionReader.findByTokenHash(
    userId,
    secureTokenGenerator.hashOf(input.currentSessionToken),
  );
  if (session === null || Session.isExpired(session, now)) {
    throw unauthenticated();
  }
  const versionedUser = await userReader.findById(userId);
  if (
    versionedUser === null ||
    versionedUser.entity.status !== "active" ||
    versionedUser.entity.authEpoch !== session.authEpoch
  ) {
    throw unauthenticated();
  }

  // A current password that cannot even be a valid password can never
  // match the stored hash, so it collapses to the credential rejection
  // instead of surfacing WeakPassword for the *old* value.
  let currentPassword: PlainPassword;
  try {
    currentPassword = PlainPassword.create(input.currentPassword);
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      throw invalidCredentials();
    }
    throw error;
  }
  const matches = await passwordHasher.verify(
    currentPassword,
    passwordIdentity.passwordHash,
  );
  if (!matches) {
    throw invalidCredentials();
  }

  const newPassword = PlainPassword.create(input.newPassword);
  const passwordHash = await passwordHasher.hash(newPassword);

  await globalUnitOfWorkProvider.run(async (ctx) => {
    const fresh = await ctx.userRepository.findById(userId);
    if (fresh === null || fresh.entity.status !== "active") {
      throw unauthenticated();
    }
    const active = fresh.entity;
    if (active.authEpoch !== session.authEpoch) {
      throw unauthenticated();
    }

    const versionedIdentity = await ctx.identityRepository.findById(
      passwordIdentity.id,
    );
    if (
      versionedIdentity === null ||
      versionedIdentity.entity.kind !== "password" ||
      versionedIdentity.entity.version !== passwordIdentity.version
    ) {
      throw new ConflictError(
        "OPTIMISTIC_LOCK_FAILURE",
        "The password identity changed during the update",
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

    const bumped = User.advanceAuthEpoch(active, now);
    await ctx.userRepository.save(bumped, fresh.expectedVersion);
    await ctx.sessionRepository.refreshAuthEpoch(
      session.id,
      userId,
      bumped.authEpoch,
    );

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

  return {};
}
