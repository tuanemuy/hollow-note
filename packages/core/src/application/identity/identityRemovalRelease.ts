import type { IdentityRemovedEvent } from "@repo/core/domain/identity/events";
import type { WorkerContainer } from "../di/types";
import type { IdentityRemovalReceipt } from "../ports/identityRemovalReceiptStore";
import { releaseActiveUniqueKey } from "./uniqueness";

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
 * key for one operation id. A redelivery finds nothing left to release,
 * and neither call can touch a claim owned by anybody else —
 * `beginRelease` no-ops unless the row is the receipt's own user's.
 */
export async function identityRemovalRelease(
  event: IdentityRemovedEvent,
  deps: WorkerContainer,
): Promise<void> {
  const { operationId, providerAccountKey } = event.payload;
  if (providerAccountKey === null) {
    return;
  }

  const receipt = await deps.globalUnitOfWorkProvider.run(
    async (ctx): Promise<IdentityRemovalReceipt | null> => {
      const found =
        await ctx.identityRemovalReceiptStore.findByOperationId(operationId);
      if (found === null || found.providerAccountKey === null) {
        return null;
      }
      const identity = await ctx.identityRepository.findById(found.identityId);
      return identity === null ? found : null;
    },
  );

  if (receipt === null || receipt.providerAccountKey === null) {
    deps.logger.warn(
      "[identityRemovalRelease] no receipt for the removal; keeping the claim",
      { operationId },
    );
    return;
  }

  await releaseActiveUniqueKey(deps, {
    kind: "providerAccount",
    normalizedKey: receipt.providerAccountKey,
    expectedUserId: receipt.userId,
    operationId,
  });
}
