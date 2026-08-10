import type { WorkerContainer } from "../di/types";
import {
  IdentityContinuations,
  type UserAuthResidueCleanupContinuedEvent,
} from "./continuations";

/** One turn reclaims at most this many rows of one table. */
export const AUTH_RESIDUE_PAGE_SIZE = 100;

type Outcome = "stale" | "continued" | "switched" | "finished";

/**
 * Reclaims the physical `sessions` / `auth_tokens` rows left behind by an
 * auth-epoch bump (spec/usecases/identity.md: `resetPassword` /
 * `changePassword` / `signOutOtherSessions` / `deleteAccount` all share
 * this consumer).
 *
 * Revocation itself is O(1) — rows minted under an older epoch are
 * already invalid — so this only removes the dead weight, 100 rows per
 * turn, `sessions` first and then `authTokens`. The next continuation is
 * saved in the same unit of work as the page it follows, so a lost
 * response resumes from the saved phase rather than from the start.
 *
 * Idempotence basis (no `IdempotencyStore`): the effect is a bounded
 * delete of rows below the payload's epoch, so re-running a delivered
 * turn deletes nothing new and converges to the same terminal state.
 * The current generation is never touched.
 */
export async function authResidueCleanup(
  event: UserAuthResidueCleanupContinuedEvent,
  deps: WorkerContainer,
): Promise<void> {
  const { userId, authEpoch, table, deletionOperationId } = event.payload;
  const now = deps.clock.now();

  const outcome = await deps.globalUnitOfWorkProvider.run(
    async (ctx): Promise<Outcome> => {
      const versioned = await ctx.userRepository.findById(userId);
      if (versioned === null || versioned.entity.authEpoch !== authEpoch) {
        // A newer bump owns a chain that covers this one's rows too.
        return "stale";
      }

      const repository =
        table === "sessions" ? ctx.sessionRepository : ctx.authTokenRepository;
      const deleted = await repository.deleteOlderEpochByUser(
        userId,
        authEpoch,
        AUTH_RESIDUE_PAGE_SIZE,
      );

      if (deleted === AUTH_RESIDUE_PAGE_SIZE) {
        ctx.collectEvents([
          IdentityContinuations.userAuthResidueCleanup(
            { userId, authEpoch, table, deletionOperationId },
            now,
          ),
        ]);
        return "continued";
      }
      if (table === "sessions") {
        ctx.collectEvents([
          IdentityContinuations.userAuthResidueCleanup(
            { userId, authEpoch, table: "authTokens", deletionOperationId },
            now,
          ),
        ]);
        return "switched";
      }
      return "finished";
    },
  );

  if (deletionOperationId === null) {
    return;
  }
  if (outcome === "stale") {
    deps.logger.warn(
      "[authResidueCleanup] deletion-driven cleanup found a moved auth epoch",
      { userId, authEpoch, deletionOperationId },
    );
    return;
  }
  if (outcome === "finished") {
    // Acknowledged after the commit, and outside it, because the receipt
    // lives on the manifest rather than in this transaction. A crash in
    // between redelivers this same continuation (the relay only marks it
    // processed once the handler returns), and the retry re-reaches the
    // terminal turn with zero rows left.
    await deps.accountDeletionManifestStore.acknowledgeReceipt(
      deletionOperationId,
      "authResidue",
    );
  }
}
