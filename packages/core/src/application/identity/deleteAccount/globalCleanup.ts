import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkerContainer } from "../../di/types";
import { IdentityContinuations } from "../continuations";
import type { UniqueKey } from "../uniqueness";
import { releaseActiveUniqueKey, reservationOperationId } from "../uniqueness";
import type { AccountDeletionDispatchContinuedInput } from "./input";
import { readUniquenessKeys } from "./input";

/**
 * Names the producer of a finalize attempt so the attempts of the
 * several branches that can complete the receipt set stay separate
 * events (a deterministic id may only be reused by turns that differ).
 */
export const FINALIZE_ATTEMPT_FROM_UNIQUENESS = "uniquenessRelease";

const uniqueKeysOf = (
  keys: Readonly<{
    email: string;
    handle: string | null;
    providerAccounts: readonly string[];
  }>,
): readonly UniqueKey[] => [
  { kind: "email", normalizedKey: keys.email },
  ...(keys.handle === null
    ? []
    : [{ kind: "handle" as const, normalizedKey: keys.handle }]),
  ...keys.providerAccounts.map((normalizedKey) => ({
    kind: "providerAccount" as const,
    normalizedKey,
  })),
];

/**
 * Global-plane half of the cleanup wave (spec/usecases/identity.md 手順
 * 4): reclaim the credential rows the epoch bump already invalidated,
 * and give the account's uniqueness keys back to the directory.
 *
 * The release happens **here**, before finalize, not after it: finalize
 * waits for a receipt set that includes `uniquenessRelease`, so freeing
 * the keys as part of finalize would be a receipt waiting on itself.
 * Which keys to free is read from the operation payload frozen at
 * admission — by now the identity rows may already be gone, and after
 * finalize they certainly are.
 *
 * Both halves are idempotent, and the work of each is skipped once its
 * receipt is in, so a redelivered wave neither restarts the residue
 * chain nor re-releases a key. The receipt and the finalize attempt it
 * unblocks are written in one transaction, so "the receipt is in but
 * finalize was never asked for" is a state this cannot leave behind.
 * Re-issuing the attempt is not itself a recovery mechanism: the id is
 * deterministic and `OutboxRepository.save` leaves an existing row
 * untouched, so a redelivered wave's attempt is a no-op while that row
 * lives. What keeps finalize reachable is that each producer names its
 * own cursor — whichever branch completes the last missing receipt
 * writes an attempt id no other branch can have taken.
 */
export async function runAccountDeletionGlobalCleanup(
  container: WorkerContainer,
  input: AccountDeletionDispatchContinuedInput<"cleanup">,
): Promise<void> {
  const header = await container.accountDeletionManifestStore.describe(
    input.operationId,
  );
  if (header === null || header.status !== "built") {
    return;
  }

  if (!header.receipts.includes("authResidue")) {
    await startAuthResidueCleanup(container, input.operationId, header.userId);
  }
  if (!header.receipts.includes("uniquenessRelease")) {
    const operation = await container.globalUnitOfWorkProvider.run((ctx) =>
      ctx.distributedOperationStore.findByOperationId(input.operationId),
    );
    if (operation === null) {
      return;
    }
    for (const key of uniqueKeysOf(readUniquenessKeys(operation.payload))) {
      await releaseActiveUniqueKey(container, {
        ...key,
        expectedUserId: header.userId,
        operationId: reservationOperationId(input.operationId, key),
      });
    }
  }

  const now = container.clock.now();
  await container.globalUnitOfWorkProvider.run(async (ctx) => {
    await ctx.accountDeletionManifestStore.acknowledgeReceipt(
      input.operationId,
      "uniquenessRelease",
    );
    ctx.collectEvents([
      IdentityContinuations.accountDeletionDispatch(
        {
          operationId: input.operationId,
          phase: "finalize",
          cursor: FINALIZE_ATTEMPT_FROM_UNIQUENESS,
        },
        now,
      ),
    ]);
  });
}

/**
 * Hands the shared residue consumer its first turn, tagged with the
 * deletion so its terminal turn acknowledges `authResidue`. The epoch is
 * read here rather than carried from admission: the chain must never
 * delete the generation currently in force, and only the stored user
 * says which that is.
 */
async function startAuthResidueCleanup(
  container: WorkerContainer,
  operationId: string,
  userId: UserId,
): Promise<void> {
  const now = container.clock.now();
  await container.globalUnitOfWorkProvider.run(async (ctx) => {
    const versioned = await ctx.userRepository.findById(userId);
    const user = versioned?.entity;
    if (
      user === undefined ||
      user.status !== "deleting" ||
      user.deletionOperationId !== operationId
    ) {
      return;
    }
    ctx.collectEvents([
      IdentityContinuations.userAuthResidueCleanup(
        {
          userId,
          authEpoch: user.authEpoch,
          table: "sessions",
          deletionOperationId: operationId,
        },
        now,
      ),
    ]);
  });
}
