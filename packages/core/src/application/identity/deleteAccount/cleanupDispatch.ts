import type { UserId } from "@repo/core/domain/identity/valueObject";
import {
  type ActivePersonalCleanupComponent,
  REQUIRED_PERSONAL_CLEANUP_COMPONENTS,
} from "../../cleanup/participants";
import type { WorkerContainer } from "../../di/types";
import type { PersonalCleanupProgress } from "../../ports/scopeCleanupAdmissionStore";
import { ScopeKey } from "../../scope";
import { deleteFilesByOwner } from "../../storage/deleteFilesByOwner";
import { deleteQuota } from "../../usage/deleteQuota";
import { IdentityContinuations } from "../continuations";
import type {
  AccountDeletionDispatchContinuedInput,
  AccountDeletionDispatchPhase,
} from "./input";

/** Dispatch phase the personal cleanup hands over to once acknowledged. */
const PHASE_AFTER_CLEANUP: AccountDeletionDispatchPhase = "redaction";

type PersonalCleanupCommand = (
  container: WorkerContainer,
  params: Readonly<{ scope: ScopeKey; operationId: string }>,
) => Promise<unknown>;

/**
 * Command key of one component's initial cleanup delivery. Derived from
 * the operation so a redelivery derives the same key and the receiving
 * scope suppresses it through `AppliedOperationStore`.
 */
export const cleanupCommandKey = (
  operationId: string,
  component: ActivePersonalCleanupComponent,
): string => `${operationId}:cleanup:${component}`;

/**
 * How each declared personal participant is commanded. Exhaustive over
 * the participants the deployment declares, so adding one to the
 * registry without wiring its command is a type error.
 */
const PERSONAL_CLEANUP_COMMANDS: Record<
  ActivePersonalCleanupComponent,
  PersonalCleanupCommand
> = {
  storage: (container, params) =>
    deleteFilesByOwner({
      container,
      input: {
        deletionOperationId: params.operationId,
        scope: params.scope,
        commandKey: cleanupCommandKey(params.operationId, "storage"),
      },
    }),
  usage: (container, params) =>
    deleteQuota({
      container,
      input: {
        deletionOperationId: params.operationId,
        scope: params.scope,
        commandKey: cleanupCommandKey(params.operationId, "usage"),
      },
    }),
};

const readProgress = (
  container: WorkerContainer,
  userId: UserId,
  operationId: string,
): Promise<PersonalCleanupProgress | null> =>
  container.scopeUnitOfWorkProvider.run(ScopeKey.user(userId), (ctx) =>
    ctx.cleanupAdmission.describePersonalCleanup(operationId),
  );

/**
 * Records the scope's completion on the UserId-shard manifest and moves
 * the chain to the next phase.
 *
 * Deliberately a second, separate unit of work: the scope closed its
 * barrier in its own transaction and the two planes may not share one,
 * so the receipt is written **after** that commit was acknowledged. A
 * response lost in between leaves a completed barrier with no receipt,
 * which nothing recovers from on its own — so every caller brings the
 * driver that repeats the call. The wave below is re-delivered by the
 * outbox; the scope-task runner arms a hand-over row before it calls
 * this and clears it only once the receipt is in. Repeating is free: the
 * receipt is idempotent and the continuation folds onto its
 * deterministic id.
 */
export async function acknowledgePersonalCleanup(
  container: WorkerContainer,
  operationId: string,
): Promise<void> {
  const now = container.clock.now();
  await container.globalUnitOfWorkProvider.run(async (ctx) => {
    await ctx.accountDeletionManifestStore.acknowledgeReceipt(
      operationId,
      "personalCleanup",
    );
    ctx.collectEvents([
      IdentityContinuations.accountDeletionDispatch(
        { operationId, phase: PHASE_AFTER_CLEANUP },
        now,
      ),
    ]);
  });
}

/**
 * Runs the cleanup wave of a deletion (spec/usecases/identity.md 手順 4).
 *
 * Only components that have not acknowledged yet are commanded, so a
 * re-driven wave is cheap and a completed barrier degenerates to
 * re-acknowledging the global receipt. Commands whose work does not fit
 * one turn re-arm the scope's own task row and finish there; this
 * function does not wait for them.
 *
 * The workspace cleanup wave is not dispatched here: membership items
 * exist only once the workspace slice fixes them, and its `claimPending`
 * page belongs with the receiver that acknowledges it.
 */
export async function dispatchAccountDeletionCleanup(
  container: WorkerContainer,
  input: AccountDeletionDispatchContinuedInput<"cleanup">,
): Promise<void> {
  const header = await container.accountDeletionManifestStore.describe(
    input.operationId,
  );
  if (header === null || header.status !== "built") {
    return;
  }
  const scope = ScopeKey.user(header.userId);

  const progress = await readProgress(
    container,
    header.userId,
    input.operationId,
  );
  if (progress === null) {
    return;
  }

  if (progress.status === "running") {
    for (const component of REQUIRED_PERSONAL_CLEANUP_COMPONENTS) {
      if (progress.acknowledged.includes(component)) {
        continue;
      }
      await PERSONAL_CLEANUP_COMMANDS[component](container, {
        scope,
        operationId: input.operationId,
      });
    }
  }

  const settled = await readProgress(
    container,
    header.userId,
    input.operationId,
  );
  if (settled?.status === "completed") {
    await acknowledgePersonalCleanup(container, input.operationId);
  }
}
