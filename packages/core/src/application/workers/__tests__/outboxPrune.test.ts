import type { WorkerContainer } from "@repo/core/application/di/types";
import type { Clock } from "@repo/core/application/ports/clock";
import type { OutboxRepository } from "@repo/core/application/ports/outboxRepository";
import { describe, expect, it, vi } from "vitest";
import { FakeLogger } from "../../__tests__/fakes";
import { createTestHarness } from "../../__tests__/helpers";
import { pruneOutbox } from "../outboxPrune";

/**
 * The worker is a thin orchestrator around the repository, so the
 * `OutboxRepository` is faked through a vitest mock instead of a DB —
 * that is what lets these tests assert exactly which `Date` cutoff
 * reaches the adapter.
 */

function makeFixedClock(at: Date): Clock {
  return { now: () => at };
}

type StubRepoOptions = {
  deleted: number;
  pruneSpy?: (olderThan: Date) => void;
};

function makeStubOutboxRepository({
  deleted,
  pruneSpy,
}: StubRepoOptions): OutboxRepository {
  return {
    save: vi.fn(async () => {}),
    claimPending: vi.fn(async () => []),
    finalize: vi.fn(async () => {}),
    pruneProcessed: vi.fn(async (olderThan: Date) => {
      pruneSpy?.(olderThan);
      return { deleted };
    }),
  };
}

function makeContainer(overrides: Partial<WorkerContainer>): WorkerContainer {
  // The worker reaches for `clock`, `logger`, `outboxRepository`. The
  // remaining deps come from the real memory runtime since they aren't
  // observed by `pruneOutbox`; only the three above are stubbed.
  return {
    ...createTestHarness().workerContainer,
    outboxRepository:
      overrides.outboxRepository ?? makeStubOutboxRepository({ deleted: 0 }),
    idempotencyStore: {
      markProcessed: vi.fn(async () => true),
    },
    maintenanceRunStore: {
      beginOrResumeKind: vi.fn(async () => ({
        runId: "run",
        asOf: new Date(0),
        result: "started" as const,
      })),
      claimLanes: vi.fn(async () => []),
      checkpointLane: vi.fn(async () => {}),
      advanceOrAck: vi.fn(async () => ({ next: null, runCompleted: false })),
      recoverLease: vi.fn(async () => false),
      pruneCompleted: vi.fn(async () => ({ removed: 0, nextCursor: null })),
    },
    routingGenerations: ["gen-1"],
    authStateSweeps: {
      sessions: {
        deleteExpired: async () => ({ deleted: 0, nextCursor: null }),
      },
      auth_tokens: {
        deleteExpired: async () => ({ deleted: 0, nextCursor: null }),
      },
      login_attempts: {
        deleteExpired: async () => ({ deleted: 0, nextCursor: null }),
      },
      oauth_flow_states: {
        deleteExpired: async () => ({ deleted: 0, nextCursor: null }),
      },
    },
    clock: overrides.clock ?? { now: () => new Date(0) },
    idGenerator: {
      next: () => "00000000-0000-7000-8000-000000000000",
      validate: () => true,
    },
    logger: overrides.logger ?? new FakeLogger(),
    ...overrides,
  };
}

describe("pruneOutbox", () => {
  it("computes the cutoff as clock.now() - retentionMs and forwards it to the repository", async () => {
    const now = new Date("2026-04-27T12:00:00Z");
    const retentionMs = 7 * 24 * 60 * 60 * 1000;
    let received: Date | undefined;
    const outboxRepository = makeStubOutboxRepository({
      deleted: 3,
      pruneSpy: (olderThan) => {
        received = olderThan;
      },
    });
    const container = makeContainer({
      clock: makeFixedClock(now),
      outboxRepository,
    });

    const result = await pruneOutbox(container, { retentionMs });

    expect(result).toEqual({ deleted: 3 });
    expect(received).toBeInstanceOf(Date);
    expect(received?.getTime()).toBe(now.getTime() - retentionMs);
  });

  it("returns the count from the repository unchanged", async () => {
    const outboxRepository = makeStubOutboxRepository({ deleted: 42 });
    const container = makeContainer({ outboxRepository });

    const { deleted } = await pruneOutbox(container, { retentionMs: 1_000 });
    expect(deleted).toBe(42);
  });

  it("emits a structured info log with the deleted count, retention, and cutoff", async () => {
    const now = new Date("2026-04-27T12:00:00Z");
    const retentionMs = 60 * 1000;
    const logger = new FakeLogger();
    const outboxRepository = makeStubOutboxRepository({ deleted: 5 });
    const container = makeContainer({
      clock: makeFixedClock(now),
      outboxRepository,
      logger,
    });

    await pruneOutbox(container, { retentionMs });

    const infos = logger.byLevel("info");
    expect(infos).toHaveLength(1);
    const entry = infos[0];
    expect(entry?.message).toMatch(/pruned 5/);
    expect(entry?.meta?.deleted).toBe(5);
    expect(entry?.meta?.retentionMs).toBe(retentionMs);
    expect(entry?.meta?.cutoff).toBe(
      new Date(now.getTime() - retentionMs).toISOString(),
    );
  });

  it("logs even when nothing was deleted", async () => {
    const logger = new FakeLogger();
    const container = makeContainer({
      logger,
      outboxRepository: makeStubOutboxRepository({ deleted: 0 }),
    });

    const { deleted } = await pruneOutbox(container, { retentionMs: 1_000 });

    expect(deleted).toBe(0);
    const infos = logger.byLevel("info");
    expect(infos).toHaveLength(1);
    expect(infos[0]?.meta?.deleted).toBe(0);
  });
});
