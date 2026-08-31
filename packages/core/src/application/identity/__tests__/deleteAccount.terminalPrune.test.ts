import { ScopeTaskPriority } from "@repo/core/application/ports/scopeTaskScheduler";
import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { REQUIRED_PERSONAL_CLEANUP_COMPONENTS } from "../../cleanup/participants";
import {
  PERSONAL_BARRIER_PRUNE_TASK_KIND,
  prunePersonalCleanupBarriers,
} from "../../cleanup/personalCleanup";
import type { WorkerContainer } from "../../di/types";
import {
  ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
  type AccountDeletionTerminalPruneView,
  pruneAccountDeletionManifests,
} from "../deleteAccount/terminalPrune";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const operationKey = (i: number): string => `op-${String(i).padStart(4, "0")}`;

/** A settled deletion as the compaction leaves it behind. */
const seedTerminal = (
  h: TestHarness,
  operationId: string,
  retainUntil: Date,
): void => {
  const now = h.clock.now();
  h.backend.manifestHeaders.set(operationId, {
    operationId,
    userId: UserId.create(`user-of-${operationId}`),
    status: "completed",
    membershipCursor: null,
    authorRouteCursor: null,
    receipts: ["personalCleanup", "authResidue", "uniquenessRelease"],
    terminalAt: now,
    retainUntil,
  });
  h.backend.distributedOperations.set(operationId, {
    id: operationId,
    kind: "accountDeletion",
    partitionKey: `user-of-${operationId}`,
    requestKey: `request-of-${operationId}`,
    state: "completed",
    payload: {},
    createdAt: now,
    updatedAt: now,
    terminalAt: now,
  });
};

const seedRunning = (h: TestHarness, operationId: string): void => {
  const now = h.clock.now();
  h.backend.manifestHeaders.set(operationId, {
    operationId,
    userId: UserId.create(`user-of-${operationId}`),
    status: "building",
    membershipCursor: null,
    authorRouteCursor: null,
    receipts: [],
    terminalAt: null,
    retainUntil: null,
  });
  h.backend.distributedOperations.set(operationId, {
    id: operationId,
    kind: "accountDeletion",
    partitionKey: `user-of-${operationId}`,
    requestKey: `request-of-${operationId}`,
    state: "running",
    payload: {},
    createdAt: now,
    updatedAt: now,
    terminalAt: null,
  });
};

const cron = (h: TestHarness) =>
  pruneAccountDeletionManifests({
    container: h.workerContainer,
    input: { type: "cron" },
  });

const runRow = (h: TestHarness) =>
  h.backend.maintenanceRuns
    .values()
    .find((run) => run.kind === "accountManifestPrune");

const laneCursor = (h: TestHarness, shardId: string): string | null =>
  runRow(h)?.lanes.find((row) => row.shardId === shardId)?.cursor ?? null;

/**
 * Seeds `count` due headers, opens a run and claims its lane, handing
 * back the continuation entry point the queue would drive.
 */
const startLane = async (
  h: TestHarness,
  count: number,
): Promise<
  Readonly<{
    shardId: string;
    turn: (
      cursor: string | null,
      container?: WorkerContainer,
    ) => Promise<AccountDeletionTerminalPruneView>;
  }>
> => {
  const retainUntil = new Date(h.clock.now().getTime() + 120 * DAY_MS);
  for (let i = 0; i < count; i += 1) {
    seedTerminal(h, operationKey(i), retainUntil);
  }
  h.clock.advance(120 * DAY_MS);
  const asOf = h.clock.now();
  const begun = await h.workerContainer.maintenanceRunStore.beginOrResumeKind({
    candidateRunId: "run-1",
    kind: "accountManifestPrune",
    candidateAsOf: asOf,
    generations: h.workerContainer.routingGenerations,
    leaseOwner: ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
    leaseUntil: new Date(asOf.getTime() + HOUR_MS),
  });
  const [lane] = await h.workerContainer.maintenanceRunStore.claimLanes(
    begun.runId,
    ACCOUNT_MANIFEST_PRUNE_LEASE_OWNER,
    1,
  );
  if (lane === undefined) {
    throw new Error("the run has no lane to claim");
  }
  return {
    shardId: lane.shardId,
    turn: (cursor, container = h.workerContainer) =>
      pruneAccountDeletionManifests({
        container,
        input: {
          type: "identity.accountDeletionManifestPruneContinued",
          runId: begun.runId,
          generation: lane.generation,
          shardId: lane.shardId,
          cursor,
          asOf,
        },
      }),
  };
};

describe("deleteAccount terminal prune", () => {
  it("TC-identity-104: 101 expired headers are reclaimed with their operations, running ones are kept", async () => {
    const h = createTestHarness();
    const retainUntil = new Date(h.clock.now().getTime() + 120 * DAY_MS);
    for (let i = 0; i < 101; i += 1) {
      seedTerminal(h, operationKey(i), retainUntil);
    }
    seedRunning(h, "op-live");
    h.clock.advance(120 * DAY_MS);

    const view = await cron(h);

    expect(view.removed).toBe(101);
    expect(h.backend.manifestHeaders.values().map((row) => row.operationId)) //
      .toEqual(["op-live"]);
    expect(h.backend.distributedOperations.values().map((row) => row.id)) //
      .toEqual(["op-live"]);
  });

  it("TC-identity-109: the retention deadline is inclusive, one millisecond later is not", async () => {
    const h = createTestHarness();
    const asOf = new Date(h.clock.now().getTime() + 120 * DAY_MS);
    seedTerminal(h, "op-due", asOf);
    seedTerminal(h, "op-later", new Date(asOf.getTime() + 1));
    h.clock.advance(120 * DAY_MS);

    const view = await cron(h);

    expect(view.removed).toBe(1);
    expect(h.backend.manifestHeaders.values().map((row) => row.operationId)) //
      .toEqual(["op-later"]);
  });

  it("TC-identity-105: a redelivered continuation resumes from the same asOf and cursor without gaps", async () => {
    const h = createTestHarness();
    const { shardId, turn } = await startLane(h, 101);

    const first = await turn(null);
    expect(first).toEqual({ removed: 100, continued: true });
    expect(laneCursor(h, shardId)).not.toBeNull();

    // The page committed and the checkpoint with it; what was lost is the
    // response, so the very same input arrives again.
    const replay = await turn(null);

    expect(replay).toEqual({ removed: 1, continued: false });
    expect(h.backend.manifestHeaders.values()).toEqual([]);
    expect(h.backend.distributedOperations.values()).toEqual([]);
  });

  it("TC-identity-107: a lane that stopped before its checkpoint re-runs the same cursor and then checkpoints the next one", async () => {
    const h = createTestHarness();
    const { shardId, turn } = await startLane(h, 201);
    const store = h.workerContainer.maintenanceRunStore;
    const withoutCheckpoint: WorkerContainer = {
      ...h.workerContainer,
      maintenanceRunStore: {
        ...store,
        checkpointLane: () =>
          Promise.reject(new Error("stopped before the checkpoint")),
      },
    };

    await expect(turn(null, withoutCheckpoint)).rejects.toThrow(
      "stopped before the checkpoint",
    );
    // The delete lives on the target shard and the checkpoint on the
    // catalog: the first committed, the second never did.
    expect(h.backend.manifestHeaders.values()).toHaveLength(101);
    expect(laneCursor(h, shardId)).toBeNull();

    const replay = await turn(null);

    expect(replay).toEqual({ removed: 100, continued: true });
    const checkpointed = laneCursor(h, shardId);
    expect(checkpointed).not.toBeNull();
    expect(h.backend.manifestHeaders.values()).toHaveLength(1);

    expect(await turn(checkpointed)).toEqual({ removed: 1, continued: false });
    expect(h.backend.manifestHeaders.values()).toEqual([]);
    expect(h.backend.distributedOperations.values()).toEqual([]);
  });

  it("TC-identity-106: an unfinished run is resumed with its original asOf, at most six lanes at a time", async () => {
    const shards = Array.from({ length: 32 }, (_, i) => `shard-${i}`);
    const h = createTestHarness({ maintenanceShardIds: shards });
    const retainUntil = new Date(h.clock.now().getTime() + 120 * DAY_MS);
    seedTerminal(h, operationKey(0), retainUntil);
    h.clock.advance(120 * DAY_MS);
    const firstAsOf = h.clock.now();

    await cron(h);
    const afterFirst = runRow(h);
    expect(afterFirst?.status).toBe("running");
    expect(afterFirst?.asOf).toEqual(firstAsOf);
    expect(
      afterFirst?.lanes.filter((lane) => lane.status === "done"),
    ).toHaveLength(6);
    expect(
      afterFirst?.lanes.filter((lane) => lane.status === "claimed"),
    ).toHaveLength(0);

    // The next hour's cron finds the run still going and continues it
    // rather than starting a second one on a newer boundary.
    h.clock.advance(HOUR_MS);
    await cron(h);

    const afterSecond = runRow(h);
    expect(afterSecond?.runId).toBe(afterFirst?.runId);
    expect(afterSecond?.asOf).toEqual(firstAsOf);
    expect(
      afterSecond?.lanes.filter((lane) => lane.status === "done"),
    ).toHaveLength(12);
    expect(
      h.backend.maintenanceRuns
        .values()
        .filter((run) => run.kind === "accountManifestPrune"),
    ).toHaveLength(1);
  });
});

describe("personal barrier prune", () => {
  const scopeOf = (userId: string) => ScopeKey.user(UserId.create(userId));

  const completeBarrier = async (
    h: TestHarness,
    userId: string,
    operationId: string,
    retainUntil: Date,
  ): Promise<void> => {
    await h.container.scopeUnitOfWorkProvider.run(
      scopeOf(userId),
      async (ctx) => {
        await ctx.cleanupAdmission.beginPersonalAccountDeletion(
          operationId,
          UserId.create(userId),
        );
        for (const component of REQUIRED_PERSONAL_CLEANUP_COMPONENTS) {
          await ctx.cleanupAdmission.acknowledgePersonalComponent(
            operationId,
            component,
          );
        }
        await ctx.cleanupAdmission.markCompleted(operationId, retainUntil);
        await ctx.scopeTaskScheduler.schedule({
          kind: PERSONAL_BARRIER_PRUNE_TASK_KIND,
          operationId,
          priority: ScopeTaskPriority.expiryCollection,
          dueAt: retainUntil,
          payload: { deletionOperationId: operationId },
        });
      },
    );
  };

  it("TC-identity-110: the completed receipt is reclaimed at its deadline while a running barrier is left alone", async () => {
    const h = createTestHarness();
    const retainUntil = new Date(h.clock.now().getTime() + 120 * DAY_MS);
    await completeBarrier(h, "user-done", "op-done", retainUntil);
    await h.container.scopeUnitOfWorkProvider.run(
      scopeOf("user-running"),
      (ctx) =>
        ctx.cleanupAdmission.beginPersonalAccountDeletion(
          "op-running",
          UserId.create("user-running"),
        ),
    );
    h.clock.advance(120 * DAY_MS);

    const settled = await prunePersonalCleanupBarriers(h.workerContainer, {
      scope: scopeOf("user-done"),
      operationId: "op-done",
      asOf: h.clock.now(),
    });
    await prunePersonalCleanupBarriers(h.workerContainer, {
      scope: scopeOf("user-running"),
      operationId: "op-running",
      asOf: h.clock.now(),
    });

    expect(settled.status).toBe("settled");
    expect(
      h.backend.scope(scopeOf("user-done")).cleanupReceipts.values(),
    ).toEqual([]);
    expect(
      h.backend.scope(scopeOf("user-running")).cleanupReceipts.values(),
    ).toHaveLength(1);
  });

  it("TC-identity-111: the prune task outlives a lost response, so the receipt is still reclaimed", async () => {
    const h = createTestHarness();
    const retainUntil = new Date(h.clock.now().getTime() + 120 * DAY_MS);
    await completeBarrier(h, "user-done", "op-done", retainUntil);

    // The completion response never reached the orchestrator; the task
    // it stored in the same transaction is what carries the deadline.
    const scheduled = h.backend
      .scope(scopeOf("user-done"))
      .scheduledTasks.values()
      .filter((task) => task.kind === PERSONAL_BARRIER_PRUNE_TASK_KIND)
      .filter((task) => task.state === "pending");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.dueAt).toEqual(retainUntil);

    h.clock.advance(120 * DAY_MS);
    const due = await h.workerContainer.scopeTaskQueue.listDue(
      h.clock.now(),
      10,
    );
    expect(due).toContainEqual({
      scope: scopeOf("user-done"),
      kind: PERSONAL_BARRIER_PRUNE_TASK_KIND,
      operationId: "op-done",
    });

    await prunePersonalCleanupBarriers(h.workerContainer, {
      scope: scopeOf("user-done"),
      operationId: "op-done",
      asOf: h.clock.now(),
    });

    expect(
      h.backend.scope(scopeOf("user-done")).cleanupReceipts.values(),
    ).toEqual([]);
  });
});
