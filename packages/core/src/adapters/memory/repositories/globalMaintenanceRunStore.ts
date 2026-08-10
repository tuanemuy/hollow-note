import { ConflictError } from "../../../application/errors";
import type {
  GlobalMaintenanceRunStore,
  MaintenanceLane,
} from "../../../application/ports/globalMaintenanceRunStore";
import type {
  MaintenanceLaneRow,
  MaintenanceRunRow,
  MemoryBackend,
} from "../store";
import { compareStrings } from "../support";

const MAX_ACTIVE_LANES = 6;
const PRUNE_PAGE_LIMIT = 100;
const COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const laneKey = (generation: string, shardId: string): string =>
  `${generation} ${shardId}`;

/**
 * Lane command key. Keyed by the sweep **table name** and cursor — not the
 * table index — so a key minted here is byte-identical to the one the
 * caller re-derives for the same logical position when it checkpoints
 * (`application/identity/pruneExpiredAuthState.ts`); a Queue outbox can
 * therefore dedupe across both mints.
 */
const commandKeyOf = (
  runId: string,
  lane: Pick<MaintenanceLaneRow, "generation" | "shardId" | "cursor">,
  table: string,
): string =>
  `${runId}:${lane.generation}:${lane.shardId}:${table}:${lane.cursor ?? ""}`;

/**
 * A lapsed lease means the previous owner is gone (crash, invocation
 * timeout), and `claimLanes` only ever hands out `pending` lanes — so a
 * lane it left `claimed` would never become workable again and the run
 * could never complete. Reclaiming keeps the table position and cursor,
 * so the new owner resumes from the same keyset.
 */
const reclaimLapsedLanes = (
  lanes: readonly MaintenanceLaneRow[],
): readonly MaintenanceLaneRow[] =>
  lanes.map((lane) =>
    lane.status === "claimed" ? { ...lane, status: "pending" } : lane,
  );

const foreignLease = (runId: string): ConflictError =>
  new ConflictError(
    "MAINTENANCE_LEASE_HELD",
    `Run ${runId} is leased by another owner`,
  );

export function createMemoryGlobalMaintenanceRunStore(
  backend: MemoryBackend,
): GlobalMaintenanceRunStore {
  const table = backend.maintenanceRuns;

  const requireLeasedRun = (
    runId: string,
    leaseOwner: string,
  ): MaintenanceRunRow => {
    const run = table.get(runId);
    if (run === undefined || run.status !== "running") {
      throw new ConflictError(
        "MAINTENANCE_RUN_NOT_RUNNING",
        `Run ${runId} does not exist or is not running`,
      );
    }
    if (run.leaseOwner !== leaseOwner) {
      throw foreignLease(runId);
    }
    if (run.leaseUntil.getTime() <= backend.clock.now().getTime()) {
      throw foreignLease(runId);
    }
    return run;
  };

  const replaceLane = (
    run: MaintenanceRunRow,
    lane: MaintenanceLaneRow,
  ): MaintenanceRunRow => ({
    ...run,
    lanes: run.lanes.map((candidate) =>
      laneKey(candidate.generation, candidate.shardId) ===
      laneKey(lane.generation, lane.shardId)
        ? lane
        : candidate,
    ),
  });

  const toLane = (
    run: MaintenanceRunRow,
    lane: MaintenanceLaneRow,
  ): MaintenanceLane => {
    const currentTable = run.tables[lane.tableIndex];
    if (currentTable === undefined) {
      throw new ConflictError(
        "MAINTENANCE_LANE_EXHAUSTED",
        `Lane ${laneKey(lane.generation, lane.shardId)} has no table left`,
      );
    }
    return {
      generation: lane.generation,
      shardId: lane.shardId,
      table: currentTable,
      cursor: lane.cursor,
      asOf: run.asOf,
      commandKey: lane.commandKey,
    };
  };

  return {
    async beginOrResumeKind(input) {
      const now = backend.clock.now();
      const running = table
        .values()
        .find((run) => run.kind === input.kind && run.status === "running");
      if (running !== undefined) {
        const lapsed = running.leaseUntil.getTime() <= now.getTime();
        if (running.leaseOwner !== input.leaseOwner && !lapsed) {
          return {
            runId: running.runId,
            asOf: running.asOf,
            result: "leased" as const,
          };
        }
        table.set(running.runId, {
          ...running,
          leaseOwner: input.leaseOwner,
          leaseUntil: input.leaseUntil,
          // A live lease means the same owner is still working: its
          // in-flight lanes must keep their claim.
          lanes: lapsed ? reclaimLapsedLanes(running.lanes) : running.lanes,
        });
        return {
          runId: running.runId,
          asOf: running.asOf,
          result: "resumed" as const,
        };
      }
      const tables = backend.maintenanceTablesByKind[input.kind];
      const lanes: MaintenanceLaneRow[] = [];
      for (const generation of input.generations) {
        for (const shardId of backend.maintenanceShardIds) {
          const lane: MaintenanceLaneRow = {
            generation,
            shardId,
            status: "pending",
            tableIndex: 0,
            cursor: null,
            commandKey: "",
          };
          lanes.push({
            ...lane,
            commandKey: commandKeyOf(
              input.candidateRunId,
              lane,
              tables[0] ?? "",
            ),
          });
        }
      }
      table.set(input.candidateRunId, {
        runId: input.candidateRunId,
        kind: input.kind,
        status: "running",
        asOf: input.candidateAsOf,
        leaseOwner: input.leaseOwner,
        leaseUntil: input.leaseUntil,
        tables,
        lanes,
        expiresAt: null,
      });
      return {
        runId: input.candidateRunId,
        asOf: input.candidateAsOf,
        result: "started" as const,
      };
    },

    async claimLanes(
      runId: string,
      leaseOwner: string,
      limit: number,
    ): Promise<readonly MaintenanceLane[]> {
      let run = requireLeasedRun(runId, leaseOwner);
      const activeCount = run.lanes.filter(
        (lane) => lane.status === "claimed",
      ).length;
      const capacity = Math.min(
        Math.max(0, limit),
        Math.max(0, MAX_ACTIVE_LANES - activeCount),
      );
      const claimable = run.lanes
        .filter((lane) => lane.status === "pending")
        .slice(0, capacity);
      const claimed: MaintenanceLane[] = [];
      for (const lane of claimable) {
        const next: MaintenanceLaneRow = { ...lane, status: "claimed" };
        run = replaceLane(run, next);
        claimed.push(toLane(run, next));
      }
      table.set(runId, run);
      return claimed;
    },

    async checkpointLane(input): Promise<void> {
      const run = requireLeasedRun(input.runId, input.leaseOwner);
      const lane = run.lanes.find(
        (candidate) =>
          candidate.generation === input.generation &&
          candidate.shardId === input.shardId,
      );
      if (lane === undefined || lane.status !== "claimed") {
        throw new ConflictError(
          "MAINTENANCE_LANE_NOT_CLAIMED",
          `Lane ${laneKey(input.generation, input.shardId)} is not claimed`,
        );
      }
      if (run.tables[lane.tableIndex] !== input.table) {
        throw new ConflictError(
          "MAINTENANCE_LANE_TABLE_MISMATCH",
          `Lane is at ${run.tables[lane.tableIndex]}, not ${input.table}`,
        );
      }
      table.set(
        input.runId,
        replaceLane(run, {
          ...lane,
          cursor: input.cursor,
          commandKey: input.nextCommandKey,
        }),
      );
    },

    async advanceOrAck(input) {
      let run = requireLeasedRun(input.runId, input.leaseOwner);
      const lane = run.lanes.find(
        (candidate) =>
          candidate.generation === input.generation &&
          candidate.shardId === input.shardId,
      );
      if (lane === undefined || lane.status !== "claimed") {
        throw new ConflictError(
          "MAINTENANCE_LANE_NOT_CLAIMED",
          `Lane ${laneKey(input.generation, input.shardId)} is not claimed`,
        );
      }
      if (!input.completed) {
        table.set(
          input.runId,
          replaceLane(run, { ...lane, status: "pending" }),
        );
        return { next: null, runCompleted: false };
      }
      if (lane.tableIndex + 1 < run.tables.length) {
        const advanced: MaintenanceLaneRow = {
          ...lane,
          tableIndex: lane.tableIndex + 1,
          cursor: null,
        };
        run = replaceLane(run, {
          ...advanced,
          commandKey: commandKeyOf(
            run.runId,
            advanced,
            run.tables[advanced.tableIndex] ?? "",
          ),
        });
        table.set(input.runId, run);
        return {
          next: { generation: lane.generation, shardId: lane.shardId },
          runCompleted: false,
        };
      }
      run = replaceLane(run, { ...lane, status: "done" });
      const nextPending = run.lanes.find(
        (candidate) => candidate.status === "pending",
      );
      if (nextPending !== undefined) {
        run = replaceLane(run, { ...nextPending, status: "claimed" });
        table.set(input.runId, run);
        return {
          next: {
            generation: nextPending.generation,
            shardId: nextPending.shardId,
          },
          runCompleted: false,
        };
      }
      const runCompleted = run.lanes.every(
        (candidate) => candidate.status === "done",
      );
      if (runCompleted) {
        const now = backend.clock.now();
        run = {
          ...run,
          status: "completed",
          expiresAt: new Date(now.getTime() + COMPLETED_RETENTION_MS),
        };
      }
      table.set(input.runId, run);
      return { next: null, runCompleted };
    },

    async recoverLease(
      runId: string,
      leaseOwner: string,
      leaseUntil: Date,
    ): Promise<boolean> {
      const run = table.get(runId);
      if (run === undefined || run.status !== "running") {
        return false;
      }
      const now = backend.clock.now();
      const lapsed = run.leaseUntil.getTime() <= now.getTime();
      if (run.leaseOwner !== leaseOwner && !lapsed) {
        return false;
      }
      table.set(runId, {
        ...run,
        leaseOwner,
        leaseUntil,
        // Extending a live lease is a heartbeat by the working owner;
        // only a lapsed lease releases the abandoned claims.
        lanes: lapsed ? reclaimLapsedLanes(run.lanes) : run.lanes,
      });
      return true;
    },

    async pruneCompleted(
      expiresAtOrBefore: Date,
      cursor: string | null,
      limit: number,
    ) {
      const effectiveLimit = Math.min(Math.max(0, limit), PRUNE_PAGE_LIMIT);
      // `(expiresAt, runId)` keyset, encoded `${expiresAtISO} ${runId}`.
      const keysetOf = (run: MaintenanceRunRow): string =>
        `${(run.expiresAt ?? new Date(0)).toISOString()} ${run.runId}`;
      const reclaimable = table
        .values()
        .filter(
          (run) =>
            run.status === "completed" &&
            run.expiresAt !== null &&
            run.expiresAt.getTime() <= expiresAtOrBefore.getTime() &&
            (cursor === null || keysetOf(run) > cursor),
        )
        .sort((a, b) => compareStrings(keysetOf(a), keysetOf(b)));
      const page = reclaimable.slice(0, effectiveLimit);
      for (const run of page) {
        table.delete(run.runId);
      }
      const last = page[page.length - 1];
      return {
        removed: page.length,
        nextCursor:
          reclaimable.length > page.length && last !== undefined
            ? keysetOf(last)
            : null,
      };
    },
  };
}
