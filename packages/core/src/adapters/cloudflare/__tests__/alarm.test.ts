import {
  applyD1Migrations,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type ScopeTaskPriority as Priority,
  ScopeTaskPriority,
} from "../../../application/ports/scopeTaskScheduler";
import { ScopeKey } from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import { GLOBAL_TABLES } from "../d1/schema";
import { nextWakeAt, runScopeAlarmTurn } from "../do/alarm";
import { scheduleStatement } from "../do/scheduledTasks";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { scopeObjectName } from "../do/scopeName";
import { createScopeStubExecutor } from "../do/scopeStub";
import { text } from "../sql/row";
import { statement } from "../sql/statement";

/**
 * Backend-local observations of the scope Alarm turn
 * (`spec/platform/index.md`「Scope Alarm」): the weighted round-robin, the
 * row budget, the "no handler ⇒ leave it running" rule, and the wake
 * time derived from the two candidate columns.
 */

const NAMESPACE = "alarm";
const now = new Date("2026-08-26T00:00:00.000Z");

const scopeOf = (id: string): ScopeKey => ScopeKey.user(id as UserId);

const stubFor = (scope: ScopeKey) =>
  env.SCOPE_OBJECT.get(
    env.SCOPE_OBJECT.idFromName(scopeObjectName(scope, NAMESPACE)),
  );

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

describe("scope alarm", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
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
        }),
    );
    expect(result).toEqual({ claimed: 2, handled: 0, unhandled: 2 });

    const executor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    );
    const running = await executor.query(
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
      }),
    );

    const executor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      NAMESPACE,
    );
    const rows = await executor.query(
      statement(
        `SELECT status, due_at, attempts, lease_expires_at FROM ${SCHEDULED_TASKS_TABLE}`,
      ),
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
});
