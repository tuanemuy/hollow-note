import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  GlobalUnitOfWorkContext,
  ScopeUnitOfWorkContext,
} from "../../../application/execution/unitOfWork";
import { ScopeTaskPriority } from "../../../application/ports/scopeTaskScheduler";
import { ScopeKey } from "../../../application/scope";
import { type DomainEvent, EventId } from "../../../domain/common/event";
import type { UserId } from "../../../domain/identity/valueObject";
import { GLOBAL_TABLES } from "../d1/schema";
import { scheduleStatement, scopeTaskKey } from "../do/scheduledTasks";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import { createGlobalUnitOfWorkProvider } from "../execution/globalUnitOfWork";
import { createScopeUnitOfWorkProvider } from "../execution/scopeUnitOfWork";
import { opaque, upsert } from "../execution/writeSet";
import { createD1Executor } from "../sql/executor";
import { occGuard } from "../sql/occGuard";
import { int, text } from "../sql/row";
import type { SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * Backend-local observations of the two-plane unit of work: the write-set
 * mechanism itself (staging, atomic apply, rollback, read-your-writes,
 * the `_occ_guard` trip wire, the nesting bar, the post-commit triggers)
 * and the scope plane's Durable Object round trip.
 *
 * These are not port contracts — the shared conformance suite
 * `adapters/conformance/unitOfWork.ts` covers those once the repositories
 * exist. What is here is everything that suite deliberately does not
 * observe because it is not backend-agnostic.
 */

const NAMESPACE = "uow";
const clock = new Date("2026-08-26T00:00:00.000Z");

let eventSeq = 0;
const mintEventId = (): EventId => {
  eventSeq += 1;
  return EventId.create(`event-${eventSeq}`);
};

const draft = (aggregateId: string) => ({
  type: "test.happened",
  payload: {},
  occurredAt: clock,
  aggregateId,
});

/** Minimal outbox staging: the real one arrives with `OutboxRepository`. */
const stageOutbox = async (
  session: SqlSession,
  events: readonly DomainEvent[],
): Promise<void> => {
  await session.write(
    events.map((event) =>
      opaque(
        statement(
          `INSERT INTO ${GLOBAL_TABLES.outboxEvents}
             (id, type, payload, occurred_at, aggregate_id, created_at, attempts)
           VALUES (?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT (id) DO NOTHING`,
          event.id,
          event.type,
          JSON.stringify(event.payload),
          event.occurredAt.getTime(),
          event.aggregateId,
          clock.getTime(),
        ),
      ),
    ),
  );
};

/** A one-port stand-in: the unit of work never touches the others. */
const globalRepositories = (session: SqlSession) =>
  ({
    userRepository: {
      async insert(id: string): Promise<void> {
        await session.write([
          upsert({
            table: GLOBAL_TABLES.users,
            key: id,
            row: {
              id,
              status: "pending",
              auth_epoch: 0,
              version: 0,
              created_at: clock.getTime(),
              updated_at: clock.getTime(),
            },
            statement: statement(
              `INSERT INTO ${GLOBAL_TABLES.users}
                 (id, status, auth_epoch, version, created_at, updated_at)
               VALUES (?, 'pending', 0, 0, ?, ?)`,
              id,
              clock.getTime(),
              clock.getTime(),
            ),
          }),
        ]);
      },
      async findById(id: string) {
        return session.readRow({
          table: GLOBAL_TABLES.users,
          key: id,
          statement: statement(
            `SELECT * FROM ${GLOBAL_TABLES.users} WHERE id = ?`,
            id,
          ),
        });
      },
      async bumpVersion(id: string, expected: number): Promise<void> {
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${GLOBAL_TABLES.users} WHERE id = ? AND version = ?`,
                id,
                expected,
              ),
            ),
          ),
          opaque(
            statement(
              `UPDATE ${GLOBAL_TABLES.users} SET version = version + 1 WHERE id = ? AND version = ?`,
              id,
              expected,
            ),
          ),
        ]);
      },
    },
  }) as unknown as ReturnType<
    (session: SqlSession) => Omit<GlobalUnitOfWorkContext, "collectEvents">
  >;

type TestGlobalContext = GlobalUnitOfWorkContext & {
  userRepository: {
    insert(id: string): Promise<void>;
    findById(id: string): Promise<Record<string, unknown> | null>;
    bumpVersion(id: string, expected: number): Promise<void>;
  };
};

/**
 * Opens once every participant has arrived, so a race can be staged
 * without leaning on timing: both units read before either commits.
 */
const latch = (count: number): (() => Promise<void>) => {
  let remaining = count;
  let open = (): void => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    remaining -= 1;
    if (remaining === 0) {
      open();
    }
    await opened;
  };
};

const scopeRepositories = (session: SqlSession) =>
  ({
    scopeTaskScheduler: {
      async attemptsOf(kind: string, operationId: string): Promise<number> {
        const row = await session.readRow({
          table: SCHEDULED_TASKS_TABLE,
          key: scopeTaskKey(kind, operationId),
          statement: statement(
            `SELECT * FROM ${SCHEDULED_TASKS_TABLE} WHERE kind = ? AND operation_id = ?`,
            kind,
            operationId,
          ),
        });
        return int(row ?? {}, "attempts");
      },
      async bumpAttempts(
        kind: string,
        operationId: string,
        expected: number,
      ): Promise<void> {
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${SCHEDULED_TASKS_TABLE}
                  WHERE kind = ? AND operation_id = ? AND attempts = ?`,
                kind,
                operationId,
                expected,
              ),
            ),
          ),
          opaque({
            table: SCHEDULED_TASKS_TABLE,
            statement: statement(
              `UPDATE ${SCHEDULED_TASKS_TABLE} SET attempts = attempts + 1
                WHERE kind = ? AND operation_id = ? AND attempts = ?`,
              kind,
              operationId,
              expected,
            ),
          }),
        ]);
      },
      async schedule(kind: string, operationId: string): Promise<void> {
        await session.write([
          upsert({
            table: SCHEDULED_TASKS_TABLE,
            key: scopeTaskKey(kind, operationId),
            row: {
              kind,
              operation_id: operationId,
              due_at: clock.getTime(),
              payload: "{}",
              attempts: 0,
              last_error: null,
              priority: ScopeTaskPriority.outboxRelay,
              status: "pending",
              lease_expires_at: null,
            },
            statement: scheduleStatement({
              kind,
              operationId,
              priority: ScopeTaskPriority.outboxRelay,
              dueAt: clock,
              payload: {},
            }),
          }),
        ]);
      },
    },
  }) as unknown as Omit<ScopeUnitOfWorkContext, "collectEvents">;

type TestScopeContext = ScopeUnitOfWorkContext & {
  scopeTaskScheduler: {
    schedule(kind: string, operationId: string): Promise<void>;
    attemptsOf(kind: string, operationId: string): Promise<number>;
    bumpAttempts(
      kind: string,
      operationId: string,
      expected: number,
    ): Promise<void>;
  };
};

describe("cloudflare two-plane unit of work", () => {
  let relayKicks = 0;
  let scopeTaskKicks = 0;

  const globalUnitOfWork = createGlobalUnitOfWorkProvider({
    executor: createD1Executor(env.GLOBAL_DB),
    mintEventId,
    buildRepositories: globalRepositories,
    stageOutbox,
    relayTrigger: {
      kick: () => {
        relayKicks += 1;
      },
    },
  });

  const scopeUnitOfWork = createScopeUnitOfWorkProvider({
    openScope: (scope) =>
      createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE),
    mintEventId,
    buildRepositories: scopeRepositories,
    stageOutbox,
    relayTrigger: {
      kick: () => {
        relayKicks += 1;
      },
    },
    scopeTaskTrigger: {
      kick: () => {
        scopeTaskKicks += 1;
      },
    },
  });

  const run = <T>(fn: (ctx: TestGlobalContext) => Promise<T>): Promise<T> =>
    globalUnitOfWork.run((ctx) => fn(ctx as TestGlobalContext));

  const runScope = <T>(
    scope: ScopeKey,
    fn: (ctx: TestScopeContext) => Promise<T>,
  ): Promise<T> =>
    scopeUnitOfWork.run(scope, (ctx) => fn(ctx as TestScopeContext));

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  beforeEach(async () => {
    relayKicks = 0;
    scopeTaskKicks = 0;
    await env.GLOBAL_DB.batch([
      env.GLOBAL_DB.prepare(`DELETE FROM ${GLOBAL_TABLES.users}`),
      env.GLOBAL_DB.prepare(`DELETE FROM ${GLOBAL_TABLES.outboxEvents}`),
      env.GLOBAL_DB.prepare(`DELETE FROM ${GLOBAL_TABLES.scopeTaskDueIndex}`),
    ]);
  });

  const countUsers = async (): Promise<number> => {
    const row = await env.GLOBAL_DB.prepare(
      `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.users}`,
    ).first<{ n: number }>();
    return row?.n ?? 0;
  };

  it("applies a whole write-set as one atomic unit and kicks the relay once", async () => {
    await run(async (ctx) => {
      await ctx.userRepository.insert("user-1");
      await ctx.userRepository.insert("user-2");
      ctx.collectEvents([draft("user-1")]);
    });

    expect(await countUsers()).toBe(2);
    const outbox = await env.GLOBAL_DB.prepare(
      `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.outboxEvents}`,
    ).first<{ n: number }>();
    expect(outbox?.n).toBe(1);
    expect(relayKicks).toBe(1);
  });

  it("writes nothing when the callback throws, events included", async () => {
    await expect(
      run(async (ctx) => {
        await ctx.userRepository.insert("user-1");
        ctx.collectEvents([draft("user-1")]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await countUsers()).toBe(0);
    expect(relayKicks).toBe(0);
  });

  it("serves read-your-writes from the staged overlay", async () => {
    const seen = await run(async (ctx) => {
      await ctx.userRepository.insert("user-1");
      return ctx.userRepository.findById("user-1");
    });
    expect(seen).not.toBeNull();
  });

  it("keeps a concurrent run from observing a half-written unit", async () => {
    const observed: number[] = [];
    await Promise.all([
      run(async (ctx) => {
        await ctx.userRepository.insert("user-1");
        for (let i = 0; i < 5; i += 1) {
          await Promise.resolve();
        }
        await ctx.userRepository.insert("user-2");
      }),
      (async () => {
        for (let i = 0; i < 5; i += 1) {
          observed.push(await countUsers());
        }
      })(),
    ]);
    for (const seen of observed) {
      expect([0, 2]).toContain(seen);
    }
  });

  it("aborts the batch through _occ_guard when a version moved underneath", async () => {
    await run(async (ctx) => {
      await ctx.userRepository.insert("user-1");
    });
    await run(async (ctx) => {
      await ctx.userRepository.bumpVersion("user-1", 0);
    });

    await expect(
      run(async (ctx) => {
        await ctx.userRepository.bumpVersion("user-1", 0);
      }),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_LOCK_FAILURE" });

    const row = await env.GLOBAL_DB.prepare(
      `SELECT version FROM ${GLOBAL_TABLES.users} WHERE id = 'user-1'`,
    ).first<{ version: number }>();
    expect(row?.version).toBe(1);
  });

  it("leaves the guard table empty even after it has fired", async () => {
    const row = await env.GLOBAL_DB.prepare(
      `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.occGuard}`,
    ).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("forbids nesting on the same plane and across planes", async () => {
    const scope = ScopeKey.user("user-nesting" as UserId);
    await expect(run(async () => run(async () => undefined))).rejects.toThrow(
      /nesting is forbidden/,
    );
    await expect(
      runScope(scope, async () => run(async () => undefined)),
    ).rejects.toThrow(/nesting is forbidden/);
    await expect(
      run(async () => runScope(scope, async () => undefined)),
    ).rejects.toThrow(/nesting is forbidden/);
    await expect(
      runScope(scope, async () => runScope(scope, async () => undefined)),
    ).rejects.toThrow(/nesting is forbidden/);
  });

  it("kicks the post-commit triggers outside the unit's async context", async () => {
    // A Cloudflare relay kick starts the dispatch and hands it to
    // `waitUntil`, which opens a unit of work of its own. That is only
    // possible if the kick runs after the committing unit's async
    // context has closed.
    const dispatched: Promise<string>[] = [];
    const globalProvider = createGlobalUnitOfWorkProvider({
      executor: createD1Executor(env.GLOBAL_DB),
      mintEventId,
      buildRepositories: globalRepositories,
      stageOutbox,
      relayTrigger: {
        kick: () => {
          dispatched.push(globalUnitOfWork.run(async () => "relayed"));
        },
      },
    });

    await globalProvider.run(async (ctx) => {
      await (ctx as TestGlobalContext).userRepository.insert("user-kick");
      ctx.collectEvents([draft("user-kick")]);
    });

    expect(dispatched).toHaveLength(1);
    await expect(dispatched[0]).resolves.toBe("relayed");

    const armed: Promise<string>[] = [];
    const scopeProvider = createScopeUnitOfWorkProvider({
      openScope: (scope) =>
        createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE),
      mintEventId,
      buildRepositories: scopeRepositories,
      stageOutbox,
      scopeTaskTrigger: {
        kick: () => {
          armed.push(
            scopeUnitOfWork.run(
              ScopeKey.user("user-kick-runner" as UserId),
              async () => "ran",
            ),
          );
        },
      },
    });

    await scopeProvider.run(
      ScopeKey.user("user-kick-scope" as UserId),
      async (ctx) => {
        await (ctx as TestScopeContext).scopeTaskScheduler.schedule(
          "test.continued",
          "op-kick",
        );
      },
    );

    expect(armed).toHaveLength(1);
    await expect(armed[0]).resolves.toBe("ran");
  });

  it("commits the scope plane through one RPC and publishes the due index before resolving", async () => {
    const scope = ScopeKey.user("user-scope" as UserId);
    await runScope(scope, async (ctx) => {
      await ctx.scopeTaskScheduler.schedule("test.continued", "op-1");
    });

    const indexed = await env.GLOBAL_DB.prepare(
      `SELECT kind, operation_id, priority FROM ${GLOBAL_TABLES.scopeTaskDueIndex}
        WHERE scope_type = 'user' AND scope_id = 'user-scope'`,
    ).all<{ kind: string; operation_id: string; priority: number }>();
    expect(indexed.results).toEqual([
      {
        kind: "test.continued",
        operation_id: "op-1",
        priority: ScopeTaskPriority.outboxRelay,
      },
    ]);
    expect(scopeTaskKicks).toBe(1);
  });

  it("rolls the scope plane back when its callback throws", async () => {
    const scope = ScopeKey.user("user-scope-rollback" as UserId);
    await expect(
      runScope(scope, async (ctx) => {
        await ctx.scopeTaskScheduler.schedule("test.continued", "op-2");
        throw new Error("scope boom");
      }),
    ).rejects.toThrow("scope boom");

    const executor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    );
    const rows = await executor.query(
      statement(`SELECT kind FROM ${SCHEDULED_TASKS_TABLE}`),
    );
    expect(rows).toHaveLength(0);
    expect(scopeTaskKicks).toBe(0);
  });

  it("surfaces a scope-plane _occ_guard trip as OPTIMISTIC_LOCK_FAILURE", async () => {
    // The guard fires inside `transactionSync`, so the constraint name
    // has to survive the object's RPC boundary for `classifySqlError` to
    // recognise it. Nothing but a genuine race reaches the guard — the
    // repositories read the version first — so this is the only shape
    // that observes the translation at all.
    const scope = ScopeKey.user("user-scope-occ" as UserId);
    await runScope(scope, async (ctx) => {
      await ctx.scopeTaskScheduler.schedule("test.contended", "op-occ");
    });

    const bothRead = latch(2);
    const contend = (): Promise<void> =>
      runScope(scope, async (ctx) => {
        const attempts = await ctx.scopeTaskScheduler.attemptsOf(
          "test.contended",
          "op-occ",
        );
        await bothRead();
        await ctx.scopeTaskScheduler.bumpAttempts(
          "test.contended",
          "op-occ",
          attempts,
        );
      });

    const settled = await Promise.allSettled([contend(), contend()]);
    const rejected = settled.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "OPTIMISTIC_LOCK_FAILURE",
    });

    const executor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    );
    const rows = await executor.query(
      statement(`SELECT attempts FROM ${SCHEDULED_TASKS_TABLE}`),
    );
    expect(int(rows[0] ?? {}, "attempts")).toBe(1);
  });

  it("keeps two scopes apart", async () => {
    const first = ScopeKey.user("user-a" as UserId);
    const second = ScopeKey.user("user-b" as UserId);
    await runScope(first, async (ctx) => {
      await ctx.scopeTaskScheduler.schedule("test.continued", "op-a");
    });

    const other = createScopeStubExecutor(env.SCOPE_OBJECT, second, NAMESPACE);
    const rows = await other.query(
      statement(`SELECT kind, operation_id FROM ${SCHEDULED_TASKS_TABLE}`),
    );
    expect(rows).toHaveLength(0);

    const own = createScopeStubExecutor(env.SCOPE_OBJECT, first, NAMESPACE);
    const mine = await own.query(
      statement(
        `SELECT kind, operation_id, priority FROM ${SCHEDULED_TASKS_TABLE}`,
      ),
    );
    expect(mine).toHaveLength(1);
    expect(text(mine[0] ?? {}, "operation_id")).toBe("op-a");
    expect(int(mine[0] ?? {}, "priority")).toBe(ScopeTaskPriority.outboxRelay);
  });
});
