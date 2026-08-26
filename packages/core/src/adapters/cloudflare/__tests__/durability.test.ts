import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GlobalUnitOfWorkContext } from "../../../application/execution/unitOfWork";
import { ScopeKey } from "../../../application/scope";
import { type DomainEvent, EventId } from "../../../domain/common/event";
import type { UserId } from "../../../domain/identity/valueObject";
import { GLOBAL_TABLES, GLOBAL_WIPE_STATEMENTS } from "../d1/schema";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import {
  createGlobalUnitOfWorkProvider,
  type GlobalPlaneRepositories,
} from "../execution/globalUnitOfWork";
import { opaque } from "../execution/writeSet";
import { createD1Executor } from "../sql/executor";
import type { SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * What survives a write that the driver refuses **partway through**.
 *
 * `unitOfWork.test.ts` covers the callback that throws before a commit is
 * ever attempted; the interesting case is the other one, where the batch
 * is handed over intact and SQLite rejects a statement in the middle of
 * it. Both planes claim atomicity from a different mechanism — D1 from
 * `batch()`, the scope object from `ctx.storage.transactionSync` — and
 * neither claim is worth anything unless the store is read back
 * afterwards, so every case here ends by reading it.
 */

const NAMESPACE = "durability";
const NOW = new Date("2026-08-26T00:00:00.000Z");

const insertUser = (id: string, status = "pending") =>
  statement(
    `INSERT INTO ${GLOBAL_TABLES.users} (id, status, auth_epoch, version, created_at, updated_at)
     VALUES (?, ?, 0, 0, ?, ?)`,
    id,
    status,
    NOW.getTime(),
    NOW.getTime(),
  );

/** Trips the `status IN (...)` CHECK, which is not a key conflict — so
 * nothing about the failure depends on the row already existing. */
const REFUSED_STATUS = "not-a-status";

const insertTask = (operationId: string, status = "pending") =>
  statement(
    `INSERT INTO ${SCHEDULED_TASKS_TABLE}
       (kind, operation_id, due_at, payload, attempts, last_error, priority, status, lease_expires_at)
     VALUES ('test.kind', ?, ?, '{}', 0, NULL, 0, ?, NULL)`,
    operationId,
    NOW.getTime(),
    status,
  );

describe("cloudflare atomicity under a refused statement", () => {
  const executor = createD1Executor(env.GLOBAL_DB);

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  beforeEach(async () => {
    await env.GLOBAL_DB.batch(
      GLOBAL_WIPE_STATEMENTS.map((sql) => env.GLOBAL_DB.prepare(sql)),
    );
  });

  const storedUsers = async (): Promise<readonly string[]> => {
    const rows = await env.GLOBAL_DB.prepare(
      `SELECT id FROM ${GLOBAL_TABLES.users} ORDER BY id`,
    ).all<{ id: string }>();
    return rows.results.map((row) => row.id);
  };

  it("keeps no part of a D1 batch whose middle statement is refused", async () => {
    await expect(
      executor.apply([
        insertUser("user-1"),
        insertUser("user-2", REFUSED_STATUS),
        insertUser("user-3"),
      ]),
    ).rejects.toThrow();

    // The statement before the failure is the one a non-atomic driver
    // would leave behind.
    expect(await storedUsers()).toEqual([]);
  });

  it("keeps no part of a global unit of work whose commit is refused", async () => {
    let relayKicks = 0;
    const provider = createGlobalUnitOfWorkProvider({
      executor,
      mintEventId: () => EventId.create("event-refused"),
      buildRepositories: (session: SqlSession) =>
        ({
          stage: (input: Parameters<typeof opaque>[0]) =>
            session.write([opaque(input)]),
        }) as unknown as GlobalPlaneRepositories,
      stageOutbox: async (
        session: SqlSession,
        events: readonly DomainEvent[],
      ) => {
        await session.write(
          events.map((event) =>
            opaque(
              statement(
                `INSERT INTO ${GLOBAL_TABLES.outboxEvents}
                   (id, type, payload, occurred_at, aggregate_id, created_at, attempts)
                 VALUES (?, ?, '{}', ?, ?, ?, 0)`,
                event.id,
                event.type,
                event.occurredAt.getTime(),
                event.aggregateId,
                NOW.getTime(),
              ),
            ),
          ),
        );
      },
      relayTrigger: {
        kick: () => {
          relayKicks += 1;
        },
      },
    });

    type Staging = GlobalUnitOfWorkContext & {
      stage: (input: ReturnType<typeof insertUser>) => Promise<void>;
    };

    await expect(
      provider.run(async (ctx) => {
        const staging = ctx as Staging;
        await staging.stage(insertUser("user-1"));
        await staging.stage(insertUser("user-2", REFUSED_STATUS));
        ctx.collectEvents([
          {
            type: "test.happened",
            payload: {},
            occurredAt: NOW,
            aggregateId: "user-1",
          },
        ]);
      }),
    ).rejects.toThrow();

    expect(await storedUsers()).toEqual([]);
    const outbox = await env.GLOBAL_DB.prepare(
      `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.outboxEvents}`,
    ).first<{ n: number }>();
    expect(outbox?.n).toBe(0);
    expect(relayKicks).toBe(0);
  });

  it("rolls a scope write-set back inside transactionSync and publishes no index", async () => {
    const scope = ScopeKey.user("user-rollback" as UserId);
    const scopeExecutor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    );

    await expect(
      scopeExecutor.applyWriteSet(
        [
          insertTask("op-1"),
          insertTask("op-2", REFUSED_STATUS),
          insertTask("op-3"),
        ],
        [SCHEDULED_TASKS_TABLE],
      ),
    ).rejects.toThrow();

    const rows = await scopeExecutor.query(
      statement(`SELECT operation_id FROM ${SCHEDULED_TASKS_TABLE}`),
    );
    expect(rows).toEqual([]);

    // The due index is refreshed after the transaction, so a refused
    // write-set must not have announced anything to the global plane.
    const indexed = await env.GLOBAL_DB.prepare(
      `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.scopeTaskDueIndex}
        WHERE scope_type = 'user' AND scope_id = 'user-rollback'`,
    ).first<{ n: number }>();
    expect(indexed?.n).toBe(0);
  });

  it("leaves an already-committed scope write-set alone when a later one is refused", async () => {
    const scope = ScopeKey.user("user-partial" as UserId);
    const scopeExecutor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    );
    await scopeExecutor.applyWriteSet([insertTask("op-kept")], []);

    await expect(
      scopeExecutor.applyWriteSet(
        [insertTask("op-lost"), insertTask("op-bad", REFUSED_STATUS)],
        [],
      ),
    ).rejects.toThrow();

    const rows = await scopeExecutor.query(
      statement(
        `SELECT operation_id FROM ${SCHEDULED_TASKS_TABLE} ORDER BY operation_id`,
      ),
    );
    expect(rows.map((row) => row.operation_id)).toEqual(["op-kept"]);
  });
});
