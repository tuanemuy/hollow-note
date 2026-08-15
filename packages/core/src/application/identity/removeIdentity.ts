import { IdentityEvents } from "@repo/core/domain/identity/events";
import type { Identity } from "@repo/core/domain/identity/identity";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import { IdentityId, UserId } from "@repo/core/domain/identity/valueObject";
import { ConflictError, NotFoundError } from "../errors";
import type { ServiceArgs } from "../types";
import { providerAccountKey } from "./uniqueness";
import type { RemoveIdentityView } from "./view";

export type RemoveIdentityInput = Readonly<{
  userId: string;
  identityId: string;
}>;

/** How long the removal receipt outlives the identity row it replaced. */
export const IDENTITY_REMOVAL_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Operation id of one removal.
 *
 * Composed rather than hashed (the spec writes
 * `sha256("removeIdentity:" + identityId)`), for the same reason as
 * `reservationOperationId`: the components are unambiguous — a fixed
 * prefix and an id that cannot contain `:` — so composition already gives
 * determinism, and it keeps a hash implementation out of the application
 * layer. Determinism is what makes a re-sent removal reach the same
 * receipt and the same directory release.
 */
export const removalOperationId = (identityId: string): string =>
  `removeIdentity:${identityId}`;

const identityNotFound = (): NotFoundError =>
  new NotFoundError("IDENTITY_NOT_FOUND", "Identity not found");

/** Directory key the reservation-release consumer will free, fixed while
 * the row still exists — it cannot be rebuilt from a deleted identity. */
const directoryKeyOf = (identity: Identity): string | null =>
  identity.kind === "oauth"
    ? providerAccountKey(identity.provider, identity.providerAccountId)
    : null;

/**
 * Removes one authentication method (UC-identity-015,
 * spec/usecases/identity.md#removeidentity).
 *
 * The row deletion, the 30-day receipt and the
 * `identity.identity.removed` event commit together. That is what makes
 * the receipt the sole evidence the removal happened: it outlives the
 * identity, so a re-sent removal answers "already removed" from it
 * instead of `IDENTITY_NOT_FOUND`, and the global consumer reads the
 * `providerAccountKey` off it to free a directory claim whose owning row
 * is gone.
 *
 * Ownership, the last-method rule and the version token are all resolved
 * inside the transaction, so two concurrent removals of a two-method
 * account cannot both pass — the loser sees a single remaining method.
 */
export async function removeIdentity({
  container,
  input,
}: ServiceArgs<RemoveIdentityInput>): Promise<RemoveIdentityView> {
  const { clock, globalUnitOfWorkProvider } = container;
  const userId = UserId.create(input.userId);
  const identityId = IdentityId.create(input.identityId);
  const operationId = removalOperationId(identityId);
  const now = clock.now();

  await globalUnitOfWorkProvider.run(async (ctx) => {
    const identities = await ctx.identityRepository.listByUserId(userId);
    const target = identities.find((identity) => identity.id === identityId);
    if (target === undefined) {
      const receipt =
        await ctx.identityRemovalReceiptStore.findByIdentityId(identityId);
      if (receipt !== null && receipt.userId === userId) {
        // The removal already committed; this is its lost response being
        // retried, and the receipt answers it.
        return;
      }
      // Someone else's identity is indistinguishable from a missing one.
      throw identityNotFound();
    }
    IdentityPolicy.ensureRemovable(identities, identityId);

    const versioned = await ctx.identityRepository.findById(identityId);
    if (versioned === null) {
      // Unreachable under snapshot isolation: the row was listed in this
      // very transaction. Surfaced as a conflict so a backend with weaker
      // isolation retries instead of dropping the removal silently.
      throw new ConflictError(
        "OPTIMISTIC_LOCK_FAILURE",
        "The identity changed during the removal",
      );
    }
    const directoryKey = directoryKeyOf(target);
    await ctx.identityRepository.delete(identityId, versioned.expectedVersion);
    await ctx.identityRemovalReceiptStore.record({
      operationId,
      identityId,
      userId,
      kind: target.kind,
      providerAccountKey: directoryKey,
      expiresAt: new Date(now.getTime() + IDENTITY_REMOVAL_RECEIPT_TTL_MS),
    });
    ctx.collectEvents([
      IdentityEvents.identityRemoved(
        {
          identityId,
          userId,
          kind: target.kind,
          providerAccountKey: directoryKey,
          operationId,
        },
        now,
      ),
    ]);
  });

  return {};
}
