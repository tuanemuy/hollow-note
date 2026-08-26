import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../../application/errors";
import { UuidV7Generator } from "../../../application/ports/idGenerator";
import type { SessionId, UserId } from "../../../domain/identity/valueObject";
import { createTestClock } from "../../conformance/testClock";
import { createD1AccountDeletionManifestStore } from "../d1/repositories/accountDeletionManifestStore";
import { createD1DistributedOperationStore } from "../d1/repositories/distributedOperationStore";
import { createD1GlobalMaintenanceRunStore } from "../d1/repositories/globalMaintenanceRunStore";
import { createD1IdentityUniqueDirectory } from "../d1/repositories/identityUniqueDirectory";
import { createD1LoginAttemptStore } from "../d1/repositories/loginAttemptStore";
import { createD1SessionRepository } from "../d1/repositories/sessionRepository";
import { GLOBAL_TABLES, GLOBAL_WIPE_STATEMENTS } from "../d1/schema";
import { createD1Executor } from "../sql/executor";
import { createAutocommitSession, type SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * Two writers that both read the same control-plane row and then both
 * write.
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
 *
 * Every store here is built over `createAutocommitSession`, and that is
 * the only shape in which a guard defeat reaches the repository at all:
 * a staged `write` merely buffers the mutation, so inside a unit of work
 * the loss surfaces at commit as the default translation
 * (`OPTIMISTIC_LOCK_FAILURE`) instead. The re-read each store runs on a
 * guard defeat — and the answers pinned below — therefore describe the
 * autocommit form. `AccountDeletionManifestStore.writeHeader` and
 * `DistributedOperationStore.beginOrResume` have no autocommit caller in
 * the app wiring today, so this file is where their loser's answer lives.
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

  const seedSession = (id: string, authEpoch: number): Promise<void> =>
    executor.apply([
      statement(
        `INSERT INTO ${GLOBAL_TABLES.sessions}
           (id, user_id, token_hash, auth_epoch, created_at, expires_at)
         VALUES (?, 'user-a', ?, ?, ?, ?)`,
        id,
        `hash-${id}`,
        authEpoch,
        T0.getTime(),
        T0.getTime() + HOUR_MS,
      ),
    ]);

  beforeEach(async () => {
    clock.set(T0);
    await executor.apply(GLOBAL_WIPE_STATEMENTS.map((sql) => statement(sql)));
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

  it("treats a concurrent replay of the same activation as done", async () => {
    await seedUser("user-a");
    const directory = createD1IdentityUniqueDirectory(deps);
    await directory.reserve({
      kind: "handle",
      normalizedKey: "bob",
      userId: "user-a" as UserId,
      operationId: "op-a",
      expiresAt: new Date(T0.getTime() + HOUR_MS),
    });

    const observed = createD1IdentityUniqueDirectory({
      ...deps,
      session: interposeOnce(session, () => directory.activate("op-a", 0)),
    });

    await expect(observed.activate("op-a", 0)).resolves.toBeUndefined();

    expect(await directory.resolveClaim("handle", "bob")).toEqual({
      userId: "user-a",
      claimToken: expect.any(String),
    });
    const rows = await executor.query(
      statement(
        `SELECT state, user_version FROM ${GLOBAL_TABLES.identityUniqueReservations}`,
      ),
    );
    expect(rows).toEqual([{ state: "active", user_version: 0 }]);
  });

  it("stays silent when a teardown loses the claim it observed", async () => {
    await seedUser("user-a");
    const directory = createD1IdentityUniqueDirectory(deps);
    await directory.reserve({
      kind: "handle",
      normalizedKey: "carol",
      userId: "user-a" as UserId,
      operationId: "op-claim",
      expiresAt: new Date(T0.getTime() + HOUR_MS),
    });
    await directory.activate("op-claim", 0);
    const claim = await directory.resolveClaim("handle", "carol");
    if (claim === null) {
      throw new Error("expected an active claim");
    }

    const teardown = (operationId: string) => ({
      kind: "handle" as const,
      normalizedKey: "carol",
      expectedUserId: "user-a" as UserId,
      expectedClaimToken: claim.claimToken,
      operationId,
    });
    const observed = createD1IdentityUniqueDirectory({
      ...deps,
      session: interposeOnce(session, () =>
        directory.beginRelease(teardown("op-rival")),
      ),
    });

    await expect(
      observed.beginRelease(teardown("op-observed")),
    ).resolves.toBeUndefined();

    const rows = await executor.query(
      statement(
        `SELECT state, operation_id FROM ${GLOBAL_TABLES.identityUniqueReservations}`,
      ),
    );
    expect(rows).toEqual([{ state: "releasing", operation_id: "op-rival" }]);
  });

  it("spares the session an epoch refresh rescued mid-sweep", async () => {
    await seedUser("user-a");
    await seedSession("session-stale", 0);
    await seedSession("session-current", 0);
    const repository = createD1SessionRepository({ session });

    const sweeping = createD1SessionRepository({
      session: interposeOnce(session, () =>
        repository.refreshAuthEpoch(
          "session-current" as SessionId,
          "user-a" as UserId,
          1,
        ),
      ),
    });
    await sweeping.deleteOlderEpochByUser("user-a" as UserId, 1, 10);

    const rows = await executor.query(
      statement(`SELECT id FROM ${GLOBAL_TABLES.sessions} ORDER BY id`),
    );
    expect(rows.map((row) => row.id)).toEqual(["session-current"]);
  });

  it("spares a login attempt whose ttl a failure extended mid-sweep", async () => {
    const key = "ip:198.51.100.7";
    const store = createD1LoginAttemptStore(deps);
    await store.recordFailure(key, T0, HOUR_MS);

    clock.advance(HOUR_MS + 1);
    const now = clock.now();
    const sweeping = createD1LoginAttemptStore({
      ...deps,
      session: interposeOnce(session, () =>
        store.recordFailure(key, now, HOUR_MS),
      ),
    });
    await sweeping.deleteExpired(now, null, 10);

    expect(await store.get(key)).toEqual({
      key,
      failureCount: 1,
      lastFailedAt: now,
    });
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

  it("settles a crossed header transition on the status that landed", async () => {
    const store = createD1AccountDeletionManifestStore({ session, clock });
    await store.begin("op-twice", "user-a" as UserId);

    const observed = createD1AccountDeletionManifestStore({
      session: interposeOnce(session, () => store.markBuilt("op-twice")),
      clock,
    });

    await expect(observed.markBuilt("op-twice")).resolves.toBeUndefined();
    expect((await store.describe("op-twice"))?.status).toBe("built");
  });

  it("refuses to complete a manifest that was rolled back under it", async () => {
    const settled = { requiredFinalizeReceipts: [], clock } as const;
    const store = createD1AccountDeletionManifestStore({ ...settled, session });
    await store.begin("op-fork", "user-a" as UserId);
    await store.markBuilt("op-fork");

    const observed = createD1AccountDeletionManifestStore({
      ...settled,
      session: interposeOnce(session, () => store.beginRollback("op-fork")),
    });

    expect(
      await conflictCode(
        observed.markCompleted("op-fork", T0, new Date(T0.getTime() + HOUR_MS)),
      ),
    ).toBe("ACCOUNT_DELETION_MANIFEST_STATE_VIOLATION");

    const header = await store.describe("op-fork");
    expect(header?.status).toBe("rollingBack");
    expect(header?.terminalAt).toBeNull();
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

  it("resumes the operation a crossed replay of the same request created", async () => {
    const begin = (by: string, on: SqlSession) =>
      createD1DistributedOperationStore({
        ...deps,
        session: on,
      }).beginOrResume({
        kind: "accountDeletion",
        partitionKey: "user-2",
        requestKey: "request-same",
        payload: { by },
      });

    const observed = await begin(
      "observed",
      interposeOnce(session, () => begin("rival", session)),
    );

    expect(observed.resumed).toBe(true);
    expect(observed.operation.payload).toEqual({ by: "rival" });
    expect(await countRows(GLOBAL_TABLES.distributedOperations)).toBe(1);
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
