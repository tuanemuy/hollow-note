import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ConflictError } from "../../../application/errors";
import {
  ScopeTaskPriority,
  type ScopeTaskScheduler,
} from "../../../application/ports/scopeTaskScheduler";
import { ScopeKey } from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import { createCloudflareScopeTaskScheduler } from "../do/repositories/scopeTaskScheduler";
import {
  backoffStatement,
  claimStatement,
  scheduleStatement,
} from "../do/scheduledTasks";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import type { ScopeSqlExecutor } from "../sql/executor";
import { createAutocommitSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * AC-4, the lease half: a writer that took a row and never came back,
 * and two writers reaching for the same row at once.
 *
 * The claim is an `_occ_guard` over the candidate test followed by a
 * conditional `UPDATE`, which is how a backend with no interactive
 * transaction gets per-row exclusivity between two independent writers.
 * What matters beyond exclusivity is that a reclaim is *free*: `due_at`,
 * `attempts`, `priority` and `payload` are the row's place in the queue,
 * and a lapsed lease must not cost it any of them
 * (`ScopeTaskScheduler`'s JSDoc: reclaiming a lapsed lease spends no
 * attempt).
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

  /**
   * The property the port names, observed through the port: two runners
   * offered the same row must not both be told they took it. Watching
   * the stored lease value is not enough — one lease lands either way,
   * and what breaks is the answer the loser gets back.
   */
  it("gives a contested row to exactly one of two concurrent claimDue calls", async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
    const scope = ScopeKey.user("user-lease-race" as UserId);
    const schedulerFor = (): ScopeTaskScheduler =>
      createCloudflareScopeTaskScheduler({
        session: createAutocommitSession(
          createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE),
        ),
        scope,
        db: env.GLOBAL_DB,
      });
    const runnerA = schedulerFor();
    const runnerB = schedulerFor();

    await runnerA.schedule({
      kind: KIND,
      operationId: OPERATION,
      priority: ScopeTaskPriority.outboxRelay,
      dueAt: T0,
      payload: {},
    });

    const now = at(1_000);
    const claim = (runner: ScopeTaskScheduler) =>
      runner.claimDue({ now, limit: 10, leaseMs: LEASE_MS });
    const outcomes = await Promise.allSettled([claim(runnerA), claim(runnerB)]);

    const handedOut = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" ? outcome.value : [],
    );
    expect(handedOut).toHaveLength(1);
    expect(handedOut[0]?.operationId).toBe(OPERATION);

    // The loser is refused rather than quietly handed the same row: its
    // claim aborts as a lost optimistic-lock race.
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(ConflictError);
        expect((outcome.reason as ConflictError).code).toBe(
          "OPTIMISTIC_LOCK_FAILURE",
        );
      }
    }
    expect(outcomes.some((outcome) => outcome.status === "rejected")).toBe(
      true,
    );

    const row = await readRow(
      createScopeStubExecutor(env.SCOPE_OBJECT, scope, NAMESPACE),
    );
    expect(row.status).toBe("running");
    expect(row.lease_expires_at).toBe(now.getTime() + LEASE_MS);
  });
});
