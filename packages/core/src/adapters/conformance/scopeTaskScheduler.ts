import { beforeEach, describe, expect, it } from "vitest";
import {
  SCOPE_TASK_BACKOFF_BASE_MS,
  SCOPE_TASK_MAX_ATTEMPTS,
} from "../../application/ports/scopeTaskScheduler";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { scopeOf } from "./fixtures";

const MINUTE_MS = 60 * 1000;

/**
 * Shared conformance suite for `ScopeTaskScheduler` and the read side of
 * the same table, `ScopeTaskQueue.listDue` (ADR-005): deterministic
 * upsert per `(kind, operationId)`, due-order claiming, and the
 * exponential backoff that ends in `failed`.
 */
export function describeScopeTaskSchedulerContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`ScopeTaskScheduler conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scheduler: ScopedConformancePorts["scopeTaskScheduler"];

    beforeEach(async () => {
      backend = await makeBackend();
      scheduler = backend.forScope(scopeOf(1)).scopeTaskScheduler;
    });

    const schedule = (
      operationId: string,
      dueOffsetMs = 0,
      kind = "usage.userCleanupContinued",
      payload: Readonly<Record<string, unknown>> = {
        deletionOperationId: "d1",
      },
    ): Promise<void> =>
      scheduler.schedule({
        kind,
        operationId,
        dueAt: new Date(backend.clock.now().getTime() + dueOffsetMs),
        payload,
      });

    it("claims only tasks whose dueAt has passed", async () => {
      await schedule("op-1", -MINUTE_MS);
      await schedule("op-2", MINUTE_MS);

      const claimed = await scheduler.claimDue(backend.clock.now(), 10);
      expect(claimed.map((task) => task.operationId)).toEqual(["op-1"]);
      expect(claimed[0]?.payload).toEqual({ deletionOperationId: "d1" });
      expect(claimed[0]?.attempt).toBe(0);
    });

    it("claims in dueAt order and respects the limit", async () => {
      await schedule("op-late", -MINUTE_MS);
      await schedule("op-early", -2 * MINUTE_MS);

      const claimed = await scheduler.claimDue(backend.clock.now(), 1);
      expect(claimed.map((task) => task.operationId)).toEqual(["op-early"]);
    });

    it("upserts on (kind, operationId) so a replayed turn does not multiply tasks", async () => {
      await schedule("op-1", -MINUTE_MS, "usage.userCleanupContinued", {
        cursor: "a",
      });
      await schedule("op-1", -MINUTE_MS, "usage.userCleanupContinued", {
        cursor: "b",
      });
      await schedule("op-1", -MINUTE_MS, "storage.ownerDeleteContinued", {
        cursor: "c",
      });

      const claimed = await scheduler.claimDue(backend.clock.now(), 10);
      expect(claimed).toHaveLength(2);
      expect(
        claimed.find((task) => task.kind === "usage.userCleanupContinued")
          ?.payload,
      ).toEqual({ cursor: "b" });
    });

    it("completes a task so it is never claimed again", async () => {
      await schedule("op-1", -MINUTE_MS);
      await scheduler.complete("usage.userCleanupContinued", "op-1");

      expect(await scheduler.claimDue(backend.clock.now(), 10)).toEqual([]);
      // Completing an absent task is a no-op, not an error, and so is
      // backing one off: a completed turn has nothing left to retry.
      await scheduler.complete("usage.userCleanupContinued", "op-1");
      await scheduler.backoff(
        "usage.userCleanupContinued",
        "op-1",
        backend.clock.now(),
      );
      expect(await scheduler.claimDue(backend.clock.now(), 10)).toEqual([]);
    });

    it("backs off the same row exponentially instead of adding a task", async () => {
      await schedule("op-1", -MINUTE_MS);
      const now = backend.clock.now();

      await scheduler.backoff("usage.userCleanupContinued", "op-1", now);
      expect(await scheduler.claimDue(now, 10)).toEqual([]);

      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      const first = await scheduler.claimDue(backend.clock.now(), 10);
      expect(first).toHaveLength(1);
      expect(first[0]?.attempt).toBe(1);

      await scheduler.backoff(
        "usage.userCleanupContinued",
        "op-1",
        backend.clock.now(),
      );
      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      // The second delay is twice the first, so the row is not due yet.
      expect(await scheduler.claimDue(backend.clock.now(), 10)).toEqual([]);
      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      expect(await scheduler.claimDue(backend.clock.now(), 10)).toHaveLength(1);
    });

    it("backs off a row that does not exist yet by minting it", async () => {
      const now = backend.clock.now();

      await scheduler.backoffOrSchedule({
        kind: "storage.ownerDeleteContinued",
        operationId: "op-1",
        payload: { deletionOperationId: "d1" },
        now,
      });
      expect(await scheduler.claimDue(now, 10)).toEqual([]);

      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      const claimed = await scheduler.claimDue(backend.clock.now(), 10);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.attempt).toBe(1);
      expect(claimed[0]?.payload).toEqual({ deletionOperationId: "d1" });

      // An existing row is backed off, not restarted.
      await scheduler.backoffOrSchedule({
        kind: "storage.ownerDeleteContinued",
        operationId: "op-1",
        payload: { deletionOperationId: "d1" },
        now: backend.clock.now(),
      });
      backend.clock.advance(2 * SCOPE_TASK_BACKOFF_BASE_MS);
      expect(
        (await scheduler.claimDue(backend.clock.now(), 10))[0]?.attempt,
      ).toBe(2);
    });

    it("parks a task as failed once the attempt cap is reached", async () => {
      await schedule("op-1", -MINUTE_MS);

      for (let attempt = 0; attempt < SCOPE_TASK_MAX_ATTEMPTS; attempt += 1) {
        await scheduler.backoff(
          "usage.userCleanupContinued",
          "op-1",
          backend.clock.now(),
        );
        backend.clock.advance(24 * 60 * MINUTE_MS);
      }

      expect(await scheduler.claimDue(backend.clock.now(), 10)).toEqual([]);
      // Rescheduling revives a failed row as a fresh attempt.
      await schedule("op-1", -MINUTE_MS);
      expect(await scheduler.claimDue(backend.clock.now(), 10)).toHaveLength(1);
    });

    it("lists due tasks across scopes for the runner, in dueAt order", async () => {
      await schedule("op-1", -MINUTE_MS);
      await backend.forScope(scopeOf(2)).scopeTaskScheduler.schedule({
        kind: "storage.ownerDeleteContinued",
        operationId: "op-2",
        dueAt: new Date(backend.clock.now().getTime() - 2 * MINUTE_MS),
        payload: {},
      });
      await backend.forScope(scopeOf(2)).scopeTaskScheduler.schedule({
        kind: "storage.ownerDeleteContinued",
        operationId: "op-3",
        dueAt: new Date(backend.clock.now().getTime() + MINUTE_MS),
        payload: {},
      });

      const due = await backend.scopeTaskQueue.listDue(backend.clock.now(), 10);
      expect(due.map((task) => task.operationId)).toEqual(["op-2", "op-1"]);
      expect(due[0]?.scope).toEqual(scopeOf(2));

      expect(
        await backend.scopeTaskQueue.listDue(backend.clock.now(), 1),
      ).toHaveLength(1);
    });
  });
}
