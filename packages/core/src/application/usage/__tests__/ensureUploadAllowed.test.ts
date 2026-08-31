import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { UsageErrorCode } from "@repo/core/domain/usage/errorCode";
import { LlmUsage } from "@repo/core/domain/usage/llmUsage";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import {
  BillingPeriod,
  LlmCallQuota,
  QuotaSubject,
} from "@repo/core/domain/usage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { expectBusinessRule } from "../../workspace/__tests__/harness";
import {
  type EnsureUploadAllowedInput,
  ensureUploadAllowed,
} from "../ensureUploadAllowed";

const USER_ID = "user-1";
const WORKSPACE_ID = "workspace-1";
const userId = UserId.create(USER_ID);
const workspaceId = WorkspaceId.create(WORKSPACE_ID);
const userSubject = QuotaSubject.user(userId);
const workspaceSubject = QuotaSubject.workspace(workspaceId);
const userScope = ScopeKey.user(userId);
const workspaceScope = ScopeKey.workspace(workspaceId);

const GIB = 1024 * 1024 * 1024;
/** `ByteQuota.defaultFor`, which the two subject types do not share. */
const USER_LIMIT_BYTES = 5 * GIB;
const WORKSPACE_LIMIT_BYTES = 20 * GIB;
const LLM_LIMIT_CALLS = LlmCallQuota.default().limit;

const ensure = (
  h: TestHarness,
  overrides: Partial<EnsureUploadAllowedInput> = {},
) =>
  ensureUploadAllowed({
    container: h.container,
    input: {
      subjectType: "user",
      subjectId: USER_ID,
      userId: USER_ID,
      totalBytes: 1,
      llmCalls: 0,
      ...overrides,
    },
  });

/** Writes the subject's quota row with `consumedBytes` already spent. */
async function seedStorage(
  h: TestHarness,
  params: Readonly<{ subject: "user" | "workspace"; consumedBytes: number }>,
): Promise<void> {
  const now = h.clock.now();
  const subject = params.subject === "user" ? userSubject : workspaceSubject;
  const scope = params.subject === "user" ? userScope : workspaceScope;
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storageQuotaRepository.insert(
      StorageQuota.replaceTotals(
        StorageQuota.initialize(subject, now),
        { consumedBytes: params.consumedBytes, noteCount: 0 },
        now,
      ),
    ),
  );
}

/** The requester's own monthly LLM row, which always lives in their scope. */
async function seedLlmUsage(h: TestHarness, calls: number): Promise<void> {
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(userScope, (ctx) =>
    ctx.llmUsageRepository.insert(
      LlmUsage.consume(
        LlmUsage.initialize(userId, BillingPeriod.of(now), now),
        calls,
        now,
      ),
    ),
  );
}

const storageRows = (h: TestHarness, scope: ScopeKey) =>
  h.backend.scope(scope).storageQuotas.values();

const llmRows = (h: TestHarness) =>
  h.backend.scope(userScope).llmUsages.values();

describe("ensureUploadAllowed", () => {
  it("TC-usage-034 / TC-usage-035 / TC-usage-036: judges the upload against what the subject has left", async () => {
    const h = createTestHarness();
    await seedStorage(h, {
      subject: "user",
      consumedBytes: USER_LIMIT_BYTES - 64,
    });

    await expect(ensure(h, { totalBytes: 63 })).resolves.toBeUndefined();
    await expect(ensure(h, { totalBytes: 64 })).resolves.toBeUndefined();
    await expectBusinessRule(
      ensure(h, { totalBytes: 65 }),
      UsageErrorCode.StorageQuotaExceeded,
    );
  });

  it("TC-usage-040: a subject with no quota row is judged at the initial values, and no row is written", async () => {
    const h = createTestHarness();

    await expect(
      ensure(h, { totalBytes: USER_LIMIT_BYTES }),
    ).resolves.toBeUndefined();
    await expectBusinessRule(
      ensure(h, { totalBytes: USER_LIMIT_BYTES + 1 }),
      UsageErrorCode.StorageQuotaExceeded,
    );
    // Reads only: the row is minted by the first delta, not by a check.
    expect(storageRows(h, userScope)).toHaveLength(0);
  });

  it("TC-usage-042: a workspace subject is judged by the workspace's own limit and row", async () => {
    const h = createTestHarness();
    // The requester's personal subject is full; the workspace's is not.
    await seedStorage(h, { subject: "user", consumedBytes: USER_LIMIT_BYTES });
    await seedStorage(h, {
      subject: "workspace",
      consumedBytes: WORKSPACE_LIMIT_BYTES - 64,
    });

    const workspaceUpload: Partial<EnsureUploadAllowedInput> = {
      subjectType: "workspace",
      subjectId: WORKSPACE_ID,
    };
    await expect(
      ensure(h, { ...workspaceUpload, totalBytes: 64 }),
    ).resolves.toBeUndefined();
    await expectBusinessRule(
      ensure(h, { ...workspaceUpload, totalBytes: 65 }),
      UsageErrorCode.StorageQuotaExceeded,
    );
  });

  it("TC-usage-037 / TC-usage-038: the LLM allowance is the requester's own, whoever owns the bytes", async () => {
    const h = createTestHarness();
    await seedStorage(h, { subject: "workspace", consumedBytes: 0 });
    await seedLlmUsage(h, LLM_LIMIT_CALLS - 1);

    const workspaceUpload: Partial<EnsureUploadAllowedInput> = {
      subjectType: "workspace",
      subjectId: WORKSPACE_ID,
    };
    await expect(
      ensure(h, { ...workspaceUpload, llmCalls: 1 }),
    ).resolves.toBeUndefined();
    await expectBusinessRule(
      ensure(h, { ...workspaceUpload, llmCalls: 2 }),
      UsageErrorCode.LlmQuotaExceeded,
    );
  });

  it("TC-usage-039: no LLM record means no call yet this month, not no allowance", async () => {
    const h = createTestHarness();

    await expect(ensure(h, { llmCalls: 1 })).resolves.toBeUndefined();
    await expect(
      ensure(h, { llmCalls: LLM_LIMIT_CALLS }),
    ).resolves.toBeUndefined();
    await expectBusinessRule(
      ensure(h, { llmCalls: LLM_LIMIT_CALLS + 1 }),
      UsageErrorCode.LlmQuotaExceeded,
    );
    expect(llmRows(h)).toHaveLength(0);
  });

  it("TC-usage-041: an exhausted allowance does not refuse an upload that asks for no call", async () => {
    const h = createTestHarness();
    await seedLlmUsage(h, LLM_LIMIT_CALLS);

    // `llmCalls: 0` is what every upload of this slice passes, and a
    // storage-only upload must not be refused by the LLM half — the
    // second half is the same subject with the call actually asked for.
    await expect(ensure(h, { llmCalls: 0 })).resolves.toBeUndefined();
    await expectBusinessRule(
      ensure(h, { llmCalls: 1 }),
      UsageErrorCode.LlmQuotaExceeded,
    );
  });
});
