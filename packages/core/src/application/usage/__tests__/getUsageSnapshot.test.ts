import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
import { LlmUsage } from "@repo/core/domain/usage/llmUsage";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import {
  BillingPeriod,
  QuotaSubject,
} from "@repo/core/domain/usage/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { getUsageSnapshot } from "../getUsageSnapshot";
import { recalculateStorageUsage } from "../recalculateStorageUsage";

const USER_ID = "user-1";
const userId = UserId.create(USER_ID);
const subject = QuotaSubject.user(userId);
const scope = ScopeKey.user(userId);
const noteOwner = NoteOwner.user(userId);

const GIB = 1024 * 1024 * 1024;
const USER_LIMIT_BYTES = 5 * GIB;

const snapshot = (h: TestHarness) =>
  getUsageSnapshot({ container: h.container, input: { userId: USER_ID } });

const quotaRows = (h: TestHarness) => h.backend.scope(scope).storageQuotas;
const llmRows = (h: TestHarness) => h.backend.scope(scope).llmUsages;

async function seedQuota(
  h: TestHarness,
  totals: Readonly<{ consumedBytes: number; noteCount: number }>,
): Promise<void> {
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.storageQuotaRepository.insert(
      StorageQuota.replaceTotals(
        StorageQuota.initialize(subject, now),
        totals,
        now,
      ),
    ),
  );
}

async function seedLlmUsage(h: TestHarness, calls: number): Promise<void> {
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.llmUsageRepository.insert(
      LlmUsage.consume(
        LlmUsage.initialize(userId, BillingPeriod.of(now), now),
        calls,
        now,
      ),
    ),
  );
}

async function seedNote(h: TestHarness, id: string, trashed: boolean) {
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    const created = Note.createBlank(
      {
        id: NoteId.create(id),
        owner: noteOwner,
        createdBy: userId,
        title: id,
        projectionRevision: 1,
      },
      now,
    );
    await ctx.noteRepository.insert(
      trashed ? Note.trash(created.entity, now).entity : created.entity,
    );
  });
}

describe("getUsageSnapshot", () => {
  it("TC-usage-044: reports consumption, limit and note count with level none", async () => {
    const h = createTestHarness();
    await seedQuota(h, { consumedBytes: GIB, noteCount: 12 });

    const view = await snapshot(h);

    expect(view.personal).toEqual({
      consumedBytes: GIB,
      limitBytes: USER_LIMIT_BYTES,
      noteCount: 12,
      level: "none",
    });
    expect(view.updatedAt).toEqual(h.clock.now());
  });

  it("TC-usage-045: 80% of the limit is the warning boundary", async () => {
    const h = createTestHarness();
    await seedQuota(h, {
      consumedBytes: USER_LIMIT_BYTES * 0.8,
      noteCount: 1,
    });

    expect((await snapshot(h)).personal.level).toBe("warning");
  });

  it("TC-usage-046: 79% of the limit stays at level none", async () => {
    const h = createTestHarness();
    await seedQuota(h, {
      consumedBytes: Math.floor(USER_LIMIT_BYTES * 0.79),
      noteCount: 1,
    });

    expect((await snapshot(h)).personal.level).toBe("none");
  });

  it("TC-usage-047: consumption past the limit reports exceeded", async () => {
    const h = createTestHarness();
    await seedQuota(h, { consumedBytes: USER_LIMIT_BYTES + 1, noteCount: 1 });

    expect((await snapshot(h)).personal.level).toBe("exceeded");
  });

  it("TC-usage-055: a viewer in no workspace gets an empty workspace list", async () => {
    const h = createTestHarness();
    await seedQuota(h, { consumedBytes: GIB, noteCount: 1 });

    expect((await snapshot(h)).workspaces).toEqual([]);
  });

  it("TC-usage-056: a missing quota row answers with the initialized values and creates nothing", async () => {
    const h = createTestHarness();

    const view = await snapshot(h);

    expect(view.personal).toEqual({
      consumedBytes: 0,
      limitBytes: USER_LIMIT_BYTES,
      noteCount: 0,
      level: "none",
    });
    expect(quotaRows(h).values()).toHaveLength(0);
  });

  it("TC-usage-057: this month's LLM calls are reported with their period", async () => {
    const h = createTestHarness();
    await seedLlmUsage(h, 100);

    const view = await snapshot(h);

    expect(view.llm.consumedCalls).toBe(100);
    expect(view.llm.limitCalls).toBe(300);
    expect(view.llm.period).toEqual(BillingPeriod.of(h.clock.now()));
    expect(view.llm.level).toBe("none");
  });

  it("TC-usage-058: a missing LLM row answers with the initialized values and creates nothing", async () => {
    const h = createTestHarness();

    const view = await snapshot(h);

    expect(view.llm.consumedCalls).toBe(0);
    expect(view.llm.period).toEqual(BillingPeriod.of(h.clock.now()));
    expect(llmRows(h).values()).toHaveLength(0);
  });

  it("TC-usage-059: trashed notes are counted in the reported usage", async () => {
    const h = createTestHarness();
    await seedNote(h, "note-1", false);
    await seedNote(h, "note-2", true);
    await recalculateStorageUsage({
      container: h.container,
      input: { userId: USER_ID, subjectType: "user", subjectId: USER_ID },
    });

    expect((await snapshot(h)).personal.noteCount).toBe(2);
  });
});
