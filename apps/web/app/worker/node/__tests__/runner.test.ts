import {
  createTestHarness,
  type TestHarness,
} from "@repo/core/application/__tests__/helpers";
import { describe, expect, it, vi } from "vitest";
import { createNodeWorkerRunner, type NodeWorkerRunnerTuning } from "../runner";

// `pruneOutbox` logs one line per round, which makes it the cheapest
// observable for "the prune tick ran".
const pruneRounds = (harness: TestHarness): number =>
  harness.logger.entries.filter((entry) =>
    entry.message.startsWith("[outbox] pruned"),
  ).length;

const createRunner = (
  harness: TestHarness,
  tuning: NodeWorkerRunnerTuning = {},
) =>
  createNodeWorkerRunner({
    container: harness.workerContainer,
    logger: harness.logger,
    consumerHandler: async () => {},
    tuning,
  });

describe("createNodeWorkerRunner", () => {
  it("runs a prune tick at start, so retention does not depend on outliving the interval", async () => {
    const harness = createTestHarness();
    const runner = createRunner(harness);

    runner.start();
    await runner.stop();

    expect(pruneRounds(harness)).toBe(1);
  });

  it("ignores a second start, so a repeated boot does not double the ticks", async () => {
    const harness = createTestHarness();
    const runner = createRunner(harness);

    runner.start();
    runner.start();
    await runner.stop();

    expect(pruneRounds(harness)).toBe(1);
  });

  it("stops ticking once stopped, so a replacement runner is the only one driving the store", async () => {
    vi.useFakeTimers();
    try {
      const harness = createTestHarness();
      const runner = createRunner(harness, {
        relayIntervalMs: 60_000,
        pruneIntervalMs: 1_000,
        scopeTaskIntervalMs: 60_000,
      });

      runner.start();
      await vi.advanceTimersByTimeAsync(2_500);
      expect(pruneRounds(harness)).toBe(3);

      await runner.stop();
      const settled = pruneRounds(harness);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(pruneRounds(harness)).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deregisters its signal listeners on stop, so replacing a runner does not accumulate them", async () => {
    const harness = createTestHarness();
    const sigterm = process.listenerCount("SIGTERM");
    const sigint = process.listenerCount("SIGINT");

    const first = createRunner(harness);
    first.start();
    expect(process.listenerCount("SIGTERM")).toBe(sigterm + 1);
    expect(process.listenerCount("SIGINT")).toBe(sigint + 1);

    await first.stop();
    expect(process.listenerCount("SIGTERM")).toBe(sigterm);
    expect(process.listenerCount("SIGINT")).toBe(sigint);

    const second = createRunner(harness);
    second.start();
    expect(process.listenerCount("SIGTERM")).toBe(sigterm + 1);

    await second.stop();
    expect(process.listenerCount("SIGTERM")).toBe(sigterm);
  });
});
