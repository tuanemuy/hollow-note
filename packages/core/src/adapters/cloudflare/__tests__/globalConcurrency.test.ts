import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../../application/errors";
import { UuidV7Generator } from "../../../application/ports/idGenerator";
import type { UserId } from "../../../domain/identity/valueObject";
import { createTestClock } from "../../conformance/testClock";
import { createD1AccountDeletionManifestStore } from "../d1/repositories/accountDeletionManifestStore";
import { createD1DistributedOperationStore } from "../d1/repositories/distributedOperationStore";
import { createD1GlobalMaintenanceRunStore } from "../d1/repositories/globalMaintenanceRunStore";
import { createD1IdentityUniqueDirectory } from "../d1/repositories/identityUniqueDirectory";
import { GLOBAL_TABLES } from "../d1/schema";
import { createD1Executor } from "../sql/executor";
import { createAutocommitSession, type SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * AC-4, the control-plane half: two writers that both read the same row
 * and then both write.
 *
 * The memory backend serialises a unit of work, so the shared conformance
 * suites cannot reach this at all — which is exactly why it belongs here.
 * Every case pins the loser's answer, not just the winner's: a guard that
 * aborts the batch is only useful if the caller can tell what happened.
 *
 * The race is staged rather than hoped for. `interposeOnce` runs the
 * rival writer *between* the observed writer's read and its apply, which
 * is the one interleaving the `_occ_guard` exists for; a bare
 * `Promise.all` would just as often serialise into the read-path answer.
 */

const T0 = new Date("2026-08-26T00:00:00.000Z");
const LEASE_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const SHARDS = ["shard-0"] as const;
const SWEEP_TABLES = {
  authStatePrune: ["auth_tokens", "sessions"],
  jobTombstonePrune: ["job_tombstones"],
  accountManifestPrune: ["account_deletion_manifests"],
} as const;

/** A session whose next `write` lets `rival` commit first. */
const interposeOnce = (
  session: SqlSession,
  rival: () => Promise<unknown>,
): SqlSession => {
  let pending = true;
  return {
    ...session,
    async write(mutations) {
      if (pending) {
        pending = false;
        await rival();
      }
      await session.write(mutations);
    },
  };
};

const conflictCode = async (call: Promise<unknown>): Promise<string> => {
  try {
    await call;
  } catch (error) {
    if (error instanceof ConflictError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected a ConflictError");
};

describe("cloudflare global control-plane concurrency", () => {
  const clock = createTestClock(T0);
  const executor = createD1Executor(env.GLOBAL_DB);
  const session = createAutocommitSession(executor);
  const deps = { session, clock, idGenerator: UuidV7Generator };
  const maintenanceDeps = {
    ...deps,
    maintenanceShardIds: SHARDS,
    maintenanceTablesByKind: SWEEP_TABLES,
  };

  const countRows = async (table: string, where = ""): Promise<number> => {
    const rows = await executor.query(
      statement(`SELECT COUNT(*) AS n FROM ${table} ${where}`),
    );
    return Number(rows[0]?.n ?? 0);
  };

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  const seedUser = (id: string): Promise<void> =>
    executor.apply([
      statement(
        `INSERT INTO ${GLOBAL_TABLES.users}
           (id, status, auth_epoch, version, created_at, updated_at)
         VALUES (?, 'pending', 0, 0, ?, ?)`,
        id,
        T0.getTime(),
        T0.getTime(),
      ),
    ]);

  beforeEach(async () => {
    clock.set(T0);
    await env.GLOBAL_DB.batch(
      [
        GLOBAL_TABLES.identityUniqueReservations,
        GLOBAL_TABLES.distributedOperations,
        GLOBAL_TABLES.globalMaintenanceRunLanes,
        GLOBAL_TABLES.globalMaintenanceRuns,
        GLOBAL_TABLES.accountDeletionManifests,
        GLOBAL_TABLES.users,
      ].map((table) => env.GLOBAL_DB.prepare(`DELETE FROM ${table}`)),
    );
  });

  it("gives a contested uniqueness key to exactly one reserver", async () => {
    const expiresAt = new Date(T0.getTime() + HOUR_MS);
    const rival = () =>
      createD1IdentityUniqueDirectory(deps).reserve({
        kind: "email",
        normalizedKey: "taken@example.com",
        userId: "user-rival" as UserId,
        operationId: "op-rival",
        expiresAt,
      });
    const observed = createD1IdentityUniqueDirectory({
      ...deps,
      session: interposeOnce(session, rival),
    });

    expect(
      await conflictCode(
        observed.reserve({
          kind: "email",
          normalizedKey: "taken@example.com",
          userId: "user-observed" as UserId,
          operationId: "op-observed",
          expiresAt,
        }),
      ),
    ).toBe("EMAIL_ALREADY_USED");

    expect(await countRows(GLOBAL_TABLES.identityUniqueReservations)).toBe(1);
    expect(
      await createD1IdentityUniqueDirectory(deps).resolveClaim(
        "email",
        "taken@example.com",
      ),
    ).toBeNull();
    const rows = await executor.query(
      statement(
        `SELECT operation_id FROM ${GLOBAL_TABLES.identityUniqueReservations}`,
      ),
    );
    expect(rows[0]?.operation_id).toBe("op-rival");
  });

  it("refuses to activate a lapsed reservation another operation took over", async () => {
    await seedUser("user-a");
    await seedUser("user-b");
    await createD1IdentityUniqueDirectory(deps).reserve({
      kind: "handle",
      normalizedKey: "alice",
      userId: "user-a" as UserId,
      operationId: "op-a",
      expiresAt: new Date(T0.getTime() + HOUR_MS),
    });

    clock.advance(HOUR_MS + 1);
    const now = clock.now();
    const rival = () =>
      createD1IdentityUniqueDirectory(deps).reserve({
        kind: "handle",
        normalizedKey: "alice",
        userId: "user-b" as UserId,
        operationId: "op-b",
        expiresAt: new Date(now.getTime() + HOUR_MS),
      });
    const observed = createD1IdentityUniqueDirectory({
      ...deps,
      session: interposeOnce(session, rival),
    });

    expect(await conflictCode(observed.activate("op-a", 0))).toBe(
      "UNIQUE_RESERVATION_NOT_FOUND",
    );

    const rows = await executor.query(
      statement(
        `SELECT operation_id, user_id, state FROM ${GLOBAL_TABLES.identityUniqueReservations}`,
      ),
    );
    expect(rows).toEqual([
      { operation_id: "op-b", user_id: "user-b", state: "reserved" },
    ]);
    expect(
      await createD1IdentityUniqueDirectory(deps).resolveClaim(
        "handle",
        "alice",
      ),
    ).toBeNull();
  });

  it("keeps both receipts when two finalize acks cross", async () => {
    const store = createD1AccountDeletionManifestStore({ session, clock });
    await store.begin("op-manifest", "user-a" as UserId);

    const observed = createD1AccountDeletionManifestStore({
      session: interposeOnce(session, () =>
        store.acknowledgeReceipt("op-manifest", "uniquenessRelease"),
      ),
      clock,
    });
    await observed.acknowledgeReceipt("op-manifest", "authResidue");

    expect((await store.describe("op-manifest"))?.receipts).toEqual([
      "uniquenessRelease",
      "authResidue",
    ]);
  });

  it("leaves a partition with one running operation when two begin at once", async () => {
    const rival = () =>
      createD1DistributedOperationStore(deps).beginOrResume({
        kind: "accountDeletion",
        partitionKey: "user-1",
        requestKey: "request-rival",
        payload: { by: "rival" },
      });
    const observed = createD1DistributedOperationStore({
      ...deps,
      session: interposeOnce(session, rival),
    });

    expect(
      await conflictCode(
        observed.beginOrResume({
          kind: "accountDeletion",
          partitionKey: "user-1",
          requestKey: "request-observed",
          payload: { by: "observed" },
        }),
      ),
    ).toBe("DISTRIBUTED_OPERATION_ALREADY_RUNNING");

    expect(
      await countRows(
        GLOBAL_TABLES.distributedOperations,
        "WHERE state = 'running'",
      ),
    ).toBe(1);
  });

  it("hands a lapsed maintenance lease to exactly one of two owners", async () => {
    const store = createD1GlobalMaintenanceRunStore(maintenanceDeps);
    const begun = await store.beginOrResumeKind({
      candidateRunId: "run-lapsed",
      kind: "authStatePrune",
      candidateAsOf: T0,
      generations: ["gen-1"],
      leaseOwner: "owner-a",
      leaseUntil: new Date(T0.getTime() + LEASE_MS),
    });
    expect(begun.result).toBe("started");

    clock.advance(LEASE_MS + 1);
    const now = clock.now();
    const resume = (leaseOwner: string, on: SqlSession) =>
      createD1GlobalMaintenanceRunStore({
        ...maintenanceDeps,
        session: on,
      }).beginOrResumeKind({
        candidateRunId: "run-lapsed",
        kind: "authStatePrune",
        candidateAsOf: now,
        generations: ["gen-1"],
        leaseOwner,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      });

    let takenByC: string | undefined;
    const observed = await resume(
      "owner-b",
      interposeOnce(session, async () => {
        takenByC = (await resume("owner-c", session)).result;
      }),
    );

    expect(takenByC).toBe("resumed");
    expect(observed.result).toBe("leased");
    const rows = await executor.query(
      statement(
        `SELECT lease_owner FROM ${GLOBAL_TABLES.globalMaintenanceRuns} WHERE run_id = ?`,
        "run-lapsed",
      ),
    );
    expect(rows[0]?.lease_owner).toBe("owner-c");
  });

  it("refuses a checkpoint from an owner whose lease was taken", async () => {
    const store = createD1GlobalMaintenanceRunStore(maintenanceDeps);
    await store.beginOrResumeKind({
      candidateRunId: "run-ousted",
      kind: "authStatePrune",
      candidateAsOf: T0,
      generations: ["gen-1"],
      leaseOwner: "owner-a",
      leaseUntil: new Date(T0.getTime() + LEASE_MS),
    });
    const [lane] = await store.claimLanes("run-ousted", "owner-a", 1);
    if (lane === undefined) {
      throw new Error("expected a claimable lane");
    }

    // The lease lapses and `owner-b` reclaims it after `owner-a` read the
    // run but before its checkpoint reaches D1.
    const ousted = createD1GlobalMaintenanceRunStore({
      ...maintenanceDeps,
      session: interposeOnce(session, async () => {
        clock.advance(LEASE_MS + 1);
        const taken = await store.recoverLease(
          "run-ousted",
          "owner-b",
          new Date(clock.now().getTime() + LEASE_MS),
        );
        expect(taken).toBe(true);
      }),
    });

    expect(
      await conflictCode(
        ousted.checkpointLane({
          runId: "run-ousted",
          leaseOwner: "owner-a",
          generation: lane.generation,
          shardId: lane.shardId,
          table: lane.table,
          cursor: "page-2",
          asOf: lane.asOf,
          nextCommandKey: "command-2",
        }),
      ),
    ).toBe("MAINTENANCE_LEASE_HELD");

    const rows = await executor.query(
      statement(
        `SELECT cursor, status FROM ${GLOBAL_TABLES.globalMaintenanceRunLanes} WHERE run_id = ?`,
        "run-ousted",
      ),
    );
    expect(rows[0]?.cursor).toBeNull();
    expect(rows[0]?.status).toBe("unclaimed");
  });

  it("starts a fresh run over a completed one carrying the same id", async () => {
    const store = createD1GlobalMaintenanceRunStore({
      ...maintenanceDeps,
      maintenanceTablesByKind: {
        ...SWEEP_TABLES,
        authStatePrune: ["auth_tokens"],
      },
    });
    const input = {
      candidateRunId: "run-hourly",
      kind: "authStatePrune" as const,
      generations: ["gen-1"],
      leaseOwner: "owner-a",
    };
    await store.beginOrResumeKind({
      ...input,
      candidateAsOf: T0,
      leaseUntil: new Date(T0.getTime() + LEASE_MS),
    });
    const [lane] = await store.claimLanes("run-hourly", "owner-a", 1);
    if (lane === undefined) {
      throw new Error("expected a claimable lane");
    }
    const acked = await store.advanceOrAck({
      runId: "run-hourly",
      leaseOwner: "owner-a",
      generation: lane.generation,
      shardId: lane.shardId,
      completed: true,
    });
    expect(acked.runCompleted).toBe(true);

    // Same hour bucket, so the caller re-derives the same candidate id and
    // meets the retained completed row.
    clock.advance(60_000);
    const again = await store.beginOrResumeKind({
      ...input,
      candidateAsOf: clock.now(),
      leaseUntil: new Date(clock.now().getTime() + LEASE_MS),
    });
    expect(again).toEqual({
      runId: "run-hourly",
      asOf: clock.now(),
      result: "started",
    });
    expect(
      await countRows(
        GLOBAL_TABLES.globalMaintenanceRunLanes,
        "WHERE run_id = 'run-hourly' AND status = 'unclaimed'",
      ),
    ).toBe(1);
  });
});
