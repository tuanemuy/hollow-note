import {
  applyD1Migrations,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type ScopeTaskPriority as Priority,
  type ScopeTask,
  ScopeTaskPriority,
} from "../../../application/ports/scopeTaskScheduler";
import { ScopeKey } from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import { GLOBAL_TABLES } from "../d1/schema";
import {
  nextWakeAt,
  registerScopeTaskHandler,
  runScopeAlarmTurn,
  type ScopeAlarmHandler,
  type ScopeAlarmHandlers,
} from "../do/alarm";
import { DUE_INDEX_REPUBLISH_DELAY_MS } from "../do/dueIndex";
import { createCloudflareScopeTaskScheduler } from "../do/repositories/scopeTaskScheduler";
import { scheduleStatement } from "../do/scheduledTasks";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { scopeObjectName } from "../do/scopeName";
import type { ScopeObjectEnv } from "../do/scopeObject";
import { createScopeStubExecutor } from "../do/scopeStub";
import { int, text } from "../sql/row";
import { createAutocommitSession } from "../sql/session";
import { type SqlRow, statement } from "../sql/statement";

/**
 * Backend-local observations of the scope Alarm turn
 * (`spec/platform/index.md`「Scope Alarm」): the weighted round-robin, the
 * row budget, the "no handler ⇒ leave it running" rule, the failure
 * handling a turn owes the attempt ceiling, and the wake time derived
 * from the two candidate columns.
 *
 * A registry with no handler at all means this deployment does not drive
 * tasks from the object, so most cases here register one first — that is
 * what makes the object a writer.
 */

const NAMESPACE = "alarm";
const now = new Date("2026-08-26T00:00:00.000Z");

const scopeOf = (id: string): ScopeKey => ScopeKey.user(id as UserId);

const stubFor = (scope: ScopeKey) =>
  env.SCOPE_OBJECT.get(
    env.SCOPE_OBJECT.idFromName(scopeObjectName(scope, NAMESPACE)),
  );

const undo: (() => void)[] = [];

/** Makes the object a task driver for the rest of the case. */
const register = (kind: string, handler: ScopeAlarmHandler): void => {
  undo.push(registerScopeTaskHandler(kind, handler));
};

const noop: ScopeAlarmHandler = async () => {};

const handlersOf = (
  entries: Readonly<Record<string, ScopeAlarmHandler>>,
): ScopeAlarmHandlers => new Map(Object.entries(entries));

/**
 * `arm` decides whether the commit declares `scheduled_tasks` touched
 * and so re-arms the object's alarm. The tests that drive a turn
 * themselves leave it off: an alarm armed for a time already past is
 * delivered by workerd whenever it likes, and a spontaneous turn would
 * race the one under observation.
 */
const seed = async (
  scope: ScopeKey,
  tasks: readonly Readonly<{
    kind: string;
    operationId: string;
    priority: Priority;
    dueAtMs: number;
  }>[],
  arm = false,
): Promise<void> => {
  const executor = createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE);
  await executor.applyWriteSet(
    tasks.map((task) =>
      scheduleStatement({
        kind: task.kind,
        operationId: task.operationId,
        priority: task.priority,
        dueAt: new Date(task.dueAtMs),
        payload: {},
      }),
    ),
    arm ? [SCHEDULED_TASKS_TABLE] : [],
  );
};

const rowsOf = async (scope: ScopeKey, columns: string) =>
  createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE).query(
    statement(
      `SELECT ${columns} FROM ${SCHEDULED_TASKS_TABLE} ORDER BY operation_id`,
    ),
  );

const armedAt = (scope: ScopeKey): Promise<number | null> =>
  runInDurableObject(stubFor(scope), (_i, state) => state.storage.getAlarm());

const indexedOf = async (scopeId: string): Promise<string[]> => {
  const indexed = await env.GLOBAL_DB.prepare(
    `SELECT operation_id FROM ${GLOBAL_TABLES.scopeTaskDueIndex}
      WHERE scope_type = 'user' AND scope_id = ? ORDER BY operation_id`,
  )
    .bind(scopeId)
    .all<{ operation_id: string }>();
  return indexed.results.map((row) => row.operation_id);
};

/** Drops the live instance, so the next call has to construct a new one. */
const rebuild = async (scope: ScopeKey): Promise<void> => {
  await expect(
    runInDurableObject(stubFor(scope), (_i, state) => {
      state.abort();
    }),
  ).rejects.toThrow(/abort/);
};

/**
 * Rewrites the live instance's env, standing in for a deployment that
 * configured the object differently. Its own env is the only channel a
 * Durable Object has for that.
 */
const withLeaseMs = (instance: unknown, leaseMs: string): void => {
  const holder = instance as { env: ScopeObjectEnv };
  holder.env = { ...holder.env, SCOPE_TASK_LEASE_MS: leaseMs };
};

const D1_STALL_MS = 50;

/**
 * Holds the object's first due-index batch back and records the order the
 * batches reach D1 in. That is what stages the overlap: a publish issued
 * later has to overtake one still in flight for the older slice to land
 * last.
 */
const stallFirstPublish = (instance: unknown): number[] => {
  const holder = instance as { env: { GLOBAL_DB: D1Database } };
  const real = holder.env.GLOBAL_DB;
  const landed: number[] = [];
  let issued = 0;
  holder.env = {
    GLOBAL_DB: {
      prepare: (sql: string) => real.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        issued += 1;
        const seq = issued;
        if (seq === 1) {
          await new Promise((resolve) => setTimeout(resolve, D1_STALL_MS));
        }
        const result = await real.batch(statements);
        landed.push(seq);
        return result;
      },
    } as unknown as D1Database,
  };
  return landed;
};

/** Hides the due index for one write, so the publish that follows fails. */
const withPublishBroken = async (run: () => Promise<void>): Promise<void> => {
  await env.GLOBAL_DB.exec(
    `ALTER TABLE ${GLOBAL_TABLES.scopeTaskDueIndex} RENAME TO due_index_hidden`,
  );
  try {
    await run();
  } finally {
    await env.GLOBAL_DB.exec(
      `ALTER TABLE due_index_hidden RENAME TO ${GLOBAL_TABLES.scopeTaskDueIndex}`,
    );
  }
};

describe("scope alarm", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  afterEach(() => {
    while (undo.length > 0) {
      undo.pop()?.();
    }
  });

  it("reserves one slot per priority before any priority takes a second", async () => {
    const scope = scopeOf("user-wrr");
    await seed(scope, [
      {
        kind: "relay",
        operationId: "r-1",
        priority: ScopeTaskPriority.outboxRelay,
        dueAtMs: now.getTime() - 5_000,
      },
      {
        kind: "relay",
        operationId: "r-2",
        priority: ScopeTaskPriority.outboxRelay,
        dueAtMs: now.getTime() - 4_000,
      },
      {
        kind: "projection",
        operationId: "p-1",
        priority: ScopeTaskPriority.projection,
        dueAtMs: now.getTime() - 3_000,
      },
    ]);

    const result = await runInDurableObject(
      stubFor(scope),
      (_instance, state) =>
        runScopeAlarmTurn({
          storage: state.storage,
          scope,
          now,
          leaseMs: 60_000,
          rowBudget: 2,
          handlers: handlersOf({ "some.other.kind": noop }),
        }),
    );
    expect(result).toEqual({
      claimed: 2,
      handled: 0,
      unhandled: 2,
      failed: 0,
      released: 0,
    });

    const running = await createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    ).query(
      statement(
        `SELECT operation_id FROM ${SCHEDULED_TASKS_TABLE}
          WHERE status = 'running' ORDER BY operation_id`,
      ),
    );
    expect(running.map((row) => text(row, "operation_id"))).toEqual([
      "p-1",
      "r-1",
    ]);
  });

  it("leaves a row whose kind has no handler running until its lease lapses", async () => {
    const scope = scopeOf("user-unhandled");
    await seed(scope, [
      {
        kind: "nobody.handles.this",
        operationId: "op-1",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 1_000,
      },
    ]);

    await runInDurableObject(stubFor(scope), (_instance, state) =>
      runScopeAlarmTurn({
        storage: state.storage,
        scope,
        now,
        leaseMs: 60_000,
        handlers: handlersOf({ "some.other.kind": noop }),
      }),
    );

    const rows = await rowsOf(
      scope,
      "status, due_at, attempts, lease_expires_at",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "running",
      // A claim leaves the row's place and attempt count alone.
      due_at: now.getTime() - 1_000,
      attempts: 0,
      lease_expires_at: now.getTime() + 60_000,
    });
  });

  /**
   * The registry is what makes the object a writer of `scheduled_tasks`.
   * With none, the central runner is the only one, and the object must
   * neither take rows behind a lease nor arm itself for a turn that
   * would do nothing — while the due index the runner reads still has to
   * be published.
   */
  it("neither claims nor arms when the deployment registers no handler", async () => {
    const scope = scopeOf("user-no-registry");
    await seed(
      scope,
      [
        {
          kind: "usage.userCleanupContinued",
          operationId: "op-idle",
          priority: ScopeTaskPriority.securityCleanup,
          dueAtMs: now.getTime() - 1_000,
        },
      ],
      true,
    );

    expect(
      await runInDurableObject(stubFor(scope), (_i, state) =>
        state.storage.getAlarm(),
      ),
    ).toBeNull();

    const turn = await runInDurableObject(stubFor(scope), (_i, state) =>
      runScopeAlarmTurn({
        storage: state.storage,
        scope,
        now,
        leaseMs: 60_000,
      }),
    );
    expect(turn.claimed).toBe(0);
    expect((await rowsOf(scope, "status"))[0]).toMatchObject({
      status: "pending",
    });

    const indexed = await env.GLOBAL_DB.prepare(
      `SELECT operation_id FROM ${GLOBAL_TABLES.scopeTaskDueIndex}
        WHERE scope_type = 'user' AND scope_id = 'user-no-registry'`,
    ).all<{ operation_id: string }>();
    expect(indexed.results.map((row) => row.operation_id)).toEqual(["op-idle"]);
  });

  /**
   * The turn is the only writer positioned to spend an attempt on a
   * failing target, so a handler that throws must not take the rest of
   * the turn with it — nor leave the row at attempt zero forever.
   */
  it("backs off a task whose handler throws and visits the rest of the chunk", async () => {
    const scope = scopeOf("user-failing-handler");
    await seed(scope, [
      {
        kind: "explodes",
        operationId: "op-bad",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 2_000,
      },
      {
        kind: "works",
        operationId: "op-good",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 1_000,
      },
    ]);

    const visited: string[] = [];
    const result = await runInDurableObject(stubFor(scope), (_i, state) =>
      runScopeAlarmTurn({
        storage: state.storage,
        scope,
        now,
        leaseMs: 60_000,
        handlers: handlersOf({
          explodes: async (task: ScopeTask) => {
            visited.push(task.operationId);
            throw new Error("handler blew up");
          },
          works: async (task: ScopeTask) => {
            visited.push(task.operationId);
          },
        }),
      }),
    );

    expect(result).toMatchObject({ claimed: 2, handled: 1, failed: 1 });
    expect(visited).toEqual(["op-bad", "op-good"]);

    const rows = await rowsOf(
      scope,
      "operation_id, status, attempts, lease_expires_at",
    );
    expect(rows[0]).toMatchObject({
      operation_id: "op-bad",
      status: "pending",
      attempts: 1,
      lease_expires_at: null,
    });
    // Nothing settled the successful row, so it holds its lease.
    expect(rows[1]).toMatchObject({
      operation_id: "op-good",
      status: "running",
      attempts: 0,
    });
  });

  /**
   * A claimed row nobody visits is invisible for the whole lease, so a
   * turn stopped by its CPU budget hands back what it has not reached —
   * and hands it back untouched, since no attempt was spent on it.
   */
  it("releases the rows its CPU budget cut off instead of leaving them leased", async () => {
    const scope = scopeOf("user-budget");
    await seed(scope, [
      {
        kind: "slow",
        operationId: "op-1",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 3_000,
      },
      {
        kind: "slow",
        operationId: "op-2",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 2_000,
      },
      {
        kind: "slow",
        operationId: "op-3",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 1_000,
      },
    ]);

    let ticks = 0;
    const result = await runInDurableObject(stubFor(scope), (_i, state) =>
      runScopeAlarmTurn({
        storage: state.storage,
        scope,
        now,
        leaseMs: 60_000,
        cpuBudgetMs: 2_000,
        // Enough for the chunk's claim and two handlers, then spent. The
        // first row is never measured, so a tick stands for a row past it.
        elapsedMs: () => {
          ticks += 1;
          return ticks <= 2 ? 0 : 5_000;
        },
        handlers: handlersOf({ slow: noop }),
      }),
    );

    expect(result).toMatchObject({ claimed: 3, handled: 2, released: 1 });
    const rows = await rowsOf(
      scope,
      "operation_id, status, attempts, due_at, lease_expires_at",
    );
    expect(rows[0]).toMatchObject({ operation_id: "op-1", status: "running" });
    expect(rows[1]).toMatchObject({ operation_id: "op-2", status: "running" });
    for (const row of rows.slice(2)) {
      expect(row).toMatchObject({
        status: "pending",
        attempts: 0,
        lease_expires_at: null,
      });
    }
    // Released, not backed off: every row still sits where it was.
    expect(rows.map((row) => int(row, "due_at"))).toEqual([
      now.getTime() - 3_000,
      now.getTime() - 2_000,
      now.getTime() - 1_000,
    ]);
  });

  /**
   * A turn that claimed a chunk and released all of it leaves every row
   * exactly where it was, and the re-arm that follows points at a
   * `due_at` already past — which the runtime delivers again at once. So
   * a claimed chunk is visited at least once whatever the budget says.
   */
  it("visits one claimed row even when the claim itself spends the budget", async () => {
    const scope = scopeOf("user-budget-spent");
    await seed(scope, [
      {
        kind: "slow",
        operationId: "op-1",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 3_000,
      },
      {
        kind: "slow",
        operationId: "op-2",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 2_000,
      },
      {
        kind: "slow",
        operationId: "op-3",
        priority: ScopeTaskPriority.securityCleanup,
        dueAtMs: now.getTime() - 1_000,
      },
    ]);

    let ticks = 0;
    const result = await runInDurableObject(stubFor(scope), (_i, state) =>
      runScopeAlarmTurn({
        storage: state.storage,
        scope,
        now,
        leaseMs: 60_000,
        cpuBudgetMs: 2_000,
        // Spent by the time the chunk has been claimed.
        elapsedMs: () => {
          ticks += 1;
          return ticks <= 1 ? 0 : 5_000;
        },
        handlers: handlersOf({ slow: noop }),
      }),
    );

    expect(result).toMatchObject({ claimed: 3, handled: 1, released: 2 });
    const rows = await rowsOf(scope, "operation_id, status, attempts, due_at");
    expect(rows[0]).toMatchObject({ operation_id: "op-1", status: "running" });
    expect(rows.slice(1).map((row) => text(row, "status"))).toEqual([
      "pending",
      "pending",
    ]);
  });

  /**
   * The write-set has committed by the time the slice is republished, so
   * a failure there must not be reported as a failed commit — the caller
   * would retry work that already took effect. Arming and publishing are
   * tolerated separately, so losing one does not cost the other.
   */
  it("keeps a committed write-set when the due index publish fails", async () => {
    register("due.later", noop);
    const scope = scopeOf("user-publish-fails");
    const dueAtMs = Date.now() + 3_600_000;
    const task = {
      kind: "due.later",
      operationId: "op-publish",
      priority: ScopeTaskPriority.outboxRelay,
      dueAtMs,
    };

    // The publish is a write to global D1, and D1 faults are ordinary.
    const before = Date.now();
    await withPublishBroken(() => seed(scope, [task], true));
    const after = Date.now();

    expect((await rowsOf(scope, "operation_id, status"))[0]).toMatchObject({
      operation_id: "op-publish",
      status: "pending",
    });
    // The task's own wake time is an hour out; the failed publish pulls
    // the alarm in front of it so the retry does not wait for the row.
    const armed = await armedAt(scope);
    expect(armed).toBeGreaterThanOrEqual(before);
    expect(armed).toBeLessThanOrEqual(after + DUE_INDEX_REPUBLISH_DELAY_MS);
    expect(armed).toBeLessThan(dueAtMs);

    // Publishing replaces the whole slice, so the drift heals itself.
    await seed(scope, [task], true);
    expect(await indexedOf("user-publish-fails")).toEqual(["op-publish"]);
  });

  /**
   * The direction of due-index drift nothing else covers: `listDue` reads
   * the index alone, so a slice that never landed leaves a scope nobody
   * comes looking for. This has to hold in the default deployment, where
   * the registry is empty — the object drives no tasks, `rescheduleAlarm`
   * drops its alarm, and the retry is the only thing keeping it awake.
   */
  it("republishes a slice whose publish failed on its own next alarm", async () => {
    const scope = scopeOf("user-publish-heals");
    const task = {
      kind: "due.later",
      operationId: "op-heal",
      priority: ScopeTaskPriority.outboxRelay,
      dueAtMs: Date.now() + 3_600_000,
    };

    const before = Date.now();
    await withPublishBroken(() => seed(scope, [task], true));
    const after = Date.now();

    expect(await indexedOf("user-publish-heals")).toEqual([]);
    const armed = await armedAt(scope);
    expect(armed).toBeGreaterThanOrEqual(before);
    expect(armed).toBeLessThanOrEqual(after + DUE_INDEX_REPUBLISH_DELAY_MS);

    expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);

    expect(await indexedOf("user-publish-heals")).toEqual(["op-heal"]);
    // The turn itself drove nothing, so the retry leaves nothing behind.
    expect(await armedAt(scope)).toBeNull();
  });

  /**
   * The exit of a turn is the one place that drops the alarm, so it is
   * also the one place a failed publish has nothing left to lean on: the
   * drop has already happened when the publish is attempted. The retry
   * it arms is what keeps the scope from ending up neither in the index
   * nor holding an alarm.
   */
  it("re-arms after a publish that failed at the exit of a turn", async () => {
    const scope = scopeOf("user-publish-turn");
    const task = {
      kind: "due.later",
      operationId: "op-turn",
      priority: ScopeTaskPriority.outboxRelay,
      dueAtMs: Date.now() + 3_600_000,
    };

    await withPublishBroken(() => seed(scope, [task], true));
    expect(await armedAt(scope)).not.toBeNull();

    // The turn drives nothing (empty registry), so its exit drops the
    // alarm before publishing — and this publish fails too.
    const before = Date.now();
    await withPublishBroken(async () => {
      expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);
    });
    const after = Date.now();

    expect(await indexedOf("user-publish-turn")).toEqual([]);
    const rearmed = await armedAt(scope);
    expect(rearmed).not.toBeNull();
    expect(rearmed).toBeGreaterThanOrEqual(before);
    expect(rearmed).toBeLessThanOrEqual(after + DUE_INDEX_REPUBLISH_DELAY_MS);

    // And that retry still heals the drift when the index comes back.
    expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);
    expect(await indexedOf("user-publish-turn")).toEqual(["op-turn"]);
  });

  /**
   * That retry lives in durable storage rather than in the instance, and
   * an idle object is evicted within seconds — so the rebuild any later
   * call triggers must leave it standing. The default deployment is where
   * it matters: the registry is empty, so no row of `scheduled_tasks` can
   * ask for that alarm on its own once it is gone.
   */
  it("keeps the republish retry alarm across a rebuild of the object", async () => {
    const scope = scopeOf("user-publish-cold");
    const task = {
      kind: "due.later",
      operationId: "op-cold",
      priority: ScopeTaskPriority.outboxRelay,
      dueAtMs: Date.now() + 3_600_000,
    };

    const before = Date.now();
    await withPublishBroken(() => seed(scope, [task], true));
    const after = Date.now();
    const armed = await armedAt(scope);
    expect(armed).toBeGreaterThanOrEqual(before);
    expect(armed).toBeLessThanOrEqual(after + DUE_INDEX_REPUBLISH_DELAY_MS);

    await rebuild(scope);
    // A read is enough to construct the object again.
    expect(await rowsOf(scope, "operation_id")).toHaveLength(1);

    expect(await armedAt(scope)).toBe(armed);
  });

  /**
   * Nor may a commit take it: the upkeep that follows one runs before
   * the publish it exists for, so dropping the alarm there and crashing
   * on the D1 round trip would lose the row from the index and the only
   * way back to it at once. Again the default deployment is where it
   * bites, since that is where dropping is unconditional.
   */
  it("keeps the republish retry alarm across a later successful commit", async () => {
    const scope = scopeOf("user-publish-commit");
    const dueAtMs = Date.now() + 3_600_000;
    const taskOf = (operationId: string) => ({
      kind: "due.later",
      operationId,
      priority: ScopeTaskPriority.outboxRelay,
      dueAtMs,
    });

    await withPublishBroken(() => seed(scope, [taskOf("op-retained")], true));
    const armed = await armedAt(scope);
    expect(armed).not.toBeNull();

    await seed(scope, [taskOf("op-second")], true);

    // The publish this commit made carries both rows, and the retry the
    // earlier failure armed is still standing.
    expect(await indexedOf("user-publish-commit")).toEqual([
      "op-retained",
      "op-second",
    ]);
    expect(await armedAt(scope)).toBe(armed);
  });

  /**
   * The other half of that rule. Rows a deployment driving no tasks left
   * behind have to be picked up once one that does drives them, and the
   * rows alone cannot ask for the alarm — the object arms for what it
   * already holds the next time it is built.
   */
  it("arms a rebuilt object for the rows it already holds", async () => {
    register("due.later", noop);
    const scope = scopeOf("user-rearm-cold");
    const dueAtMs = Date.now() + 3_600_000;
    await seed(scope, [
      {
        kind: "due.later",
        operationId: "op-rearm",
        priority: ScopeTaskPriority.outboxRelay,
        dueAtMs,
      },
    ]);
    // Seeded without declaring the table touched, so nothing armed yet.
    expect(await armedAt(scope)).toBeNull();

    await rebuild(scope);
    expect(await rowsOf(scope, "operation_id")).toHaveLength(1);

    expect(await armedAt(scope)).toBe(dueAtMs);
  });

  /**
   * A scheduler built straight over a scope's session publishes the due
   * index but arms nothing, which is enough only while the central
   * runner is the one that comes looking. Where the object drives tasks
   * there is no such runner, so that write would be a continuation
   * nobody wakes — the path is refused instead of drifting quietly.
   */
  it("refuses a write outside a unit of work where the object drives tasks", async () => {
    const scope = scopeOf("user-autocommit-schedule");
    const scheduler = () =>
      createCloudflareScopeTaskScheduler({
        session: createAutocommitSession(
          createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE),
        ),
        scope,
        db: env.GLOBAL_DB,
      });
    const taskOf = (operationId: string) => ({
      kind: "due.later",
      operationId,
      priority: ScopeTaskPriority.outboxRelay,
      dueAt: new Date(Date.now() + 3_600_000),
      payload: {},
    });

    await scheduler().schedule(taskOf("op-runner"));
    expect(await indexedOf("user-autocommit-schedule")).toEqual(["op-runner"]);
    expect(await armedAt(scope)).toBeNull();

    register("due.later", noop);
    await expect(scheduler().schedule(taskOf("op-refused"))).rejects.toThrow(
      /unit of work/,
    );
    // Refused before the write, so the row never landed either.
    expect(await rowsOf(scope, "operation_id")).toHaveLength(1);
  });

  /**
   * A publish ends in a write to global D1, which is not a storage
   * operation — the input gate opens across it, so a second write-set
   * lands and reads its own slice while the first is still in flight.
   * Slices are whole, so the last one to arrive wins: the older one must
   * not be able to overtake the newer.
   */
  it("does not let an overlapping publish land an older slice", async () => {
    const scope = scopeOf("user-publish-concurrent");
    const dueAtMs = Date.now() + 3_600_000;
    const taskOf = (operationId: string) => ({
      kind: "due.later",
      operationId,
      priority: ScopeTaskPriority.outboxRelay,
      dueAtMs,
    });

    const landed = await runInDurableObject(stubFor(scope), (instance) =>
      stallFirstPublish(instance),
    );
    await Promise.all([
      seed(scope, [taskOf("op-a")], true),
      seed(scope, [taskOf("op-b")], true),
    ]);

    // Both publishes went through the stall, and the second waited for
    // the first rather than overtaking it.
    expect(landed).toEqual([1, 2]);
    expect(await indexedOf("user-publish-concurrent")).toEqual([
      "op-a",
      "op-b",
    ]);
  });

  it("wakes at the smaller of the earliest due_at and the earliest lease expiry", async () => {
    const scope = scopeOf("user-wake");
    await seed(scope, [
      {
        kind: "later",
        operationId: "op-late",
        priority: ScopeTaskPriority.expiryCollection,
        dueAtMs: now.getTime() + 900_000,
      },
      {
        kind: "sooner",
        operationId: "op-soon",
        priority: ScopeTaskPriority.expiryCollection,
        dueAtMs: now.getTime() + 60_000,
      },
    ]);

    const wake = await runInDurableObject(stubFor(scope), (_i, state) =>
      nextWakeAt(state.storage),
    );
    expect(wake?.getTime()).toBe(now.getTime() + 60_000);
  });

  /**
   * The commit that empties `scheduled_tasks` only ever arms, so the
   * alarm it leaves behind outlives the last row — and the empty turn
   * that follows is what drops it. That one spare turn is the whole
   * price of keeping the drop at the exit of a turn.
   */
  it("keeps the alarm when the last row is completed and drops it on the empty turn", async () => {
    register("due.later", noop);
    const scope = scopeOf("user-empty");
    // An hour out, so workerd cannot deliver it while the test is still
    // setting up and race the delivery under observation.
    const dueAtMs = Date.now() + 3_600_000;
    await seed(
      scope,
      [
        {
          kind: "due.later",
          operationId: "op-last",
          priority: ScopeTaskPriority.outboxRelay,
          dueAtMs,
        },
      ],
      true,
    );
    expect(await armedAt(scope)).toBe(dueAtMs);

    // Completing the last row is an ordinary write-set that declares the
    // table touched, exactly as `ScopeTaskScheduler.complete` does.
    await createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    ).applyWriteSet(
      [statement(`DELETE FROM ${SCHEDULED_TASKS_TABLE}`)],
      [SCHEDULED_TASKS_TABLE],
    );
    expect(await rowsOf(scope, "operation_id")).toHaveLength(0);
    expect(await armedAt(scope)).toBe(dueAtMs);

    expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);
    expect(await armedAt(scope)).toBeNull();
  });

  it("arms an alarm at the committed task's due time", async () => {
    register("due.later", noop);
    const scope = scopeOf("user-armed");
    const dueAtMs = Date.now() + 3_600_000;
    await seed(
      scope,
      [
        {
          kind: "due.later",
          operationId: "op-armed",
          priority: ScopeTaskPriority.outboxRelay,
          dueAtMs,
        },
      ],
      true,
    );

    const armed = await runInDurableObject(stubFor(scope), (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(armed).toBe(dueAtMs);
  });

  /**
   * The lease is advisory and carries no fencing token, so the whole
   * safety of settling rests on the deployment picking `leaseMs` out of
   * the band `spec/platform/index.md`「Scope Alarm」defines. A turn the
   * object drives has to honour that choice, not a compiled-in default.
   */
  it("grants the lease the deployment configured", async () => {
    register("some.other.kind", noop);
    const scope = scopeOf("user-lease-tuned");
    const leaseMs = 90_000;
    await seed(
      scope,
      [
        {
          kind: "nobody.handles.this",
          operationId: "op-lease",
          priority: ScopeTaskPriority.outboxRelay,
          dueAtMs: Date.now() + 3_600_000,
        },
      ],
      true,
    );
    await runInDurableObject(stubFor(scope), (instance, state) => {
      withLeaseMs(instance, String(leaseMs));
      state.storage.sql.exec(
        `UPDATE ${SCHEDULED_TASKS_TABLE} SET due_at = ?`,
        Date.now() - 1_000,
      );
    });

    const before = Date.now();
    expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);
    const after = Date.now();

    const row = (await rowsOf(scope, "status, lease_expires_at"))[0];
    expect(row).toMatchObject({ status: "running" });
    const leaseExpiresAt = int(row as SqlRow, "lease_expires_at");
    expect(leaseExpiresAt).toBeGreaterThanOrEqual(before + leaseMs);
    expect(leaseExpiresAt).toBeLessThanOrEqual(after + leaseMs);
  });

  it("refreshes the due index when the alarm turn claims a row", async () => {
    register("some.other.kind", noop);
    const scope = scopeOf("user-fire");
    // Armed for an hour out, so workerd cannot deliver the alarm on its
    // own while the test is still setting up. The row is then backdated
    // without touching the alarm, and the delivery below is the only one.
    await seed(
      scope,
      [
        {
          kind: "due.now",
          operationId: "op-fire",
          priority: ScopeTaskPriority.outboxRelay,
          dueAtMs: Date.now() + 3_600_000,
        },
      ],
      true,
    );
    await runInDurableObject(stubFor(scope), (_i, state) => {
      state.storage.sql.exec(
        `UPDATE ${SCHEDULED_TASKS_TABLE} SET due_at = ?`,
        Date.now() - 1_000,
      );
    });

    expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);

    const indexed = await env.GLOBAL_DB.prepare(
      `SELECT operation_id, lease_expires_at FROM ${GLOBAL_TABLES.scopeTaskDueIndex}
        WHERE scope_type = 'user' AND scope_id = 'user-fire'`,
    ).all<{ operation_id: string; lease_expires_at: number | null }>();
    expect(indexed.results).toHaveLength(1);
    // The turn claimed the row, so the index now shows it leased rather
    // than pending — which is what makes `listDue` stop offering it.
    expect(indexed.results[0]?.lease_expires_at).not.toBeNull();
  });

  /**
   * AC-4: the turn re-arms the object and the next delivery re-enters it.
   * A row left running is work nobody settled, so the object has to come
   * back for it — but only once the lease it granted has lapsed, and
   * without the second visit costing the row anything.
   */
  it("re-arms at the lease it granted and re-enters cleanly on the next delivery", async () => {
    register("some.other.kind", noop);
    const scope = scopeOf("user-reentry");
    const executor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    );
    const taskRow = async () => {
      const rows = await executor.query(
        statement(
          `SELECT status, attempts, due_at, lease_expires_at FROM ${SCHEDULED_TASKS_TABLE}`,
        ),
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error("scheduled task missing");
      }
      return row;
    };
    const alarmAt = () =>
      runInDurableObject(stubFor(scope), (_i, state) =>
        state.storage.getAlarm(),
      );

    await seed(
      scope,
      [
        {
          kind: "nobody.handles.this",
          operationId: "op-reentry",
          priority: ScopeTaskPriority.outboxRelay,
          dueAtMs: Date.now() + 3_600_000,
        },
      ],
      true,
    );
    await runInDurableObject(stubFor(scope), (_i, state) => {
      state.storage.sql.exec(
        `UPDATE ${SCHEDULED_TASKS_TABLE} SET due_at = ?`,
        Date.now() - 1_000,
      );
    });

    expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);
    const claimed = await taskRow();
    expect(text(claimed, "status")).toBe("running");
    // Nothing settled the row, so the next wake is the moment its lease
    // lapses — the object holds on to the work rather than dropping it.
    expect(await alarmAt()).toBe(int(claimed, "lease_expires_at"));

    // Re-entry while the lease is still live: the candidate predicate
    // excludes the row, so the turn claims nothing and changes nothing.
    expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);
    expect(await taskRow()).toEqual(claimed);
    expect(await alarmAt()).toBe(int(claimed, "lease_expires_at"));

    // Once the lease has lapsed the same delivery path reclaims it, and a
    // reclaim spends no attempt.
    await runInDurableObject(stubFor(scope), (_i, state) => {
      state.storage.sql.exec(
        `UPDATE ${SCHEDULED_TASKS_TABLE} SET lease_expires_at = ?`,
        Date.now() - 1_000,
      );
    });
    expect(await runDurableObjectAlarm(stubFor(scope))).toBe(true);
    const reclaimed = await taskRow();
    expect(text(reclaimed, "status")).toBe("running");
    expect(int(reclaimed, "attempts")).toBe(0);
    expect(int(reclaimed, "due_at")).toBe(int(claimed, "due_at"));
    expect(int(reclaimed, "lease_expires_at")).toBeGreaterThan(
      int(claimed, "lease_expires_at"),
    );
    expect(await alarmAt()).toBe(int(reclaimed, "lease_expires_at"));
  });
});
