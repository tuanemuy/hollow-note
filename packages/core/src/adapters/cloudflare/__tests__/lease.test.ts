import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ScopeTaskPriority } from "../../../application/ports/scopeTaskScheduler";
import { ScopeKey } from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import {
  backoffStatement,
  claimStatement,
  scheduleStatement,
} from "../do/scheduledTasks";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import type { ScopeSqlExecutor } from "../sql/executor";
import { statement } from "../sql/statement";

/**
 * AC-4, the lease half: a writer that took a row and never came back.
 *
 * The claim is a conditional `UPDATE` whose predicate repeats the
 * candidate test, which is how a backend with no interactive transaction
 * gets per-row exclusivity between two independent writers. What matters
 * beyond exclusivity is that a reclaim is *free*: `due_at`, `attempts`,
 * `priority` and `payload` are the row's place in the queue, and a lapsed
 * lease must not cost it any of them (`ScopeTaskScheduler`'s JSDoc:
 * reclaiming a lapsed lease spends no attempt).
 *
 * The two writers here are two executors over the same scope object,
 * which is exactly what two workers racing for one scope would be.
 */

const NAMESPACE = "lease";
const KIND = "test.continued";
const OPERATION = "op-1";
const LEASE_MS = 60_000;
const T0 = new Date("2026-08-26T00:00:00.000Z");
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);

type Row = Readonly<{
  due_at: number;
  attempts: number;
  priority: number;
  payload: string;
  status: string;
  lease_expires_at: number | null;
}>;

const readRow = async (executor: ScopeSqlExecutor): Promise<Row> => {
  const rows = await executor.query(
    statement(
      `SELECT due_at, attempts, priority, payload, status, lease_expires_at
         FROM ${SCHEDULED_TASKS_TABLE} WHERE kind = ? AND operation_id = ?`,
      KIND,
      OPERATION,
    ),
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error("scheduled task missing");
  }
  return row as unknown as Row;
};

const place = (row: Row) => ({
  due_at: row.due_at,
  attempts: row.attempts,
  priority: row.priority,
  payload: row.payload,
});

describe("cloudflare scheduled-task lease reclaim", () => {
  it("lets a second writer reclaim a lapsed lease without moving the row", async () => {
    const scope = ScopeKey.user("user-lease" as UserId);
    const writerA = createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE);
    const writerB = createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE);

    await writerA.applyWriteSet(
      [
        scheduleStatement({
          kind: KIND,
          operationId: OPERATION,
          priority: ScopeTaskPriority.securityCleanup,
          dueAt: T0,
          payload: { targets: 7 },
        }),
      ],
      [],
    );
    // One real failure first, so `attempts` and `due_at` both carry a
    // value a reclaim could plausibly reset.
    await writerA.applyWriteSet([backoffStatement(KIND, OPERATION, T0)], []);

    const before = await readRow(writerA);
    expect(before.attempts).toBe(1);
    expect(before.status).toBe("pending");
    expect(before.due_at).toBe(T0.getTime() + 1_000);

    const claimedAt = at(2_000);
    await writerA.applyWriteSet(
      [
        claimStatement(
          KIND,
          OPERATION,
          claimedAt,
          new Date(claimedAt.getTime() + LEASE_MS),
        ),
      ],
      [],
    );
    const leased = await readRow(writerA);
    expect(leased.status).toBe("running");
    expect(leased.lease_expires_at).toBe(claimedAt.getTime() + LEASE_MS);
    expect(place(leased)).toEqual(place(before));

    // While the lease is live the other writer's claim matches nothing.
    const tooEarly = at(3_000);
    await writerB.applyWriteSet(
      [
        claimStatement(
          KIND,
          OPERATION,
          tooEarly,
          new Date(tooEarly.getTime() + LEASE_MS),
        ),
      ],
      [],
    );
    expect((await readRow(writerB)).lease_expires_at).toBe(
      claimedAt.getTime() + LEASE_MS,
    );

    // Once it lapses, the same statement takes the row.
    const reclaimedAt = at(2_000 + LEASE_MS + 1);
    await writerB.applyWriteSet(
      [
        claimStatement(
          KIND,
          OPERATION,
          reclaimedAt,
          new Date(reclaimedAt.getTime() + LEASE_MS),
        ),
      ],
      [],
    );
    const reclaimed = await readRow(writerB);
    expect(reclaimed.status).toBe("running");
    expect(reclaimed.lease_expires_at).toBe(reclaimedAt.getTime() + LEASE_MS);
    expect(place(reclaimed)).toEqual(place(before));
  });

  it("gives a contested row to exactly one of two writers", async () => {
    const scope = ScopeKey.user("user-lease-race" as UserId);
    const writerA = createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE);
    const writerB = createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE);
    await writerA.applyWriteSet(
      [
        scheduleStatement({
          kind: KIND,
          operationId: OPERATION,
          priority: ScopeTaskPriority.outboxRelay,
          dueAt: T0,
          payload: {},
        }),
      ],
      [],
    );

    const now = at(1_000);
    const leaseA = new Date(now.getTime() + LEASE_MS);
    const leaseB = new Date(now.getTime() + 2 * LEASE_MS);
    await Promise.all([
      writerA.applyWriteSet([claimStatement(KIND, OPERATION, now, leaseA)], []),
      writerB.applyWriteSet([claimStatement(KIND, OPERATION, now, leaseB)], []),
    ]);

    // The predicate no longer holds for the loser, so the row carries one
    // lease and not a blend of the two.
    const row = await readRow(writerA);
    expect(row.status).toBe("running");
    expect([leaseA.getTime(), leaseB.getTime()]).toContain(
      row.lease_expires_at,
    );
  });
});
