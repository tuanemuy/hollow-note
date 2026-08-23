import { beforeEach, describe, expect, it } from "vitest";
import {
  SCOPE_TASK_BACKOFF_BASE_MS,
  SCOPE_TASK_LEASE_MS,
  SCOPE_TASK_MAX_ATTEMPTS,
  ScopeTaskPriority,
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
 * the same table, `ScopeTaskQueue.listDue`: deterministic upsert per
 * `(kind, operationId)`, the priority-reserved selection order, the
 * claim lease and its reclaim, and the exponential backoff that ends in
 * `failed`.
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
      priority: ScopeTaskPriority = ScopeTaskPriority.securityCleanup,
    ): Promise<void> =>
      scheduler.schedule({
        kind,
        operationId,
        priority,
        dueAt: new Date(backend.clock.now().getTime() + dueOffsetMs),
        payload,
      });

    const claim = (limit: number, leaseMs = SCOPE_TASK_LEASE_MS) =>
      scheduler.claimDue({ now: backend.clock.now(), limit, leaseMs });

    const parkAsFailed = async (operationId: string): Promise<void> => {
      await schedule(operationId, -MINUTE_MS);
      for (let attempt = 0; attempt < SCOPE_TASK_MAX_ATTEMPTS; attempt += 1) {
        await scheduler.backoff(
          "usage.userCleanupContinued",
          operationId,
          backend.clock.now(),
        );
        backend.clock.advance(24 * 60 * MINUTE_MS);
      }
    };

    it("claims only tasks whose dueAt has passed", async () => {
      await schedule("op-1", -MINUTE_MS);
      await schedule("op-2", MINUTE_MS);

      const claimed = await claim(10);
      expect(claimed.map((task) => task.operationId)).toEqual(["op-1"]);
      expect(claimed[0]?.payload).toEqual({ deletionOperationId: "d1" });
      expect(claimed[0]?.attempt).toBe(0);
      expect(claimed[0]?.priority).toBe(ScopeTaskPriority.securityCleanup);
      expect(claimed[0]?.leaseExpiresAt).toEqual(
        new Date(backend.clock.now().getTime() + SCOPE_TASK_LEASE_MS),
      );
    });

    it("claims in dueAt order and respects the limit", async () => {
      await schedule("op-late", -MINUTE_MS);
      await schedule("op-early", -2 * MINUTE_MS);

      expect((await claim(1)).map((task) => task.operationId)).toEqual([
        "op-early",
      ]);
    });

    it("returns nothing for a limit of zero or less", async () => {
      await schedule("op-1", -MINUTE_MS);

      expect(await claim(0)).toEqual([]);
      expect(await claim(-1)).toEqual([]);
      expect(
        await backend.scopeTaskQueue.listDue(backend.clock.now(), 0),
      ).toEqual([]);
      // A negative limit is its own case on the read side: `LIMIT -1`
      // means unbounded in SQLite / D1, so passing it straight through
      // hands back the whole backlog while the zero case still passes.
      expect(
        await backend.scopeTaskQueue.listDue(backend.clock.now(), -1),
      ).toEqual([]);
    });

    it("orders by priority before dueAt, and returns in that order", async () => {
      await schedule(
        "op-late-cleanup",
        -MINUTE_MS,
        "usage.userCleanupContinued",
        {},
        ScopeTaskPriority.securityCleanup,
      );
      await schedule(
        "op-early-expiry",
        -10 * MINUTE_MS,
        "identity.personalBarrierPruneContinued",
        {},
        ScopeTaskPriority.expiryCollection,
      );
      await schedule(
        "op-early-relay",
        -5 * MINUTE_MS,
        "outbox.relayContinued",
        {},
        ScopeTaskPriority.outboxRelay,
      );

      expect((await claim(10)).map((task) => task.operationId)).toEqual([
        "op-late-cleanup",
        "op-early-relay",
        "op-early-expiry",
      ]);
    });

    it("reserves a slot for a low priority a backlog of high ones would crowd out", async () => {
      for (let i = 0; i < 5; i += 1) {
        await schedule(
          `op-cleanup-${i}`,
          -10 * MINUTE_MS,
          "usage.userCleanupContinued",
          {},
          ScopeTaskPriority.securityCleanup,
        );
      }
      await schedule(
        "op-expiry",
        -MINUTE_MS,
        "identity.personalBarrierPruneContinued",
        {},
        ScopeTaskPriority.expiryCollection,
      );

      const claimed = await claim(3);
      expect(claimed.map((task) => task.operationId)).toEqual([
        "op-cleanup-0",
        "op-cleanup-1",
        "op-expiry",
      ]);
    });

    it("puts a high priority ahead of an older low-priority backlog", async () => {
      for (let i = 0; i < 5; i += 1) {
        await schedule(
          `op-expiry-${i}`,
          -10 * MINUTE_MS,
          "identity.personalBarrierPruneContinued",
          {},
          ScopeTaskPriority.expiryCollection,
        );
      }
      await schedule(
        "op-cleanup",
        -MINUTE_MS,
        "usage.userCleanupContinued",
        {},
        ScopeTaskPriority.securityCleanup,
      );

      expect((await claim(2)).map((task) => task.operationId)).toEqual([
        "op-cleanup",
        "op-expiry-0",
      ]);
    });

    it("lets one priority take the whole limit when it is the only one due", async () => {
      for (let i = 0; i < 10; i += 1) {
        await schedule(
          `op-${i}`,
          -MINUTE_MS,
          "usage.userCleanupContinued",
          {},
          ScopeTaskPriority.securityCleanup,
        );
      }

      expect(await claim(10)).toHaveLength(10);
    });

    it("degrades to strict priority order when the limit is below the number of priorities", async () => {
      const priorities = [
        ScopeTaskPriority.securityCleanup,
        ScopeTaskPriority.outboxRelay,
        ScopeTaskPriority.projection,
        ScopeTaskPriority.expiryCollection,
      ];
      for (const priority of priorities) {
        await schedule(
          `op-p${priority}`,
          -MINUTE_MS,
          `kind.p${priority}`,
          {},
          priority,
        );
      }

      expect((await claim(2)).map((task) => task.operationId)).toEqual([
        "op-p0",
        "op-p1",
      ]);
    });

    it("reserves the earliest row of each priority, so the claimed set is determined", async () => {
      await schedule(
        "op-cleanup-early",
        -2 * MINUTE_MS,
        "usage.userCleanupContinued",
        {},
        ScopeTaskPriority.securityCleanup,
      );
      await schedule(
        "op-cleanup-late",
        -MINUTE_MS,
        "usage.userCleanupContinued",
        {},
        ScopeTaskPriority.securityCleanup,
      );
      await schedule(
        "op-expiry",
        -MINUTE_MS,
        "identity.personalBarrierPruneContinued",
        {},
        ScopeTaskPriority.expiryCollection,
      );

      expect((await claim(2)).map((task) => task.operationId)).toEqual([
        "op-cleanup-early",
        "op-expiry",
      ]);
    });

    it("holds a claimed row for the leaseMs it was given, hiding it from a second claim and from listDue", async () => {
      // The deadline is the caller's `leaseMs`, not a constant the
      // backend picks: away from the default, a backend that ignores the
      // argument gets both the deadline and its boundary wrong.
      const leaseMs = 2 * MINUTE_MS;
      await schedule("op-1", -MINUTE_MS);

      const claimed = await claim(10, leaseMs);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.leaseExpiresAt).toEqual(
        new Date(backend.clock.now().getTime() + leaseMs),
      );
      expect(await claim(10, leaseMs)).toEqual([]);
      expect(
        await backend.scopeTaskQueue.listDue(backend.clock.now(), 10),
      ).toEqual([]);

      backend.clock.advance(leaseMs - 1);
      expect(await claim(10, leaseMs)).toEqual([]);

      backend.clock.advance(1);
      expect(
        (await claim(10, leaseMs)).map((task) => task.operationId),
      ).toEqual(["op-1"]);
    });

    it("reclaims a row whose lease lapsed, with its dueAt, attempt and priority intact", async () => {
      // A row that has already burned an attempt and carries a priority
      // other than the helper default, so a reclaim that resets either
      // one is visible instead of landing back on the same value.
      await schedule(
        "op-early",
        0,
        "usage.userCleanupContinued",
        { deletionOperationId: "d1" },
        ScopeTaskPriority.expiryCollection,
      );
      await scheduler.backoff(
        "usage.userCleanupContinued",
        "op-early",
        backend.clock.now(),
      );
      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS + MINUTE_MS);
      await schedule(
        "op-late",
        -MINUTE_MS / 2,
        "usage.userCleanupContinued",
        {},
        ScopeTaskPriority.expiryCollection,
      );

      const [first] = await claim(1);
      expect(first?.operationId).toBe("op-early");
      expect(first?.attempt).toBe(1);

      backend.clock.advance(SCOPE_TASK_LEASE_MS);
      const reclaimed = await claim(10);

      // The reclaimed row kept its place: `dueAt` did not move to the
      // claim that lapsed, and the lease cost it no attempt.
      expect(reclaimed.map((task) => task.operationId)).toEqual([
        "op-early",
        "op-late",
      ]);
      expect(reclaimed[0]?.dueAt).toEqual(first?.dueAt);
      expect(reclaimed[0]?.attempt).toBe(1);
      expect(reclaimed[0]?.priority).toBe(ScopeTaskPriority.expiryCollection);
      expect(reclaimed[0]?.payload).toEqual({ deletionOperationId: "d1" });

      // Reclaiming takes a fresh lease rather than handing the row out
      // bare: without it the next claim of the same round redistributes
      // a row whose turn is still running.
      expect(reclaimed[0]?.leaseExpiresAt).toEqual(
        new Date(backend.clock.now().getTime() + SCOPE_TASK_LEASE_MS),
      );
      expect(await claim(10)).toEqual([]);
    });

    it("breaks ties within a priority and dueAt on (kind, operationId)", async () => {
      const dueOffset = -MINUTE_MS;
      await schedule("op-2", dueOffset, "usage.userCleanupContinued");
      await schedule("op-1", dueOffset, "usage.userCleanupContinued");
      await schedule("op-2", dueOffset, "storage.ownerDeleteContinued");
      await schedule("op-1", dueOffset, "storage.ownerDeleteContinued");

      const keyOf = (task: { kind: string; operationId: string }) =>
        `${task.kind}/${task.operationId}`;

      // The limit cuts one determined order, so the tie decides which
      // rows are claimed and not only how they are arranged.
      expect((await claim(2)).map(keyOf)).toEqual([
        "storage.ownerDeleteContinued/op-1",
        "storage.ownerDeleteContinued/op-2",
      ]);
      expect((await claim(2)).map(keyOf)).toEqual([
        "usage.userCleanupContinued/op-1",
        "usage.userCleanupContinued/op-2",
      ]);
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

      const claimed = await claim(10);
      expect(claimed).toHaveLength(2);
      expect(
        claimed.find((task) => task.kind === "usage.userCleanupContinued")
          ?.payload,
      ).toEqual({ cursor: "b" });
    });

    it("re-arms a pending row on schedule, taking the new dueAt, priority and payload", async () => {
      await schedule("op-1", -MINUTE_MS);

      // An upsert that only touches the payload of a row still `pending`
      // leaves it due in the past, so the moved-away-from `dueAt` and the
      // stale priority both survive. Nothing else distinguishes that from
      // a correct re-arm, since the row is claimable either way.
      await schedule(
        "op-1",
        MINUTE_MS,
        "usage.userCleanupContinued",
        { cursor: "next" },
        ScopeTaskPriority.expiryCollection,
      );
      expect(await claim(10)).toEqual([]);

      backend.clock.advance(MINUTE_MS);
      const claimed = await claim(10);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.priority).toBe(ScopeTaskPriority.expiryCollection);
      expect(claimed[0]?.payload).toEqual({ cursor: "next" });
    });

    it("re-arms a running row on schedule, releasing its lease and taking the new dueAt, priority and payload", async () => {
      await schedule("op-1", -MINUTE_MS);
      await claim(10);

      // Re-armed for later than it was: an upsert that keeps the row's
      // own `dueAt` runs the continuation at the moment the caller
      // deliberately moved away from.
      await schedule(
        "op-1",
        MINUTE_MS,
        "usage.userCleanupContinued",
        { cursor: "next" },
        ScopeTaskPriority.expiryCollection,
      );
      expect(await claim(10)).toEqual([]);

      // Still inside the lease the first claim took, so what makes the
      // row claimable here is `schedule` having released it.
      backend.clock.advance(MINUTE_MS);
      const claimed = await claim(10);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.priority).toBe(ScopeTaskPriority.expiryCollection);
      expect(claimed[0]?.payload).toEqual({ cursor: "next" });
    });

    it("completes and backs off a running row by key alone", async () => {
      await schedule("op-complete", -MINUTE_MS);
      await schedule("op-backoff", -MINUTE_MS, "storage.ownerDeleteContinued");
      await claim(10);

      await scheduler.complete("usage.userCleanupContinued", "op-complete");
      await scheduler.backoff(
        "storage.ownerDeleteContinued",
        "op-backoff",
        backend.clock.now(),
      );

      // Crossing the lease is what makes `complete` observable: while it
      // holds, a row that was merely left running is just as invisible as
      // one that was removed.
      backend.clock.advance(SCOPE_TASK_LEASE_MS);
      const claimed = await claim(10);
      expect(claimed.map((task) => task.operationId)).toEqual(["op-backoff"]);
      expect(claimed[0]?.attempt).toBe(1);
    });

    it("keeps the priority and payload of an existing row when backoffOrSchedule stalls it", async () => {
      await schedule(
        "op-cleanup",
        -MINUTE_MS,
        "usage.userCleanupContinued",
        { cursor: "kept" },
        ScopeTaskPriority.securityCleanup,
      );
      await schedule(
        "op-expiry",
        -MINUTE_MS,
        "identity.personalBarrierPruneContinued",
        {},
        ScopeTaskPriority.expiryCollection,
      );

      await scheduler.backoffOrSchedule({
        kind: "usage.userCleanupContinued",
        operationId: "op-cleanup",
        priority: ScopeTaskPriority.expiryCollection,
        payload: { cursor: "ignored" },
        now: backend.clock.now(),
      });

      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      const claimed = await claim(10);
      expect(claimed.map((task) => task.operationId)).toEqual([
        "op-cleanup",
        "op-expiry",
      ]);
      expect(claimed[0]?.payload).toEqual({ cursor: "kept" });
    });

    it("completes a task so it is never claimed again", async () => {
      await schedule("op-1", -MINUTE_MS);
      await scheduler.complete("usage.userCleanupContinued", "op-1");

      expect(await claim(10)).toEqual([]);
      // Completing an absent task is a no-op, not an error, and so is
      // backing one off: a completed turn has nothing left to retry.
      await scheduler.complete("usage.userCleanupContinued", "op-1");
      await scheduler.backoff(
        "usage.userCleanupContinued",
        "op-1",
        backend.clock.now(),
      );
      expect(await claim(10)).toEqual([]);
    });

    it("backs off the same row exponentially instead of adding a task", async () => {
      await schedule("op-1", -MINUTE_MS);

      await scheduler.backoff(
        "usage.userCleanupContinued",
        "op-1",
        backend.clock.now(),
      );
      expect(await claim(10)).toEqual([]);

      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      const first = await claim(10);
      expect(first).toHaveLength(1);
      expect(first[0]?.attempt).toBe(1);

      await scheduler.backoff(
        "usage.userCleanupContinued",
        "op-1",
        backend.clock.now(),
      );
      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      // The second delay is twice the first, so the row is not due yet.
      expect(await claim(10)).toEqual([]);
      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      expect(await claim(10)).toHaveLength(1);
    });

    it("backs off a row that does not exist yet by minting it from the input", async () => {
      // Minted away from the helper default, so a backend that pins a
      // priority instead of reading `input.priority` is visible here
      // rather than landing back on the same value.
      await scheduler.backoffOrSchedule({
        kind: "storage.ownerDeleteContinued",
        operationId: "op-1",
        priority: ScopeTaskPriority.expiryCollection,
        payload: { deletionOperationId: "d1" },
        now: backend.clock.now(),
      });
      expect(await claim(10)).toEqual([]);

      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      const claimed = await claim(10);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.attempt).toBe(1);
      expect(claimed[0]?.payload).toEqual({ deletionOperationId: "d1" });
      expect(claimed[0]?.priority).toBe(ScopeTaskPriority.expiryCollection);

      // An existing row is backed off, not restarted.
      await scheduler.backoffOrSchedule({
        kind: "storage.ownerDeleteContinued",
        operationId: "op-1",
        priority: ScopeTaskPriority.expiryCollection,
        payload: { deletionOperationId: "d1" },
        now: backend.clock.now(),
      });
      backend.clock.advance(2 * SCOPE_TASK_BACKOFF_BASE_MS);
      expect((await claim(10))[0]?.attempt).toBe(2);
    });

    it("parks a task as failed once the attempt cap is reached, hiding it from both reads", async () => {
      await parkAsFailed("op-1");

      expect(await claim(10)).toEqual([]);
      // A parked row is no reason to wake its scope either: the runner
      // would find nothing to claim there, every tick, forever.
      expect(
        await backend.scopeTaskQueue.listDue(backend.clock.now(), 10),
      ).toEqual([]);
    });

    it("keeps a failed task failed through either retry variant", async () => {
      await parkAsFailed("op-1");

      // Neither variant is a way back, however far the clock moves: were
      // one to fall to pending, a poison turn would retry forever and
      // `SCOPE_TASK_MAX_ATTEMPTS` would buy nothing. `backoffOrSchedule`
      // is the trap of the two — reading a failed row as absent mints it
      // afresh, and an operation re-entered by event takes that path.
      await scheduler.backoff(
        "usage.userCleanupContinued",
        "op-1",
        backend.clock.now(),
      );
      await scheduler.backoffOrSchedule({
        kind: "usage.userCleanupContinued",
        operationId: "op-1",
        priority: ScopeTaskPriority.securityCleanup,
        payload: {},
        now: backend.clock.now(),
      });
      backend.clock.advance(365 * 24 * 60 * MINUTE_MS);
      expect(await claim(10)).toEqual([]);
    });

    it("revives a failed task on schedule, as a fresh attempt", async () => {
      await parkAsFailed("op-1");

      await schedule("op-1", -MINUTE_MS);

      // `schedule` is the only way back, so an upsert that carries the
      // exhausted `attempt` over disarms the sole recovery there is: the
      // revived row falls straight back to failed on its next backoff.
      const revived = await claim(10);
      expect(revived).toHaveLength(1);
      expect(revived[0]?.attempt).toBe(0);
    });

    it("removes a failed task on complete, freeing its key", async () => {
      await parkAsFailed("op-1");

      await scheduler.complete("usage.userCleanupContinued", "op-1");

      // Settling reaches a row in any state, so the key is absent again
      // and mints rather than staying parked — otherwise one exhausted
      // row would block that continuation for the process's lifetime.
      await scheduler.backoffOrSchedule({
        kind: "usage.userCleanupContinued",
        operationId: "op-1",
        priority: ScopeTaskPriority.securityCleanup,
        payload: {},
        now: backend.clock.now(),
      });
      backend.clock.advance(SCOPE_TASK_BACKOFF_BASE_MS);
      const minted = await claim(10);
      expect(minted).toHaveLength(1);
      expect(minted[0]?.attempt).toBe(1);
    });

    it("lists due tasks across scopes for the runner, in dueAt order", async () => {
      await schedule("op-1", -MINUTE_MS);
      await backend.forScope(scopeOf(2)).scopeTaskScheduler.schedule({
        kind: "storage.ownerDeleteContinued",
        operationId: "op-2",
        priority: ScopeTaskPriority.securityCleanup,
        dueAt: new Date(backend.clock.now().getTime() - 2 * MINUTE_MS),
        payload: {},
      });
      await backend.forScope(scopeOf(2)).scopeTaskScheduler.schedule({
        kind: "storage.ownerDeleteContinued",
        operationId: "op-3",
        priority: ScopeTaskPriority.securityCleanup,
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

    it("reserves a slot across scopes, so a scope holding only low priority is still listed", async () => {
      for (let i = 0; i < 3; i += 1) {
        await backend.forScope(scopeOf(1)).scopeTaskScheduler.schedule({
          kind: "usage.userCleanupContinued",
          operationId: `op-cleanup-${i}`,
          priority: ScopeTaskPriority.securityCleanup,
          dueAt: new Date(backend.clock.now().getTime() - 10 * MINUTE_MS),
          payload: {},
        });
      }
      await backend.forScope(scopeOf(2)).scopeTaskScheduler.schedule({
        kind: "identity.personalBarrierPruneContinued",
        operationId: "op-expiry",
        priority: ScopeTaskPriority.expiryCollection,
        dueAt: new Date(backend.clock.now().getTime() - MINUTE_MS),
        payload: {},
      });

      const due = await backend.scopeTaskQueue.listDue(backend.clock.now(), 2);
      expect(due.map((task) => task.operationId)).toEqual([
        "op-cleanup-0",
        "op-expiry",
      ]);
      expect(due[1]?.scope).toEqual(scopeOf(2));

      // Leases hide rows from the cross-scope read too: with every row
      // of scope 1 claimed, only the other scope is left to list.
      expect(await claim(10)).toHaveLength(3);
      const afterClaim = await backend.scopeTaskQueue.listDue(
        backend.clock.now(),
        10,
      );
      expect(afterClaim.map((task) => task.operationId)).toEqual(["op-expiry"]);
      expect(afterClaim[0]?.scope).toEqual(scopeOf(2));
    });

    it("lists a scope again once the lease on its rows lapses", async () => {
      await schedule("op-1", -MINUTE_MS);
      expect(await claim(10)).toHaveLength(1);
      expect(
        await backend.scopeTaskQueue.listDue(backend.clock.now(), 10),
      ).toEqual([]);

      // Leases only hide rows. Their lapsing is how the central runner
      // rediscovers a scope whose writer stopped mid-turn: nothing else
      // puts that scope back in front of it.
      backend.clock.advance(SCOPE_TASK_LEASE_MS);
      const afterLapse = await backend.scopeTaskQueue.listDue(
        backend.clock.now(),
        10,
      );
      expect(afterLapse.map((task) => task.operationId)).toEqual(["op-1"]);
      expect(afterLapse[0]?.scope).toEqual(scopeOf(1));
    });
  });
}
