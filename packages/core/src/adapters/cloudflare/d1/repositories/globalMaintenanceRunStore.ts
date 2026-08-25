import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type {
  GlobalMaintenanceRunStore,
  MaintenanceKind,
  MaintenanceLane,
} from "../../../../application/ports/globalMaintenanceRunStore";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../../cursor";
import { opaque, upsert } from "../../execution/writeSet";
import { databaseError } from "../../sql/errors";
import {
  deleteRowsFromJson,
  insertRowsFromJson,
  jsonList,
  jsonRows,
} from "../../sql/json";
import {
  compositeKey,
  date,
  enumOf,
  int,
  intOrNull,
  json,
  text,
  textOrNull,
  toJson,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const RUNS = GLOBAL_TABLES.globalMaintenanceRuns;
const LANES = GLOBAL_TABLES.globalMaintenanceRunLanes;

const MAX_ACTIVE_LANES = 6;
const PRUNE_PAGE_LIMIT = 100;
const COMPLETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_CURSOR_FINGERPRINT = "globalMaintenanceRuns.pruneCompleted";

const LANE_STATUSES = ["unclaimed", "active", "completed"] as const;
type LaneStatus = (typeof LANE_STATUSES)[number];

/**
 * Lane command key. Keyed by the sweep **table name** and cursor — not the
 * table index — so a key minted here is byte-identical to the one the
 * caller re-derives for the same logical position when it checkpoints
 * (`application/identity/pruneExpiredAuthState.ts`).
 */
const commandKeyOf = (
  runId: string,
  lane: Readonly<{
    generation: string;
    shardId: string;
    cursor: string | null;
  }>,
  table: string,
): string =>
  `${runId}:${lane.generation}:${lane.shardId}:${table}:${lane.cursor ?? ""}`;

const foreignLease = (runId: string): ConflictError =>
  new ConflictError(
    "MAINTENANCE_LEASE_HELD",
    `Run ${runId} is leased by another owner`,
  );

type Run = Readonly<{
  runId: string;
  kind: MaintenanceKind;
  status: "running" | "completed";
  tables: readonly string[];
  asOf: Date;
  leaseOwner: string;
  leaseUntil: Date;
  raw: SqlRow;
}>;

type Lane = Readonly<{
  generation: string;
  shardId: string;
  status: LaneStatus;
  tableIndex: number;
  cursor: string | null;
  commandKey: string;
  raw: SqlRow;
}>;

const toRun = (row: SqlRow): Run => ({
  runId: text(row, "run_id"),
  kind: enumOf(row, "kind", [
    "authStatePrune",
    "jobTombstonePrune",
    "accountManifestPrune",
  ] as const),
  status: enumOf(row, "status", ["running", "completed"] as const),
  tables: json<readonly string[]>(row, "tables"),
  asOf: date(row, "as_of"),
  leaseOwner: text(row, "lease_owner"),
  leaseUntil: date(row, "lease_until"),
  raw: row,
});

const toLane = (row: SqlRow): Lane => ({
  generation: text(row, "generation"),
  shardId: text(row, "shard_id"),
  status: enumOf(row, "status", LANE_STATUSES),
  tableIndex: int(row, "table_index"),
  cursor: textOrNull(row, "cursor"),
  commandKey: text(row, "command_key"),
  raw: row,
});

const laneRowKey = (
  runId: string,
  generation: string,
  shardId: string,
): string => compositeKey(runId, generation, shardId);

const byLaneOrder = (a: Lane, b: Lane): number =>
  a.generation === b.generation
    ? a.shardId < b.shardId
      ? -1
      : 1
    : a.generation < b.generation
      ? -1
      : 1;

export type D1GlobalMaintenanceRunStoreDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
  /** Shards a run fans out over, per generation. */
  maintenanceShardIds: readonly string[];
  /**
   * The deployment's ordered sweep tables. Read **only** when a run is
   * created; the run row then owns the set for its whole life (ADR 061).
   */
  maintenanceTablesByKind: Readonly<Record<MaintenanceKind, readonly string[]>>;
}>;

/**
 * `global_maintenance_runs` + `global_maintenance_run_lanes` on global D1.
 *
 * A lane holds an **index** into the table set the run row snapshotted,
 * never a table name of its own: resolving a lane's current table always
 * goes through the run row, so a deployment that re-orders its sweep
 * tables mid-run cannot move a lane onto a table whose keyset its cursor
 * does not belong to ([ADR 061](../../../../../spec/adr/061-maintenance-sweep-order-authority.md)).
 */
export function createD1GlobalMaintenanceRunStore(
  deps: D1GlobalMaintenanceRunStoreDeps,
): GlobalMaintenanceRunStore {
  const { session, clock } = deps;

  const readRun = async (runId: string): Promise<Run | null> => {
    const row = await session.readRow({
      table: RUNS,
      key: runId,
      statement: statement(`SELECT * FROM ${RUNS} WHERE run_id = ?`, runId),
    });
    return row === null ? null : toRun(row);
  };

  const readRunningRun = async (kind: MaintenanceKind): Promise<Run | null> => {
    const rows = await session.readRows({
      table: RUNS,
      statement: statement(
        `SELECT * FROM ${RUNS} WHERE kind = ? AND status = 'running'`,
        kind,
      ),
      keyOf: (row) => text(row, "run_id"),
      matches: (row) => row.kind === kind && row.status === "running",
    });
    const row = rows[0];
    return row === undefined ? null : toRun(row);
  };

  const readLanes = async (runId: string): Promise<readonly Lane[]> => {
    const rows = await session.readRows({
      table: LANES,
      statement: statement(
        `SELECT * FROM ${LANES} WHERE run_id = ? ORDER BY generation, shard_id`,
        runId,
      ),
      keyOf: (row) =>
        laneRowKey(
          text(row, "run_id"),
          text(row, "generation"),
          text(row, "shard_id"),
        ),
      matches: (row) => row.run_id === runId,
    });
    return rows.map(toLane).sort(byLaneOrder);
  };

  const requireLeasedRun = async (
    runId: string,
    leaseOwner: string,
  ): Promise<Run> => {
    const run = await readRun(runId);
    if (run === null || run.status !== "running") {
      throw new ConflictError(
        "MAINTENANCE_RUN_NOT_RUNNING",
        `Run ${runId} does not exist or is not running`,
      );
    }
    if (
      run.leaseOwner !== leaseOwner ||
      run.leaseUntil.getTime() <= clock.now().getTime()
    ) {
      throw foreignLease(runId);
    }
    return run;
  };

  const tableAt = (run: Run, index: number): string => {
    const table = run.tables[index];
    if (table === undefined) {
      throw new ConflictError(
        "MAINTENANCE_LANE_EXHAUSTED",
        `Run ${run.runId} has no table at position ${index}`,
      );
    }
    return table;
  };

  const projectLane = (run: Run, lane: Lane): MaintenanceLane => ({
    generation: lane.generation,
    shardId: lane.shardId,
    table: tableAt(run, lane.tableIndex),
    cursor: lane.cursor,
    asOf: run.asOf,
    commandKey: lane.commandKey,
  });

  const laneUpdate = (
    runId: string,
    lane: Lane,
    changes: Readonly<{
      status?: LaneStatus;
      tableIndex?: number;
      cursor?: string | null;
      commandKey?: string;
    }>,
  ) => {
    const status = changes.status ?? lane.status;
    const tableIndex = changes.tableIndex ?? lane.tableIndex;
    const cursor = changes.cursor === undefined ? lane.cursor : changes.cursor;
    const commandKey = changes.commandKey ?? lane.commandKey;
    return upsert({
      table: LANES,
      key: laneRowKey(runId, lane.generation, lane.shardId),
      row: {
        ...lane.raw,
        status,
        table_index: tableIndex,
        cursor,
        command_key: commandKey,
      },
      statement: statement(
        `UPDATE ${LANES} SET status = ?, table_index = ?, cursor = ?, command_key = ?
           WHERE run_id = ? AND generation = ? AND shard_id = ?`,
        status,
        tableIndex,
        cursor,
        commandKey,
        runId,
        lane.generation,
        lane.shardId,
      ),
    });
  };

  /**
   * A lapsed lease means the previous owner is gone, and `claimLanes` only
   * ever hands out unclaimed lanes — so a lane it left active would never
   * become workable again and the run could never complete. The table
   * position and cursor stay put, so the new owner resumes from the same
   * keyset.
   */
  const reclaimLapsedLanes = (runId: string) =>
    opaque(
      statement(
        `UPDATE ${LANES} SET status = 'unclaimed' WHERE run_id = ? AND status = 'active'`,
        runId,
      ),
    );

  return {
    async beginOrResumeKind(input) {
      const now = clock.now();
      const running = await readRunningRun(input.kind);
      if (running !== null) {
        const lapsed = running.leaseUntil.getTime() <= now.getTime();
        if (running.leaseOwner !== input.leaseOwner && !lapsed) {
          return {
            runId: running.runId,
            asOf: running.asOf,
            result: "leased" as const,
          };
        }
        try {
          await session.write([
            upsert({
              table: RUNS,
              key: running.runId,
              row: {
                ...running.raw,
                lease_owner: input.leaseOwner,
                lease_until: toTimestamp(input.leaseUntil),
              },
              statement: statement(
                `UPDATE ${RUNS} SET lease_owner = ?, lease_until = ? WHERE run_id = ?`,
                input.leaseOwner,
                toTimestamp(input.leaseUntil),
                running.runId,
              ),
            }),
            ...(lapsed ? [reclaimLapsedLanes(running.runId)] : []),
          ]);
        } catch (cause) {
          throw databaseError("the global maintenance run store", cause);
        }
        return {
          runId: running.runId,
          asOf: running.asOf,
          result: "resumed" as const,
        };
      }

      const tables = deps.maintenanceTablesByKind[input.kind];
      const lanes = input.generations.flatMap((generation) =>
        deps.maintenanceShardIds.map((shardId) => ({
          run_id: input.candidateRunId,
          generation,
          shard_id: shardId,
          status: "unclaimed",
          table_index: 0,
          cursor: null,
          command_key: commandKeyOf(
            input.candidateRunId,
            { generation, shardId, cursor: null },
            tables[0] ?? "",
          ),
        })),
      );
      try {
        await session.write([
          upsert({
            table: RUNS,
            key: input.candidateRunId,
            row: {
              run_id: input.candidateRunId,
              kind: input.kind,
              status: "running",
              tables: toJson(tables),
              as_of: toTimestamp(input.candidateAsOf),
              lease_owner: input.leaseOwner,
              lease_until: toTimestamp(input.leaseUntil),
              completed_at: null,
              expires_at: null,
            },
            statement: statement(
              `INSERT INTO ${RUNS}
                 (run_id, kind, status, tables, as_of, lease_owner, lease_until, completed_at, expires_at)
               VALUES (?, ?, 'running', ?, ?, ?, ?, NULL, NULL)`,
              input.candidateRunId,
              input.kind,
              toJson(tables),
              toTimestamp(input.candidateAsOf),
              input.leaseOwner,
              toTimestamp(input.leaseUntil),
            ),
          }),
          ...(lanes.length === 0
            ? []
            : [
                opaque(
                  statement(
                    insertRowsFromJson({
                      table: LANES,
                      columns: [
                        "run_id",
                        "generation",
                        "shard_id",
                        "status",
                        "table_index",
                        "cursor",
                        "command_key",
                      ],
                      conflictKey: ["run_id", "generation", "shard_id"],
                      conflict: "ignore",
                    }),
                    jsonRows(lanes),
                  ),
                ),
              ]),
        ]);
      } catch (cause) {
        throw databaseError("the global maintenance run store", cause);
      }
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
      const run = await requireLeasedRun(runId, leaseOwner);
      const lanes = await readLanes(runId);
      const active = lanes.filter((lane) => lane.status === "active").length;
      const capacity = Math.min(
        Math.max(0, Math.trunc(limit)),
        Math.max(0, MAX_ACTIVE_LANES - active),
      );
      const claimable = lanes
        .filter((lane) => lane.status === "unclaimed")
        .slice(0, capacity);
      if (claimable.length === 0) {
        return [];
      }
      try {
        await session.write(
          claimable.map((lane) =>
            laneUpdate(runId, lane, { status: "active" }),
          ),
        );
      } catch (cause) {
        throw databaseError("the global maintenance run store", cause);
      }
      return claimable.map((lane) => projectLane(run, lane));
    },

    async checkpointLane(input): Promise<void> {
      const run = await requireLeasedRun(input.runId, input.leaseOwner);
      const lanes = await readLanes(input.runId);
      const lane = lanes.find(
        (candidate) =>
          candidate.generation === input.generation &&
          candidate.shardId === input.shardId,
      );
      if (lane === undefined || lane.status !== "active") {
        throw new ConflictError(
          "MAINTENANCE_LANE_NOT_CLAIMED",
          `Lane ${input.generation}/${input.shardId} is not claimed`,
        );
      }
      if (tableAt(run, lane.tableIndex) !== input.table) {
        throw new ConflictError(
          "MAINTENANCE_LANE_TABLE_MISMATCH",
          `Lane is at ${tableAt(run, lane.tableIndex)}, not ${input.table}`,
        );
      }
      try {
        await session.write([
          laneUpdate(input.runId, lane, {
            cursor: input.cursor,
            commandKey: input.nextCommandKey,
          }),
        ]);
      } catch (cause) {
        throw databaseError("the global maintenance run store", cause);
      }
    },

    async advanceOrAck(input) {
      const run = await requireLeasedRun(input.runId, input.leaseOwner);
      const lanes = await readLanes(input.runId);
      const lane = lanes.find(
        (candidate) =>
          candidate.generation === input.generation &&
          candidate.shardId === input.shardId,
      );
      if (lane === undefined || lane.status !== "active") {
        throw new ConflictError(
          "MAINTENANCE_LANE_NOT_CLAIMED",
          `Lane ${input.generation}/${input.shardId} is not claimed`,
        );
      }

      const write = async (
        mutations: Parameters<SqlSession["write"]>[0],
      ): Promise<void> => {
        try {
          await session.write(mutations);
        } catch (cause) {
          throw databaseError("the global maintenance run store", cause);
        }
      };

      if (!input.completed) {
        // A release only puts the lane back: every call site drops this
        // return value, so a lane handed back here would stay claimed with
        // nobody driving it until the lease lapses.
        await write([laneUpdate(input.runId, lane, { status: "unclaimed" })]);
        return { next: null, runCompleted: false };
      }

      const nextIndex = lane.tableIndex + 1;
      if (nextIndex < run.tables.length) {
        const stepped: Lane = {
          ...lane,
          tableIndex: nextIndex,
          cursor: null,
          commandKey: commandKeyOf(
            run.runId,
            {
              generation: lane.generation,
              shardId: lane.shardId,
              cursor: null,
            },
            tableAt(run, nextIndex),
          ),
        };
        await write([
          laneUpdate(input.runId, lane, {
            tableIndex: stepped.tableIndex,
            cursor: null,
            commandKey: stepped.commandKey,
          }),
        ]);
        return { next: projectLane(run, stepped), runCompleted: false };
      }

      const pending = lanes.find(
        (candidate) =>
          candidate.status === "unclaimed" &&
          !(
            candidate.generation === lane.generation &&
            candidate.shardId === lane.shardId
          ),
      );
      if (pending !== undefined) {
        // An existing position: its stored table, cursor and command key
        // come back untouched. Re-minting the key here would part it from
        // the continuation the caller already queued under it.
        await write([
          laneUpdate(input.runId, lane, { status: "completed" }),
          laneUpdate(input.runId, pending, { status: "active" }),
        ]);
        return { next: projectLane(run, pending), runCompleted: false };
      }

      const runCompleted = lanes.every(
        (candidate) =>
          candidate.status === "completed" ||
          (candidate.generation === lane.generation &&
            candidate.shardId === lane.shardId),
      );
      const now = clock.now();
      await write([
        laneUpdate(input.runId, lane, { status: "completed" }),
        ...(runCompleted
          ? [
              upsert({
                table: RUNS,
                key: run.runId,
                row: {
                  ...run.raw,
                  status: "completed",
                  completed_at: toTimestamp(now),
                  expires_at: now.getTime() + COMPLETED_RETENTION_MS,
                },
                statement: statement(
                  `UPDATE ${RUNS} SET status = 'completed', completed_at = ?, expires_at = ? WHERE run_id = ?`,
                  toTimestamp(now),
                  now.getTime() + COMPLETED_RETENTION_MS,
                  run.runId,
                ),
              }),
            ]
          : []),
      ]);
      return { next: null, runCompleted };
    },

    async recoverLease(
      runId: string,
      leaseOwner: string,
      leaseUntil: Date,
    ): Promise<boolean> {
      const run = await readRun(runId);
      if (run === null || run.status !== "running") {
        return false;
      }
      const lapsed = run.leaseUntil.getTime() <= clock.now().getTime();
      if (run.leaseOwner !== leaseOwner && !lapsed) {
        return false;
      }
      try {
        await session.write([
          upsert({
            table: RUNS,
            key: runId,
            row: {
              ...run.raw,
              lease_owner: leaseOwner,
              lease_until: toTimestamp(leaseUntil),
            },
            statement: statement(
              `UPDATE ${RUNS} SET lease_owner = ?, lease_until = ? WHERE run_id = ?`,
              leaseOwner,
              toTimestamp(leaseUntil),
              runId,
            ),
          }),
          // Extending a live lease is a heartbeat by the working owner;
          // only a lapsed lease releases the abandoned claims.
          ...(lapsed ? [reclaimLapsedLanes(runId)] : []),
        ]);
      } catch (cause) {
        throw databaseError("the global maintenance run store", cause);
      }
      return true;
    },

    async pruneCompleted(
      expiresAtOrBefore: Date,
      cursor: string | null,
      limit: number,
    ): Promise<Readonly<{ removed: number; nextCursor: string | null }>> {
      const effectiveLimit = Math.min(
        Math.max(0, Math.trunc(limit)),
        PRUNE_PAGE_LIMIT,
      );
      if (effectiveLimit === 0) {
        return { removed: 0, nextCursor: null };
      }
      const after =
        cursor === null
          ? null
          : decodeOpaqueCursor(cursor, PRUNE_CURSOR_FINGERPRINT).after;
      const [afterExpiresAt, afterRunId] =
        after === null ? [null, null] : splitKeyset(after);
      const rows = await session.query(
        statement(
          `SELECT run_id, expires_at FROM ${RUNS}
             WHERE status = 'completed' AND expires_at IS NOT NULL AND expires_at <= ?
               AND (? IS NULL OR expires_at > ? OR (expires_at = ? AND run_id > ?))
             ORDER BY expires_at, run_id
             LIMIT ${effectiveLimit + 1}`,
          toTimestamp(expiresAtOrBefore),
          afterExpiresAt,
          afterExpiresAt,
          afterExpiresAt,
          afterRunId,
        ),
      );
      const page = rows.slice(0, effectiveLimit);
      if (page.length === 0) {
        return { removed: 0, nextCursor: null };
      }
      const runIds = page.map((row) => text(row, "run_id"));
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > page.length && last !== undefined
          ? encodeOpaqueCursor({
              fp: PRUNE_CURSOR_FINGERPRINT,
              after: `${intOrNull(last, "expires_at") ?? 0} ${text(last, "run_id")}`,
            })
          : null;
      try {
        await session.write([
          opaque(
            statement(deleteRowsFromJson(LANES, "run_id"), jsonList(runIds)),
          ),
          opaque(
            statement(deleteRowsFromJson(RUNS, "run_id"), jsonList(runIds)),
          ),
        ]);
      } catch (cause) {
        throw databaseError("the global maintenance run store", cause);
      }
      return { removed: page.length, nextCursor };
    },
  };
}

const splitKeyset = (after: string): readonly [number, string] => {
  const separator = after.indexOf(" ");
  return [
    Number(after.slice(0, separator)),
    after.slice(separator + 1),
  ] as const;
};
