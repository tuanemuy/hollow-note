import type { IdentityRemovedEvent } from "@repo/core/domain/identity/events";
import type { WorkerContainer } from "../di/types";
import {
  observeActiveUniqueKey,
  providerAccountKey,
  releaseObservedUniqueKey,
} from "./uniqueness";

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
 * release. `beginRelease` is a compare-and-set against an observation
 * taken afresh on every delivery, so a claim the receipt's own user has
 * taken again on the same key matches it — a re-link mints a new
 * `IdentityId`, which leaves the deleted one absent forever, so the
 * directory holds nothing that tells the two apart. That claim is ruled
 * out here instead, by refusing to release a key some current identity
 * of that user still names.
 *
 * That check commits before the teardown runs, so a re-link landing in
 * the gap would still lose its claim if the teardown were unconditional.
 * It is not: the claim is observed **before** the decision and the
 * teardown is conditional on that observation, so a re-link that lands in
 * the gap replaces the claim and the stale decision becomes a no-op.
 * Observing after the decision instead would defeat this — the fresh
 * claim would be the one observed, and the compare-and-set would pass.
 */
export async function identityRemovalRelease(
  event: IdentityRemovedEvent,
  deps: WorkerContainer,
): Promise<void> {
  if (event.payload.providerAccountKey === null) {
    return;
  }
  const { operationId } = event.payload;

  // The key and user to tear down come from the event payload, the
  // release-or-keep decision from the receipt: `removeIdentity` writes both
  // from the same locals in one transaction, so they cannot disagree.
  const observed = await observeActiveUniqueKey(deps, {
    kind: "providerAccount",
    normalizedKey: event.payload.providerAccountKey,
    expectedUserId: event.payload.userId,
  });

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
        : { outcome: "release" };
    },
  );

  if (decision.outcome === "keep") {
    // Returning without `release` strands no `releasing` row: none of the
    // keep reasons can hold on one — a deleted identity never comes back,
    // that row makes `reserve` refuse the re-link that would recreate it,
    // and the receipt outlives redelivery-or-quarantine of the event.
    deps.logger.warn("[identityRemovalRelease] keeping the claim", {
      operationId,
      reason: decision.reason,
    });
    return;
  }

  await releaseObservedUniqueKey(deps, { observed, operationId });
}

type ReleaseDecision =
  | Readonly<{
      outcome: "keep";
      reason: "noReceipt" | "identityStillPresent" | "providerAccountRelinked";
    }>
  | Readonly<{ outcome: "release" }>;
