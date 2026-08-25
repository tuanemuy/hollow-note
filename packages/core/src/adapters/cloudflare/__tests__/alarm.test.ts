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
import { scheduleStatement } from "../do/scheduledTasks";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { scopeObjectName } from "../do/scopeName";
import { createScopeStubExecutor } from "../do/scopeStub";
import { int, text } from "../sql/row";
import { statement } from "../sql/statement";

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
    await env.GLOBAL_DB.exec(
      `ALTER TABLE ${GLOBAL_TABLES.scopeTaskDueIndex} RENAME TO due_index_hidden`,
    );
    try {
      await seed(scope, [task], true);
    } finally {
      await env.GLOBAL_DB.exec(
        `ALTER TABLE due_index_hidden RENAME TO ${GLOBAL_TABLES.scopeTaskDueIndex}`,
      );
    }

    expect((await rowsOf(scope, "operation_id, status"))[0]).toMatchObject({
      operation_id: "op-publish",
      status: "pending",
    });
    expect(
      await runInDurableObject(stubFor(scope), (_i, state) =>
        state.storage.getAlarm(),
      ),
    ).toBe(dueAtMs);

    // Publishing replaces the whole slice, so the drift heals itself.
    await seed(scope, [task], true);
    const indexed = await env.GLOBAL_DB.prepare(
      `SELECT operation_id FROM ${GLOBAL_TABLES.scopeTaskDueIndex}
        WHERE scope_type = 'user' AND scope_id = 'user-publish-fails'`,
    ).all<{ operation_id: string }>();
    expect(indexed.results.map((row) => row.operation_id)).toEqual([
      "op-publish",
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

  it("drops the alarm once nothing is scheduled", async () => {
    register("anything", noop);
    const scope = scopeOf("user-empty");
    const executor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    );
    await executor.applyWriteSet([], [SCHEDULED_TASKS_TABLE]);

    const alarmAt = await runInDurableObject(stubFor(scope), (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(alarmAt).toBeNull();
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
