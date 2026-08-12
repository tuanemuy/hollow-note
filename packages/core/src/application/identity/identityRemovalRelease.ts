import type { IdentityRemovedEvent } from "@repo/core/domain/identity/events";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkerContainer } from "../di/types";
import { providerAccountKey, releaseActiveUniqueKey } from "./uniqueness";

/**
 * Frees the provider-account claim of a removed OAuth identity
 * (spec/usecases/identity.md#removeidentity 手順 4).
 *
 * The key lives on the normalized-key shard and the identity on the
 * UserId shard, so the claim cannot be dropped in the transaction that
 * deleted the row. The receipt written by that transaction is what
 * bridges the two: its presence *is* the proof the authoritative row is
 * gone, and it carries the `providerAccountKey` that a deleted identity
 * can no longer supply. Confirming the row's absence as well keeps the
 * spec's "release only after the authoritative delete" honest on a
 * backend whose receipt and row could ever diverge.
 *
 * Idempotence basis (no `IdempotencyStore`, because the processing is
 * itself idempotent): the effect is `beginRelease` + `release` on one
 * key for one operation id, and a redelivery finds nothing left to
 * release. `beginRelease` alone only rules out a claim held by *another*
 * user, so the claim the receipt's own user may have taken again on the
 * same key — a re-link mints a new `IdentityId`, which leaves the deleted
 * one absent forever — is ruled out here instead, by refusing to release
 * a key some current identity of that user still names.
 *
 * That check commits before `beginRelease` runs, so a re-link landing in
 * the gap still loses its claim; closing it needs a compare-and-set on the
 * directory row — #21.
 */
export async function identityRemovalRelease(
  event: IdentityRemovedEvent,
  deps: WorkerContainer,
): Promise<void> {
  if (event.payload.providerAccountKey === null) {
    return;
  }
  const { operationId } = event.payload;

  const decision = await deps.globalUnitOfWorkProvider.run(
    async (ctx): Promise<ReleaseDecision> => {
      const receipt =
        await ctx.identityRemovalReceiptStore.findByOperationId(operationId);
      if (receipt === null || receipt.providerAccountKey === null) {
        return { outcome: "keep", reason: "noReceipt" };
      }
      const removed = await ctx.identityRepository.findById(receipt.identityId);
      if (removed !== null) {
        return { outcome: "keep", reason: "identityStillPresent" };
      }
      const identities = await ctx.identityRepository.listByUserId(
        receipt.userId,
      );
      const stillClaimed = identities.some(
        (identity) =>
          identity.kind === "oauth" &&
          providerAccountKey(identity.provider, identity.providerAccountId) ===
            receipt.providerAccountKey,
      );
      return stillClaimed
        ? { outcome: "keep", reason: "providerAccountRelinked" }
        : {
            outcome: "release",
            userId: receipt.userId,
            normalizedKey: receipt.providerAccountKey,
          };
    },
  );

  if (decision.outcome === "keep") {
    deps.logger.warn("[identityRemovalRelease] keeping the claim", {
      operationId,
      reason: decision.reason,
    });
    return;
  }

  await releaseActiveUniqueKey(deps, {
    kind: "providerAccount",
    normalizedKey: decision.normalizedKey,
    expectedUserId: decision.userId,
    operationId,
  });
}

type ReleaseDecision =
  | Readonly<{
      outcome: "keep";
      reason: "noReceipt" | "identityStillPresent" | "providerAccountRelinked";
    }>
  | Readonly<{ outcome: "release"; userId: UserId; normalizedKey: string }>;
