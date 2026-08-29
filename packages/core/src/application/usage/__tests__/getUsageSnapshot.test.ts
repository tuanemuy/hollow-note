import type { UsageReader } from "@repo/core/application/di/types";
import { ScopeKey } from "@repo/core/application/scope";
import { User } from "@repo/core/domain/identity/user";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
import { LlmUsage } from "@repo/core/domain/usage/llmUsage";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import {
  BillingPeriod,
  QuotaSubject,
} from "@repo/core/domain/usage/valueObject";
import {
  MembershipId,
  WorkspaceId,
  WorkspaceName,
  type WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import {
  type GetUsageSnapshotInput,
  getUsageSnapshot,
} from "../getUsageSnapshot";
import { recalculateStorageUsage } from "../recalculateStorageUsage";

const USER_ID = "user-1";
const userId = UserId.create(USER_ID);
const subject = QuotaSubject.user(userId);
const scope = ScopeKey.user(userId);
const noteOwner = NoteOwner.user(userId);

const GIB = 1024 * 1024 * 1024;
const USER_LIMIT_BYTES = 5 * GIB;
const WORKSPACE_LIMIT_BYTES = 20 * GIB;

const snapshot = (
  h: TestHarness,
  overrides: Partial<GetUsageSnapshotInput> = {},
) =>
  getUsageSnapshot({
    container: h.container,
    input: { userId: USER_ID, ...overrides },
  });

/**
 * The membership directory refuses an edge whose User is not active, so
 * the viewer has to exist before any workspace can be joined.
 */
async function seedActiveUser(h: TestHarness): Promise<void> {
  await h.container.globalUnitOfWorkProvider.run((ctx) =>
    ctx.userRepository.insert(
      User.createVerified(
        { id: USER_ID, email: "user-1@example.test", displayName: "User One" },
        h.clock.now(),
      ).entity,
    ),
  );
}

/** Settles one active directory edge and projects its display row. */
async function joinWorkspace(
  h: TestHarness,
  rawWorkspaceId: string,
  role: WorkspaceRole,
): Promise<void> {
  const workspaceId = WorkspaceId.create(rawWorkspaceId);
  const operationId = `edge-${rawWorkspaceId}`;
  const store = h.container.membershipDirectoryReservationStore;
  await store.reserveAndClaimActivation({
    operationId,
    userId,
    workspaceId,
    membershipId: MembershipId.create(`membership-${rawWorkspaceId}`),
    role,
    expiresAt: new Date(h.clock.now().getTime() + 60_000),
  });
  await store.activate(operationId);
  await h.container.workspaceDirectoryProjectionWriter.applySnapshotIfNewer({
    workspaceId,
    name: WorkspaceName.create(`Workspace ${rawWorkspaceId}`),
    slug: null,
    avatarUrl: null,
    publication: "private",
    sourceVersion: 1,
  });
}

async function seedWorkspaceQuota(
  h: TestHarness,
  rawWorkspaceId: string,
  totals: Readonly<{ consumedBytes: number; noteCount: number }>,
): Promise<void> {
  const workspaceId = WorkspaceId.create(rawWorkspaceId);
  const workspaceSubject = QuotaSubject.workspace(workspaceId);
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(workspaceId),
    (ctx) =>
      ctx.storageQuotaRepository.insert(
        StorageQuota.replaceTotals(
          StorageQuota.initialize(workspaceSubject, now),
          totals,
          now,
        ),
      ),
  );
}

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

  it("TC-usage-048: both owned workspaces report their own consumption", async () => {
    const h = createTestHarness();
    await seedActiveUser(h);
    await joinWorkspace(h, "ws-01", "owner");
    await joinWorkspace(h, "ws-02", "owner");
    await seedWorkspaceQuota(h, "ws-01", { consumedBytes: 10, noteCount: 1 });
    await seedWorkspaceQuota(h, "ws-02", { consumedBytes: 20, noteCount: 2 });

    const view = await snapshot(h);

    expect(view.workspaces).toEqual([
      {
        state: "available",
        workspaceId: "ws-01",
        workspaceName: "Workspace ws-01",
        consumedBytes: 10,
        limitBytes: WORKSPACE_LIMIT_BYTES,
        noteCount: 1,
        level: "none",
      },
      {
        state: "available",
        workspaceId: "ws-02",
        workspaceName: "Workspace ws-02",
        consumedBytes: 20,
        limitBytes: WORKSPACE_LIMIT_BYTES,
        noteCount: 2,
        level: "none",
      },
    ]);
    expect(view.nextWorkspaceCursor).toBeNull();
  });

  it("TC-usage-049: an editor membership is included", async () => {
    const h = createTestHarness();
    await seedActiveUser(h);
    await joinWorkspace(h, "ws-01", "editor");
    await seedWorkspaceQuota(h, "ws-01", { consumedBytes: 7, noteCount: 3 });

    expect((await snapshot(h)).workspaces).toEqual([
      {
        state: "available",
        workspaceId: "ws-01",
        workspaceName: "Workspace ws-01",
        consumedBytes: 7,
        limitBytes: WORKSPACE_LIMIT_BYTES,
        noteCount: 3,
        level: "none",
      },
    ]);
  });

  it("TC-usage-050: an owned and an editor workspace both appear", async () => {
    const h = createTestHarness();
    await seedActiveUser(h);
    await joinWorkspace(h, "ws-01", "owner");
    await joinWorkspace(h, "ws-02", "editor");

    const view = await snapshot(h);

    expect(view.workspaces.map((item) => item.workspaceId)).toEqual([
      "ws-01",
      "ws-02",
    ]);
  });

  it("TC-usage-051: 45 memberships page at 20 with at most 6 concurrent scope reads", async () => {
    const h = createTestHarness();
    await seedActiveUser(h);
    for (let index = 1; index <= 45; index += 1) {
      await joinWorkspace(h, `ws-${String(index).padStart(2, "0")}`, "editor");
    }

    let inFlight = 0;
    let peak = 0;
    let workspaceReads = 0;
    const traced = {
      ...h.container,
      usageReaderFor: (target: ScopeKey): UsageReader => {
        const reader = h.container.usageReaderFor(target);
        if (target.type !== "workspace") {
          return reader;
        }
        return {
          ...reader,
          storageQuota: {
            ...reader.storageQuota,
            find: async (quotaSubject) => {
              workspaceReads += 1;
              inFlight += 1;
              peak = Math.max(peak, inFlight);
              try {
                // Yield so a wider fan-out would overlap here.
                await Promise.resolve();
                return await reader.storageQuota.find(quotaSubject);
              } finally {
                inFlight -= 1;
              }
            },
          },
        };
      },
    };

    const view = await getUsageSnapshot({
      container: traced,
      input: { userId: USER_ID },
    });

    expect(view.workspaces).toHaveLength(20);
    expect(workspaceReads).toBe(20);
    expect(peak).toBeLessThanOrEqual(6);
    expect(view.nextWorkspaceCursor).not.toBeNull();
  });

  it("TC-usage-052: one unreachable scope degrades only its own row", async () => {
    const h = createTestHarness();
    await seedActiveUser(h);
    await joinWorkspace(h, "ws-01", "owner");
    await joinWorkspace(h, "ws-02", "owner");
    await seedWorkspaceQuota(h, "ws-02", { consumedBytes: 20, noteCount: 2 });
    const failing = {
      ...h.container,
      usageReaderFor: (target: ScopeKey): UsageReader => {
        const reader = h.container.usageReaderFor(target);
        if (target.type !== "workspace" || target.workspaceId !== "ws-01") {
          return reader;
        }
        return {
          ...reader,
          storageQuota: {
            ...reader.storageQuota,
            find: () => Promise.reject(new Error("scope unreachable")),
          },
        };
      },
    };

    const view = await getUsageSnapshot({
      container: failing,
      input: { userId: USER_ID },
    });

    expect(view.workspaces).toEqual([
      {
        state: "unavailable",
        workspaceId: "ws-01",
        workspaceName: "Workspace ws-01",
      },
      {
        state: "available",
        workspaceId: "ws-02",
        workspaceName: "Workspace ws-02",
        consumedBytes: 20,
        limitBytes: WORKSPACE_LIMIT_BYTES,
        noteCount: 2,
        level: "none",
      },
    ]);
    expect(view.personal.limitBytes).toBe(USER_LIMIT_BYTES);
  });

  it("TC-usage-053: the next page continues without repeating the first", async () => {
    const h = createTestHarness();
    await seedActiveUser(h);
    for (let index = 1; index <= 25; index += 1) {
      await joinWorkspace(h, `ws-${String(index).padStart(2, "0")}`, "editor");
    }

    const first = await snapshot(h);
    const second = await snapshot(h, {
      workspaceCursor: first.nextWorkspaceCursor,
    });

    const firstIds = first.workspaces.map((item) => item.workspaceId);
    const secondIds = second.workspaces.map((item) => item.workspaceId);
    expect(firstIds).toHaveLength(20);
    expect(secondIds).toHaveLength(5);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(second.nextWorkspaceCursor).toBeNull();
  });

  it("TC-usage-054: a viewer-only membership is left out", async () => {
    const h = createTestHarness();
    await seedActiveUser(h);
    await joinWorkspace(h, "ws-01", "viewer");
    await joinWorkspace(h, "ws-02", "editor");

    expect((await snapshot(h)).workspaces.map((i) => i.workspaceId)).toEqual([
      "ws-02",
    ]);
  });

  it("a workspace with no quota row reports the initialized values and creates nothing", async () => {
    const h = createTestHarness();
    await seedActiveUser(h);
    await joinWorkspace(h, "ws-01", "owner");

    const view = await snapshot(h);

    expect(view.workspaces[0]).toMatchObject({
      state: "available",
      consumedBytes: 0,
      noteCount: 0,
      limitBytes: WORKSPACE_LIMIT_BYTES,
    });
    expect(
      h.backend
        .scope(ScopeKey.workspace(WorkspaceId.create("ws-01")))
        .storageQuotas.values(),
    ).toHaveLength(0);
  });

  it("TC-usage-055: a viewer in no workspace gets an empty workspace list", async () => {
    const h = createTestHarness();
    await seedQuota(h, { consumedBytes: GIB, noteCount: 1 });

    const view = await snapshot(h);

    expect(view.workspaces).toEqual([]);
    expect(view.nextWorkspaceCursor).toBeNull();
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
