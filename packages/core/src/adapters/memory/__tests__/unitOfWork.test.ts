import { beforeEach, describe, expect, it } from "vitest";
import type {
  ScopeUnitOfWorkContext,
  ScopeUnitOfWorkProvider,
} from "../../../application/execution/unitOfWork";
import {
  SCOPE_TASK_LEASE_MS,
  ScopeTaskPriority,
} from "../../../application/ports/scopeTaskScheduler";
import type { ConformanceBackend } from "../../conformance/backend";
import { makePendingUser, scopeOf, userId } from "../../conformance/fixtures";
import { createTestClock } from "../../conformance/testClock";
import { createMemoryScopeUnitOfWorkProvider } from "../scopeUnitOfWork";
import { MemoryBackend } from "../store";
import { makeMemoryConformanceBackend } from "./conformanceBackend";

// Backend-local, NOT part of the shared conformance suite: mutex
// serialization is the in-memory approximation of transaction isolation.
// A real transactional backend (D1/DO) interleaves callbacks and must
// still be correct, so the shared suite asserts only per-run atomicity.
describe("memory global unit of work serialization (spec/adr/024)", () => {
  let backend: ConformanceBackend;

  beforeEach(() => {
    backend = makeMemoryConformanceBackend();
  });

  it("runs concurrent unit of works one after another instead of interleaving", async () => {
    const now = backend.clock.now();
    const order: string[] = [];

    await Promise.all([
      backend.globalUnitOfWork.run(async (ctx) => {
        order.push("first:start");
        await ctx.userRepository.insert(makePendingUser(1, now));
        await Promise.resolve();
        order.push("first:end");
      }),
      backend.globalUnitOfWork.run(async (ctx) => {
        order.push("second:start");
        await ctx.userRepository.insert(makePendingUser(2, now));
        order.push("second:end");
      }),
    ]);

    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
    expect(await backend.userRepository.findById(userId(1))).not.toBeNull();
    expect(await backend.userRepository.findById(userId(2))).not.toBeNull();
  });
});

// Backend-local as well: the trigger is an option of this provider
// (`createMemoryRuntime` binds the runner's own), so the shared
// conformance backend has nothing to observe it with.
describe("memory scope unit of work commit kick (spec/adr/023)", () => {
  const scope = scopeOf(1);
  let backend: MemoryBackend;
  let kicks: number;
  let provider: ScopeUnitOfWorkProvider;

  beforeEach(() => {
    backend = new MemoryBackend({ clock: createTestClock() });
    kicks = 0;
    provider = createMemoryScopeUnitOfWorkProvider(backend, {
      scopeTaskTrigger: {
        kick: () => {
          kicks += 1;
        },
      },
    });
  });

  const scheduleTask = (ctx: ScopeUnitOfWorkContext): Promise<void> =>
    ctx.scopeTaskScheduler.schedule({
      kind: "cleanup.turn",
      operationId: "op-1",
      priority: ScopeTaskPriority.securityCleanup,
      dueAt: backend.clock.now(),
      payload: {},
    });

  const scheduledTasks = () => backend.scope(scope).scheduledTasks.values();

  it("kicks the scope-task runner once when a commit stored a continuation", async () => {
    await provider.run(scope, scheduleTask);

    expect(scheduledTasks()).toHaveLength(1);
    expect(kicks).toBe(1);
  });

  it("leaves the runner alone when the unit of work stored no continuation", async () => {
    await provider.run(scope, async (ctx) => {
      await ctx.scopeTaskScheduler.claimDue({
        now: backend.clock.now(),
        limit: 10,
        leaseMs: SCOPE_TASK_LEASE_MS,
      });
    });

    expect(kicks).toBe(0);
  });

  it("leaves the runner alone when the unit of work rolled back", async () => {
    await expect(
      provider.run(scope, async (ctx) => {
        await scheduleTask(ctx);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(scheduledTasks()).toEqual([]);
    expect(kicks).toBe(0);
  });
});
