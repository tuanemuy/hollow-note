import type { TestHarness } from "../../__tests__/helpers";
import type { DistributedOperationState } from "../../ports/distributedOperationStore";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import { drainDeletion } from "./deletionHarness";

/**
 * Deletions never finish in one pass: the global plane hands work to the
 * scope plane through a scheduled task, and the scope plane hands its
 * completion back through an outbox event. Only alternating the two
 * drivers moves the chain (the round count is a safety net, not a
 * deadline — every reachable deletion in these tests settles in a
 * handful).
 */
const MAX_ROUNDS = 64;

/**
 * Runs a deletion the way `pnpm dev` does — relay round, scope-task
 * round, repeat — until its control-plane operation leaves `running`.
 *
 * Tests that need to inject a fault (drop a response, redeliver a
 * command, stop halfway) do it around this call: they drive the phase in
 * question by hand and let the driver carry the rest, so each test only
 * spells out its own difference.
 *
 * A round that moves nothing while the operation is still running means
 * the chain broke; failing loudly there is what keeps a stalled deletion
 * from reading as a passing test.
 */
export async function runUntilSettled(
  h: TestHarness,
  operationId: string,
): Promise<DistributedOperationState> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const relayed = await drainDeletion(h);
    const { processed } = await runDueScopeTasks(h.workerContainer);

    const operation =
      await h.container.deletionOperationReader.findByOperationId(operationId);
    if (operation === null) {
      throw new Error(`deletion operation ${operationId} disappeared`);
    }
    if (operation.state !== "running") {
      return operation.state;
    }
    if (relayed === 0 && processed === 0) {
      throw new Error(
        `deletion operation ${operationId} stalled while still running`,
      );
    }
  }
  throw new Error(
    `deletion operation ${operationId} did not settle in ${MAX_ROUNDS} rounds`,
  );
}
