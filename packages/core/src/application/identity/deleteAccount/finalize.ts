import { User } from "@repo/core/domain/identity/user";
import type { WorkerContainer } from "../../di/types";
import { IdentityContinuations } from "../continuations";
import type { AccountDeletionDispatchContinuedInput } from "./input";

/**
 * Who produced a finalize attempt. Finalize is not a chain: it is
 * re-attempted by whichever branch completed the receipt that was
 * missing, and each branch names itself so its attempt is a distinct
 * event rather than an upsert over one that may already be in flight.
 */
export const FINALIZE_ATTEMPT_FROM_REDACTION = "redaction";
export const FINALIZE_ATTEMPT_FROM_AUTH_RESIDUE = "authResidue";

/**
 * Drops the account's PII once every declared participant has
 * acknowledged (spec/usecases/identity.md 手順 5).
 *
 * The receipt check and the deletion share one transaction on the UserId
 * shard, so an ack that lands mid-flight cannot make finalize act on a
 * set it never saw whole. An incomplete set is not an error and stores
 * nothing: the user stays `deleting`, its identities stay, and the
 * branch that completes the set attempts finalize again.
 *
 * The manifest is not marked completed here — compaction is what
 * terminates it, after the last page of items is gone, so a completed
 * header always means "nothing left to reclaim".
 */
export async function finalizeAccountDeletion(
  container: WorkerContainer,
  input: AccountDeletionDispatchContinuedInput<"finalize">,
): Promise<void> {
  const header = await container.accountDeletionManifestStore.describe(
    input.operationId,
  );
  if (header === null || header.status !== "built") {
    return;
  }
  const now = container.clock.now();

  await container.globalUnitOfWorkProvider.run(async (ctx) => {
    if (
      !(await ctx.accountDeletionManifestStore.allRequiredAcknowledged(
        input.operationId,
      ))
    ) {
      container.logger.info("[deleteAccount] finalize is still waiting", {
        operationId: input.operationId,
        attemptedBy: input.cursor,
        receipts: header.receipts,
      });
      return;
    }

    const versioned = await ctx.userRepository.findById(header.userId);
    if (versioned === null) {
      return;
    }
    const user = versioned.entity;
    if (user.status === "deleted") {
      // The tombstone is already written and only the hand-over to
      // compaction was lost.
      ctx.collectEvents([
        IdentityContinuations.accountDeletionManifestCompact(
          { operationId: input.operationId, cursor: null },
          now,
        ),
      ]);
      return;
    }
    if (
      user.status !== "deleting" ||
      user.deletionOperationId !== input.operationId
    ) {
      return;
    }

    // At most 8 rows by the `IdentityPolicy` invariant, so the whole set
    // fits one transaction.
    for (const identity of await ctx.identityRepository.listByUserId(
      header.userId,
    )) {
      const row = await ctx.identityRepository.findById(identity.id);
      if (row !== null) {
        await ctx.identityRepository.delete(identity.id, row.expectedVersion);
      }
    }

    const finalized = User.finalizeDeletion(user, input.operationId, now);
    await ctx.userRepository.save(finalized.entity, versioned.expectedVersion);
    ctx.collectEvents([
      ...finalized.eventDrafts,
      IdentityContinuations.accountDeletionManifestCompact(
        { operationId: input.operationId, cursor: null },
        now,
      ),
    ]);
  });
}
