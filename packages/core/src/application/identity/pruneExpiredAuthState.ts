import type { AuthStateTable, ExpirySweep, WorkerContainer } from "../di/types";
import { SystemError, SystemErrorCode } from "../errors";
import type { MaintenanceLane } from "../ports/globalMaintenanceRunStore";
import type { PruneExpiredAuthStateView } from "./view";

export type PruneExpiredAuthStateInput =
  | Readonly<{ type: "cron" }>
  | Readonly<{
      type: "identity.authStatePruneContinued";
      runId: string;
      generation: string;
      shardId: string;
      table: AuthStateTable;
      cursor: string | null;
      asOf: Date;
    }>
  | Readonly<{
      type: "global.maintenanceRunPruneContinued";
      cursor: string | null;
      asOf: Date;
    }>;

export type PruneExpiredAuthStateArgs = Readonly<{
  container: WorkerContainer;
  input: PruneExpiredAuthStateInput;
}>;

const PAGE_LIMIT = 100;
const LEASE_MS = 10 * 60 * 1000;
const MAX_LANE_CLAIM = 6;
/** Per-invocation operation budget (spec: yield at 100 operations). */
const MAX_COMMANDS_PER_INVOCATION = 100;

// Stable per-process lease owner, mirroring the relay worker's id: a
// restarted process mints a new one, and a lapsed lease is reclaimed
// through `beginOrResumeKind` regardless of the previous owner. Exported
// so tests can stage orphaned claims under this process's identity.
export const PRUNE_LEASE_OWNER = crypto.randomUUID();
const PRUNE_WORKER_ID = PRUNE_LEASE_OWNER;

type Counts = Record<AuthStateTable, number>;

const zeroCounts = (): Counts => ({
  sessions: 0,
  auth_tokens: 0,
  login_attempts: 0,
  oauth_flow_states: 0,
  identity_removal_receipts: 0,
});

const toView = (
  counts: Counts,
  continued: boolean,
): PruneExpiredAuthStateView => ({
  sessions: counts.sessions,
  authTokens: counts.auth_tokens,
  loginAttempts: counts.login_attempts,
  oauthFlowStates: counts.oauth_flow_states,
  identityRemovalReceipts: counts.identity_removal_receipts,
  continued,
});

const isAuthStateTable = (table: string): table is AuthStateTable =>
  table === "sessions" ||
  table === "auth_tokens" ||
  table === "login_attempts" ||
  table === "oauth_flow_states" ||
  table === "identity_removal_receipts";

const commandKeyOf = (
  runId: string,
  lane: Readonly<{ generation: string; shardId: string; table: string }>,
  cursor: string | null,
): string =>
  `${runId}:${lane.generation}:${lane.shardId}:${lane.table}:${cursor ?? ""}`;

const hourBucketOf = (instant: Date): string => {
  const truncated = new Date(instant.getTime());
  truncated.setUTCMinutes(0, 0, 0);
  return truncated.toISOString();
};

/**
 * Reclaims expired auth state — sessions, auth tokens, login attempts,
 * OAuth flow states of **both** intents, and the 30-day
 * identity-removal receipts — under the shared
 * `GlobalMaintenanceRunStore` bookkeeping (UC-identity-021,
 * spec/usecases/identity.md#pruneexpiredauthstate).
 *
 * Contract highlights:
 * - Each command sweeps one shard × one table × at most 100 rows with
 *   the run's fixed `asOf` (`expiresAt <= asOf`, the same boundary as
 *   `Session.isExpired` / `AuthToken.isExpired`). The clock is only read
 *   on `cron`; continuations carry the fixed values.
 * - Table deletes never join a cross-cutting unit of work; only the lane
 *   checkpoint is atomic on the run store. A response lost between the
 *   DELETE and the checkpoint re-runs the same idempotent DELETE from
 *   the stored cursor.
 * - `cron` first runs one page of the shared completed-run pruner, then
 *   begins or resumes the kind's single running run and drains the lanes
 *   it can claim (max 6 active). A per-table failure releases the lane
 *   with its cursor intact and the other lanes keep progressing; an
 *   invocation whose delete operations all failed throws
 *   `SystemError(DatabaseError)`.
 * - The table walk order belongs to the run's own snapshot, not to this
 *   usecase: every position, including the one an ack advances to, comes
 *   from the run store. A table the run names but this deployment has no
 *   sweep for is acked past — logged, not counted as a failure — so a
 *   run snapshotted by an older table set still completes. That skip is
 *   a behaviour of the `cron` (driving) path; a continuation turn never
 *   receives an unknown table, because `AuthStateTable` closes what it
 *   accepts (spec/adr/062).
 *
 * Runtime wiring note: no scheduler invokes this yet — the Node runner's
 * pruner role remains `pruneOutbox`, and the cron / queue wiring lands
 * with the Cloudflare slice. A crashed invocation's claimed lane is
 * recovered by the next `cron`: re-leasing the lapsed run returns its
 * abandoned lanes to the claimable pool, cursor intact. A continuation
 * turn is a single turn, not a driver: the lane its final ack hands back
 * is passed on to the next continuation still claimed. Until a producer
 * enqueues those continuations, such a lane sits until its lease lapses
 * and the next cron reclaims it.
 */
export async function pruneExpiredAuthState({
  container,
  input,
}: PruneExpiredAuthStateArgs): Promise<PruneExpiredAuthStateView> {
  switch (input.type) {
    case "global.maintenanceRunPruneContinued": {
      const page = await container.maintenanceRunStore.pruneCompleted(
        input.asOf,
        input.cursor,
        PAGE_LIMIT,
      );
      return toView(zeroCounts(), page.nextCursor !== null);
    }
    case "identity.authStatePruneContinued":
      return runContinuation(container, input);
    case "cron":
      return runCron(container);
  }
}

async function runContinuation(
  container: WorkerContainer,
  input: Extract<
    PruneExpiredAuthStateInput,
    { type: "identity.authStatePruneContinued" }
  >,
): Promise<PruneExpiredAuthStateView> {
  const counts = zeroCounts();
  const lane = {
    generation: input.generation,
    shardId: input.shardId,
    table: input.table,
  };
  let page: Awaited<ReturnType<ExpirySweep["deleteExpired"]>>;
  try {
    page = await container.authStateSweeps[input.table].deleteExpired(
      input.asOf,
      input.cursor,
      PAGE_LIMIT,
    );
  } catch (cause) {
    container.logger.error("[pruneExpiredAuthState] table sweep failed", {
      cause,
      table: input.table,
    });
    // Release the claim keeping the cursor so the next owner resumes
    // from the same keyset.
    await container.maintenanceRunStore.advanceOrAck({
      runId: input.runId,
      leaseOwner: PRUNE_WORKER_ID,
      generation: input.generation,
      shardId: input.shardId,
      completed: false,
    });
    throw cause;
  }
  counts[input.table] += page.deleted;
  if (page.nextCursor !== null) {
    await container.maintenanceRunStore.checkpointLane({
      runId: input.runId,
      leaseOwner: PRUNE_WORKER_ID,
      generation: input.generation,
      shardId: input.shardId,
      table: input.table,
      cursor: page.nextCursor,
      asOf: input.asOf,
      nextCommandKey: commandKeyOf(input.runId, lane, page.nextCursor),
    });
    return toView(counts, true);
  }
  const advanced = await container.maintenanceRunStore.advanceOrAck({
    runId: input.runId,
    leaseOwner: PRUNE_WORKER_ID,
    generation: input.generation,
    shardId: input.shardId,
    completed: true,
  });
  return toView(counts, advanced.next !== null);
}

async function runCron(
  container: WorkerContainer,
): Promise<PruneExpiredAuthStateView> {
  const { clock, logger, maintenanceRunStore } = container;
  const now = clock.now();
  const counts = zeroCounts();

  // Initial task of the shared completed-run pruner (the auth cron is
  // one of its three issuers; in-process it runs the first page inline).
  let pruneContinued = false;
  try {
    const prunePage = await maintenanceRunStore.pruneCompleted(
      now,
      null,
      PAGE_LIMIT,
    );
    pruneContinued = prunePage.nextCursor !== null;
  } catch (cause) {
    logger.error("[pruneExpiredAuthState] maintenance-run prune failed", {
      cause,
    });
  }

  const generations = container.routingGenerations;
  const candidateRunId = `authStatePrune:${hourBucketOf(now)}:${generations.join(",")}`;
  const begin = await maintenanceRunStore.beginOrResumeKind({
    candidateRunId,
    kind: "authStatePrune",
    candidateAsOf: now,
    generations,
    leaseOwner: PRUNE_WORKER_ID,
    leaseUntil: new Date(now.getTime() + LEASE_MS),
  });
  if (begin.result === "leased") {
    // Another live owner is driving this run — no-op.
    return toView(counts, true);
  }
  const runId = begin.runId;
  // A resumed run keeps its original (oldest) asOf.
  const asOf = begin.asOf;

  let successes = 0;
  let failures = 0;
  let commands = 0;
  let workRemains = false;

  const releaseLane = async (
    lane: Readonly<{ generation: string; shardId: string }>,
  ): Promise<void> => {
    try {
      await maintenanceRunStore.advanceOrAck({
        runId,
        leaseOwner: PRUNE_WORKER_ID,
        generation: lane.generation,
        shardId: lane.shardId,
        completed: false,
      });
    } catch (cause) {
      // The release runs on the way out, including out of a throw whose
      // own cause (a lapsed or stolen lease) makes the release fail too,
      // so the failure is not rethrown. It still has to be reported as
      // unfinished work: `PRUNE_LEASE_OWNER` is a process constant, so
      // this process's next cron renews its own lease and the lapsed-lease
      // reclaim never fires for a lane it failed to hand back. Defensive
      // today — every current call site already marks work remaining, so
      // only a future one could observe this.
      workRemains = true;
      logger.error("[pruneExpiredAuthState] lane release failed", {
        cause,
        generation: lane.generation,
        shardId: lane.shardId,
      });
    }
  };

  const laneQueue: MaintenanceLane[] = [
    ...(await maintenanceRunStore.claimLanes(
      runId,
      PRUNE_WORKER_ID,
      MAX_LANE_CLAIM,
    )),
  ];

  // The lane taken out of the queue for processing: still claimed, and
  // no longer reachable through `laneQueue`, so the exit path below has
  // to release it too.
  let inFlight: MaintenanceLane | null = null;

  try {
    while (laneQueue.length > 0) {
      if (commands >= MAX_COMMANDS_PER_INVOCATION) {
        workRemains = true;
        break;
      }
      const lane = laneQueue.shift();
      if (lane === undefined) {
        break;
      }
      inFlight = lane;
      if (!isAuthStateTable(lane.table)) {
        // This deployment has no sweep for the table the run's snapshot
        // names, so stalling the run would not collect those rows
        // either: ack past it and let the run finish. It is not a delete
        // failure, so it stays out of `failures`; this log is the only
        // trace that the table went uncollected in this run
        // (spec/adr/062).
        logger.error("[pruneExpiredAuthState] unknown sweep table", {
          table: lane.table,
          runId,
          generation: lane.generation,
          shardId: lane.shardId,
        });
        commands += 1;
        const advanced = await maintenanceRunStore.advanceOrAck({
          runId,
          leaseOwner: PRUNE_WORKER_ID,
          generation: lane.generation,
          shardId: lane.shardId,
          completed: true,
        });
        inFlight = null;
        if (advanced.next !== null) {
          laneQueue.push(advanced.next);
        }
        continue;
      }

      let cursor = lane.cursor;
      const table = lane.table;
      let laneDone = false;
      while (!laneDone && commands < MAX_COMMANDS_PER_INVOCATION) {
        commands += 1;
        let page: Awaited<ReturnType<ExpirySweep["deleteExpired"]>>;
        try {
          page = await container.authStateSweeps[table].deleteExpired(
            asOf,
            cursor,
            PAGE_LIMIT,
          );
        } catch (cause) {
          logger.error("[pruneExpiredAuthState] table sweep failed", {
            cause,
            table,
            shardId: lane.shardId,
          });
          failures += 1;
          // Back off this lane only: release the claim with the cursor
          // preserved so a later invocation resumes the same keyset.
          await maintenanceRunStore.advanceOrAck({
            runId,
            leaseOwner: PRUNE_WORKER_ID,
            generation: lane.generation,
            shardId: lane.shardId,
            completed: false,
          });
          workRemains = true;
          laneDone = true;
          continue;
        }
        successes += 1;
        counts[table] += page.deleted;
        if (page.nextCursor !== null) {
          await maintenanceRunStore.checkpointLane({
            runId,
            leaseOwner: PRUNE_WORKER_ID,
            generation: lane.generation,
            shardId: lane.shardId,
            table,
            cursor: page.nextCursor,
            asOf,
            nextCommandKey: commandKeyOf(
              runId,
              { generation: lane.generation, shardId: lane.shardId, table },
              page.nextCursor,
            ),
          });
          cursor = page.nextCursor;
          continue;
        }
        const advanced = await maintenanceRunStore.advanceOrAck({
          runId,
          leaseOwner: PRUNE_WORKER_ID,
          generation: lane.generation,
          shardId: lane.shardId,
          completed: true,
        });
        if (advanced.next === null) {
          laneDone = true;
          continue;
        }
        // The ack hands back the position it advanced to — this lane's
        // next table, or the shard it auto-claimed at that shard's
        // persisted position. Either way it is claimed and this
        // invocation drives it.
        laneQueue.push(advanced.next);
        laneDone = true;
      }
      if (!laneDone) {
        // Budget exhausted mid-lane; the checkpointed cursor lets the next
        // invocation (or a continuation task) resume — but only after the
        // claim is released, since `claimLanes` never returns claimed
        // lanes and the same-owner cron renews the lease every run, so an
        // unreleased lane would stay stuck forever.
        workRemains = true;
        await maintenanceRunStore.advanceOrAck({
          runId,
          leaseOwner: PRUNE_WORKER_ID,
          generation: lane.generation,
          shardId: lane.shardId,
          completed: false,
        });
      }
      inFlight = null;
    }
  } finally {
    // Every lane still claimed on the way out has to be handed back
    // (cursor intact): a budget break leaves untouched lanes queued, and
    // a throw from a lane operation abandons the one in flight. Both
    // would otherwise stay claimed forever, since `claimLanes` never
    // returns a claimed lane.
    const abandoned = inFlight === null ? laneQueue : [inFlight, ...laneQueue];
    const released = new Set<string>();
    for (const lane of abandoned) {
      const key = `${lane.generation} ${lane.shardId}`;
      if (released.has(key)) {
        continue;
      }
      released.add(key);
      await releaseLane(lane);
    }
  }

  if (failures > 0 && successes === 0) {
    throw new SystemError(
      SystemErrorCode.DatabaseError,
      "Every expired-auth-state sweep failed in this invocation",
    );
  }

  return toView(counts, workRemains || pruneContinued);
}
