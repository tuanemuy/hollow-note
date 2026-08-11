import type { WorkerContainer } from "../../di/types";
import type { AccountDeletionManifestPruneContinuedInput } from "./input";

export type AccountDeletionTerminalPruneInput =
  | Readonly<{ type: "cron" }>
  | AccountDeletionManifestPruneContinuedInput;

export type AccountDeletionTerminalPruneArgs = Readonly<{
  container: WorkerContainer;
  input: AccountDeletionTerminalPruneInput;
}>;

export type AccountDeletionTerminalPruneView = Readonly<{
  removed: number;
  /** `true` while any lane of the run still has work left. */
  continued: boolean;
}>;

/** The kind's single sweep table (`MemoryBackend.maintenanceTablesByKind`). */
const TABLE = "account_deletion_manifests";
const PAGE_LIMIT = 100;
const LEASE_MS = 10 * 60 * 1000;
/** Lanes one invocation drives; the store caps the kind at the same number. */
const MAX_LANE_CLAIM = 6;
/** Per-invocation operation budget (spec: yield at 100 operations). */
const MAX_COMMANDS_PER_INVOCATION = 100;

// Stable per-process lease owner, mirroring the auth-state pruner: a
// restarted process mints a new one, and a lapsed lease is reclaimed
// through `beginOrResumeKind` whoever the previous owner was.
export const ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER = crypto.randomUUID();

const hourBucketOf = (instant: Date): string => {
  const truncated = new Date(instant.getTime());
  truncated.setUTCMinutes(0, 0, 0);
  return truncated.toISOString();
};

const commandKeyOf = (
  runId: string,
  lane: Readonly<{ generation: string; shardId: string; table: string }>,
  cursor: string | null,
): string =>
  `${runId}:${lane.generation}:${lane.shardId}:${lane.table}:${cursor ?? ""}`;

/**
 * Reclaims terminal deletion manifests and the control-plane rows they
 * belong to (spec/usecases/identity.md 手順 5, TC-identity-104..107 /
 * 109).
 *
 * The header and its `distributed_operations` row are dropped in one
 * transaction, which is the whole reason the manifest names what it
 * reclaimed instead of counting it (ADR-026): the two must never survive
 * each other, or a retained request key would keep pointing at a
 * manifest that is gone.
 *
 * The page delete and the run checkpoint cannot share a transaction —
 * they live on different shards — so a response lost between them is
 * repaired by re-running the same input cursor: the keyset skips what
 * the previous attempt removed and picks up the rest, which makes the
 * re-run idempotent without a record of what it did.
 *
 * Runtime wiring note: no scheduler invokes this yet, the same standing
 * as `pruneExpiredAuthState` — a header is retained for 120 days, so
 * nothing is due until long after this slice. The cron / queue wiring
 * lands with the runtime slice that gives the Node runner a cron role.
 */
export async function pruneAccountDeletionManifests({
  container,
  input,
}: AccountDeletionTerminalPruneArgs): Promise<AccountDeletionTerminalPruneView> {
  return input.type === "cron"
    ? runCron(container)
    : runContinuation(container, input);
}

/** Removes one page and drops each reclaimed operation with it. */
async function prunePage(
  container: WorkerContainer,
  asOf: Date,
  cursor: string | null,
): Promise<Readonly<{ removed: number; nextCursor: string | null }>> {
  return container.globalUnitOfWorkProvider.run(async (ctx) => {
    const page = await ctx.accountDeletionManifestStore.pruneTerminal(
      asOf,
      cursor,
      PAGE_LIMIT,
    );
    for (const operationId of page.operationIds) {
      await ctx.distributedOperationStore.deleteTerminal(operationId);
    }
    return {
      removed: page.operationIds.length,
      nextCursor: page.nextCursor,
    };
  });
}

async function runContinuation(
  container: WorkerContainer,
  input: AccountDeletionManifestPruneContinuedInput,
): Promise<AccountDeletionTerminalPruneView> {
  const lane = {
    generation: input.generation,
    shardId: input.shardId,
    table: TABLE,
  };
  const page = await prunePage(container, input.asOf, input.cursor);
  if (page.nextCursor !== null) {
    await container.maintenanceRunStore.checkpointLane({
      runId: input.runId,
      leaseOwner: ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
      generation: input.generation,
      shardId: input.shardId,
      table: lane.table,
      cursor: page.nextCursor,
      asOf: input.asOf,
      nextCommandKey: commandKeyOf(input.runId, lane, page.nextCursor),
    });
    return { removed: page.removed, continued: true };
  }
  const advanced = await container.maintenanceRunStore.advanceOrAck({
    runId: input.runId,
    leaseOwner: ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
    generation: input.generation,
    shardId: input.shardId,
    completed: true,
  });
  return { removed: page.removed, continued: advanced.next !== null };
}

async function runCron(
  container: WorkerContainer,
): Promise<AccountDeletionTerminalPruneView> {
  const { maintenanceRunStore: runStore, logger } = container;
  const now = container.clock.now();
  const generations = container.routingGenerations;
  const begin = await runStore.beginOrResumeKind({
    candidateRunId: `accountManifestPrune:${hourBucketOf(now)}:${generations.join(",")}`,
    kind: "accountManifestPrune",
    candidateAsOf: now,
    generations,
    leaseOwner: ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
    leaseUntil: new Date(now.getTime() + LEASE_MS),
  });
  if (begin.result === "leased") {
    return { removed: 0, continued: true };
  }
  const runId = begin.runId;
  // A resumed run keeps its original `asOf`, so the retention boundary
  // never drifts between the hours it takes to finish.
  const asOf = begin.asOf;

  let removed = 0;
  let commands = 0;
  let continued = false;
  const claimed = await runStore.claimLanes(
    runId,
    ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
    MAX_LANE_CLAIM,
  );

  const release = async (
    lane: Readonly<{ generation: string; shardId: string }>,
  ): Promise<void> => {
    try {
      await runStore.advanceOrAck({
        runId,
        leaseOwner: ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
        generation: lane.generation,
        shardId: lane.shardId,
        completed: false,
      });
    } catch (cause) {
      logger.error("[accountManifestPrune] lane release failed", {
        cause,
        ...lane,
      });
    }
  };

  for (const lane of claimed) {
    let cursor = lane.cursor;
    let settled = false;
    while (commands < MAX_COMMANDS_PER_INVOCATION) {
      commands += 1;
      let page: Awaited<ReturnType<typeof prunePage>>;
      try {
        page = await prunePage(container, asOf, cursor);
      } catch (cause) {
        logger.error("[accountManifestPrune] page failed", { cause, ...lane });
        await release(lane);
        settled = true;
        continued = true;
        break;
      }
      removed += page.removed;
      if (page.nextCursor === null) {
        const advanced = await runStore.advanceOrAck({
          runId,
          leaseOwner: ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
          generation: lane.generation,
          shardId: lane.shardId,
          completed: true,
        });
        settled = true;
        // Acking the last table of a lane auto-claims the next pending
        // lane. This invocation is done with its six, so hand it straight
        // back — cursor intact — instead of chaining past the cap.
        if (advanced.next !== null) {
          await release(advanced.next);
          continued = true;
        }
        break;
      }
      cursor = page.nextCursor;
      await runStore.checkpointLane({
        runId,
        leaseOwner: ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
        generation: lane.generation,
        shardId: lane.shardId,
        table: lane.table,
        cursor,
        asOf,
        nextCommandKey: commandKeyOf(runId, lane, cursor),
      });
    }
    if (!settled) {
      continued = true;
      await release(lane);
    }
  }

  return { removed, continued };
}
