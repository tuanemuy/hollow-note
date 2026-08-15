import {
  isSystemError,
  SystemError,
  SystemErrorCode,
} from "@repo/core/application/errors";
import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { LlmUsage } from "@repo/core/domain/usage/llmUsage";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import {
  BillingPeriod,
  QuotaSubject,
} from "@repo/core/domain/usage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { USAGE_USER_CLEANUP_TASK_KIND } from "../../cleanup/participants";
import type { WorkerContainer } from "../../di/types";
import { deleteQuota } from "../deleteQuota";

const USER_ID = "user-1";
const WORKSPACE_ID = "workspace-1";
const OPERATION_ID = "deletion-1";
const userId = UserId.create(USER_ID);
const workspaceId = WorkspaceId.create(WORKSPACE_ID);
const scope = ScopeKey.user(userId);
const workspaceScope = ScopeKey.workspace(workspaceId);

const openBarrier = (h: TestHarness, target: ScopeKey = scope) =>
  h.container.scopeUnitOfWorkProvider.run(target, (ctx) =>
    ctx.cleanupAdmission.beginPersonalAccountDeletion(OPERATION_ID, userId),
  );

const seedQuota = (h: TestHarness, subject: QuotaSubject, target: ScopeKey) =>
  h.container.scopeUnitOfWorkProvider.run(target, (ctx) =>
    ctx.storageQuotaRepository.insert(
      StorageQuota.initialize(subject, h.clock.now()),
    ),
  );

const seedLlmMonths = (h: TestHarness, months: number) =>
  h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    for (let i = 0; i < months; i += 1) {
      const year = 2020 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      await ctx.llmUsageRepository.insert(
        LlmUsage.initialize(
          userId,
          BillingPeriod.create(year, month),
          h.clock.now(),
        ),
      );
    }
  });

/** Container that loses the commit once the continuation is armed. */
const withLostCommitAfterSchedule = (h: TestHarness): WorkerContainer => ({
  ...h.workerContainer,
  scopeUnitOfWorkProvider: {
    run: (target, fn) =>
      h.workerContainer.scopeUnitOfWorkProvider.run(target, (ctx) =>
        fn({
          ...ctx,
          scopeTaskScheduler: {
            ...ctx.scopeTaskScheduler,
            schedule: async (input) => {
              await ctx.scopeTaskScheduler.schedule(input);
              throw new SystemError(
                SystemErrorCode.DatabaseError,
                "commit lost after the continuation was armed",
              );
            },
          },
        }),
      ),
  },
});

const run = (
  h: TestHarness,
  overrides: Partial<{
    scope: ScopeKey;
    commandKey: string;
    container: WorkerContainer;
  }> = {},
) =>
  deleteQuota({
    container: overrides.container ?? h.workerContainer,
    input: {
      deletionOperationId: OPERATION_ID,
      scope: overrides.scope ?? scope,
      ...(overrides.commandKey !== undefined
        ? { commandKey: overrides.commandKey }
        : {}),
    },
  });

const quotaRows = (h: TestHarness, target: ScopeKey = scope) =>
  h.backend.scope(target).storageQuotas.values();

const llmRows = (h: TestHarness) => h.backend.scope(scope).llmUsages.values();

const tasks = (h: TestHarness) =>
  h.backend
    .scope(scope)
    .scheduledTasks.values()
    .filter((task) => task.kind === USAGE_USER_CLEANUP_TASK_KIND);

const acknowledged = (h: TestHarness, target: ScopeKey = scope) =>
  h.backend.scope(target).cleanupReceipts.values()[0]?.acknowledged ?? [];

describe("deleteQuota", () => {
  it("TC-usage-026: a user subject loses its quota row and its LLM records", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedQuota(h, QuotaSubject.user(userId), scope);
    await seedLlmMonths(h, 3);

    const turn = await run(h);

    expect(turn.status).toBe("settled");
    expect(quotaRows(h)).toHaveLength(0);
    expect(llmRows(h)).toHaveLength(0);
    expect(acknowledged(h)).toContain("usage");
  });

  it("TC-usage-027: a workspace subject loses its quota row only, LLM records being the user's", async () => {
    const h = createTestHarness();
    await openBarrier(h, workspaceScope);
    await seedQuota(h, QuotaSubject.workspace(workspaceId), workspaceScope);
    await seedLlmMonths(h, 2);

    const turn = await run(h, { scope: workspaceScope });

    expect(turn.status).toBe("settled");
    expect(quotaRows(h, workspaceScope)).toHaveLength(0);
    expect(llmRows(h)).toHaveLength(2);
    expect(acknowledged(h, workspaceScope)).toContain("usage");
  });

  it("TC-usage-028: a subject that is already gone still settles", async () => {
    const h = createTestHarness();
    await openBarrier(h);

    const turn = await run(h);

    expect(turn.status).toBe("settled");
    expect(acknowledged(h)).toContain("usage");
  });

  it("TC-usage-029: receiving the same command twice changes nothing", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedQuota(h, QuotaSubject.user(userId), scope);
    await seedLlmMonths(h, 2);

    await run(h);
    const second = await run(h);

    expect(second.status).toBe("settled");
    expect(quotaRows(h)).toHaveLength(0);
    expect(llmRows(h)).toHaveLength(0);
    expect(acknowledged(h).filter((c) => c === "usage")).toHaveLength(1);
  });

  it("TC-usage-030: every recorded month is removed", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedLlmMonths(h, 30);

    await run(h);

    expect(llmRows(h)).toHaveLength(0);
  });

  it("TC-usage-032: 250 months are removed in pages of 100, acknowledging only after the short page", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedLlmMonths(h, 250);

    const first = await run(h);
    expect(first.status).toBe("continued");
    expect(llmRows(h)).toHaveLength(150);
    expect(tasks(h)).toHaveLength(1);
    expect(acknowledged(h)).not.toContain("usage");

    const second = await run(h);
    expect(second.status).toBe("continued");
    expect(llmRows(h)).toHaveLength(50);
    // The continuation is one row, re-armed rather than multiplied.
    expect(tasks(h)).toHaveLength(1);

    const third = await run(h);
    expect(third.status).toBe("settled");
    expect(llmRows(h)).toHaveLength(0);
    expect(tasks(h)).toHaveLength(0);
    expect(acknowledged(h)).toContain("usage");
  });

  it("TC-usage-032: losing the commit after the continuation is armed takes the deleted page back with it", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedQuota(h, QuotaSubject.user(userId), scope);
    await seedLlmMonths(h, 250);

    await expect(
      run(h, { container: withLostCommitAfterSchedule(h) }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isSystemError(error) && error.code === SystemErrorCode.DatabaseError,
    );

    expect(llmRows(h)).toHaveLength(250);
    expect(quotaRows(h)).toHaveLength(1);
    expect(tasks(h)).toHaveLength(0);
    expect(acknowledged(h)).not.toContain("usage");
  });

  it("TC-usage-033: a lost response after a page resumes from what is left", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedLlmMonths(h, 120);

    await run(h);
    // The response of the first page was lost, so the same turn is
    // re-driven: the months already gone are not restored.
    const resumed = await run(h);

    expect(resumed.status).toBe("settled");
    expect(llmRows(h)).toHaveLength(0);
    expect(acknowledged(h)).toContain("usage");
  });

  it("suppresses a redelivered initial command through the applied-operation record", async () => {
    const h = createTestHarness();
    await openBarrier(h);
    await seedQuota(h, QuotaSubject.user(userId), scope);

    const first = await run(h, { commandKey: `${OPERATION_ID}:cleanup:usage` });
    const second = await run(h, {
      commandKey: `${OPERATION_ID}:cleanup:usage`,
    });

    expect(first.status).toBe("settled");
    expect(second.status).toBe("alreadyApplied");
  });

  it("refuses a command whose operation does not own the scope", async () => {
    const h = createTestHarness();
    await openBarrier(h);

    await expect(
      deleteQuota({
        container: h.workerContainer,
        input: { deletionOperationId: "deletion-other", scope },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "CLEANUP_OPERATION_MISMATCH",
    );
  });
});
