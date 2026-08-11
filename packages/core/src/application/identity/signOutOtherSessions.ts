import { Session } from "@repo/core/domain/identity/session";
import { User } from "@repo/core/domain/identity/user";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import { IdentityContinuations } from "./continuations";
import type { SignOutOtherSessionsView } from "./view";

export type SignOutOtherSessionsInput = Readonly<{
  userId: string;
  currentSessionToken: string;
}>;

const unauthenticated = (): ValidationError =>
  new ValidationError("UNAUTHENTICATED", "Not authenticated");

/**
 * Revokes every session but this one (UC-identity-010,
 * spec/usecases/identity.md#signoutothersessions).
 *
 * Two rows are written whether the account holds two sessions or ten
 * thousand: the `authEpoch` bump invalidates every session at once, and
 * the single `refreshAuthEpoch` carries this device into the new
 * generation. The answer is therefore `revocationAccepted`, not a count —
 * the physical rows are still there and are reclaimed out of band by the
 * `authResidueCleanup` consumer, whose first continuation is enqueued in
 * this same transaction.
 */
export async function signOutOtherSessions({
  container,
  input,
}: ServiceArgs<SignOutOtherSessionsInput>): Promise<SignOutOtherSessionsView> {
  const {
    clock,
    secureTokenGenerator,
    sessionReader,
    globalUnitOfWorkProvider,
  } = container;

  const userId = UserId.create(input.userId);
  const locatedUserId = secureTokenGenerator.locateUser(
    input.currentSessionToken,
  );
  if (locatedUserId === null || locatedUserId !== userId) {
    throw unauthenticated();
  }
  const now = clock.now();
  const session = await sessionReader.findByTokenHash(
    userId,
    secureTokenGenerator.hashOf(input.currentSessionToken),
  );
  if (session === null || Session.isExpired(session, now)) {
    throw unauthenticated();
  }

  await globalUnitOfWorkProvider.run(async (ctx) => {
    const fresh = await ctx.userRepository.findById(userId);
    if (fresh === null || fresh.entity.status !== "active") {
      throw unauthenticated();
    }
    const active = fresh.entity;
    if (active.authEpoch !== session.authEpoch) {
      throw unauthenticated();
    }

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

  return { revocationAccepted: true };
}
