import { UserId } from "@repo/core/domain/identity/valueObject";
import {
  MembershipId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import type { WorkerContainer } from "../../di/types";
import { createBlankNote } from "../../note/createBlankNote";
import type { ScopeTaskPayload } from "../../ports/scopeTaskScheduler";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import { acceptInvitation } from "../acceptInvitation";
import { changeWorkspaceSlug } from "../changeWorkspaceSlug";
import { createWorkspace } from "../createWorkspace";
import { deleteWorkspace } from "../deleteWorkspace";
import { getPublicWorkspace } from "../getPublicWorkspace";
import { inviteMember } from "../inviteMember";
import { listUserWorkspaces } from "../listUserWorkspaces";
import { resolveWorkspaceAccess } from "../resolveWorkspaceAccess";
import {
  WORKSPACE_DELETION_COMPACT_TASK_KIND,
  WORKSPACE_DELETION_GLOBAL_TASK_KIND,
  WORKSPACE_DELETION_LOCAL_TASK_KIND,
} from "../workspaceDeletion";
import {
  compactWorkspaceDeletionManifest,
  continueWorkspaceDeletionGlobalCleanup,
} from "../workspaceDeletionGlobal";
import { continueWorkspaceDeletionLocal } from "../workspaceDeletionLocal";
import {
  clearDirectoryOutages,
  createWorkspaceHarness,
  directoryRow,
  drainScopeTasks,
  expectConflict,
  expectNotFound,
  expectValidation,
  induceDirectoryOutage,
  invitationRoutes,
  membershipEdges,
  outboxPayloads,
  outboxTypes,
  runScopeTasks,
  scheduledTasks,
  seedInvitation,
  seedUser,
  seedWorkspace,
  slugReservations,
  storedMemberships,
  storedWorkspace,
  type TestHarness,
  withFailingDirectoryTombstone,
  workspaceScope,
} from "./harness";

/**
 * spec/testcases/workspace/deleteWorkspace.md (TC-workspace-076〜116).
 *
 * Rows that have no executable form in this slice:
 * TC-workspace-080〜091 (the workspace's unfinished jobs — the Job
 * aggregate does not exist), TC-workspace-092 / 094 / 096 / 097 / 098
 * (the `workspace.deleted` subscribers `deleteNotesForOwner` /
 * `deleteTagsForScope` / `deleteBackupRecordsForNote` do not exist yet;
 * 096 / 097 are additionally out of this issue's scope),
 * TC-workspace-108 (already covered by `deletionAdmission.test.ts`) and
 * TC-workspace-112 (a directory reshard is not observable on the
 * reference backend).
 *
 * The saga is driven the way `pnpm dev` drives it — through
 * `runDueScopeTasks` against the real handler registry — so the turn
 * boundaries under test are the ones the runtime actually takes.
 */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const EDITOR = "editor-1";
const VIEWER = "viewer-1";
const SLUG = "team-alpha";
const NAME = "Workspace";

const WORKSPACE_DELETED = "workspace.deleted";

type Turn = Readonly<{ kind: string; payload: ScopeTaskPayload }>;

const seed = (h: TestHarness, extra: Readonly<{ slug?: string | null }> = {}) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name: NAME,
    slug: extra.slug === undefined ? SLUG : extra.slug,
    publication: extra.slug === null ? "private" : "published",
    members: [
      { userId: OWNER, role: "owner", membershipId: "m-owner" },
      { userId: EDITOR, role: "editor", membershipId: "m-editor" },
      { userId: VIEWER, role: "viewer", membershipId: "m-viewer" },
    ],
  });

const accept = (h: TestHarness, userId = OWNER, confirmationName = NAME) =>
  deleteWorkspace({
    container: h.container,
    input: { workspaceId: WORKSPACE, userId, confirmationName },
  });

const pendingTurns = (h: TestHarness): readonly Turn[] =>
  scheduledTasks(h, WORKSPACE).map((row) => ({
    kind: row.kind,
    payload: row.payload,
  }));

/** Re-invokes one turn exactly as a redelivered task row would. */
const redeliver = (h: TestHarness, turn: Turn): Promise<void> => {
  const params = { scope: workspaceScope(WORKSPACE), payload: turn.payload };
  switch (turn.kind) {
    case WORKSPACE_DELETION_LOCAL_TASK_KIND:
      return continueWorkspaceDeletionLocal(h.workerContainer, params);
    case WORKSPACE_DELETION_GLOBAL_TASK_KIND:
      return continueWorkspaceDeletionGlobalCleanup(h.workerContainer, params);
    case WORKSPACE_DELETION_COMPACT_TASK_KIND:
      return compactWorkspaceDeletionManifest(h.workerContainer, params);
    default:
      throw new Error(`unexpected deletion turn ${turn.kind}`);
  }
};

/** Runs `rounds` turns and answers how many actually did work. */
const drive = async (
  h: TestHarness,
  rounds: number,
  container?: WorkerContainer,
): Promise<number> => {
  let processed = 0;
  for (let round = 0; round < rounds; round += 1) {
    const result =
      container === undefined
        ? await runScopeTasks(h)
        : await runDueScopeTasks(container);
    if (result.processed === 0) {
      return processed;
    }
    processed += result.processed;
  }
  return processed;
};

const manifest = (h: TestHarness) => h.backend.scope(workspaceScope(WORKSPACE));

describe("deleteWorkspace", () => {
  it("TC-workspace-076: an owner confirming the name gets accepted, and the saga removes the workspace and emits workspace.deleted", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const answer = await accept(h);
    expect(answer.status).toBe("accepted");
    expect(answer.operationId).not.toBe("");

    await drainScopeTasks(h);

    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(0);
    expect(outboxPayloads(h, WORKSPACE_DELETED)).toEqual([
      { workspaceId: WORKSPACE, operationId: answer.operationId },
    ]);
    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({
        operationId: answer.operationId,
        state: "completed",
      }),
    ]);
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
  });

  it("TC-workspace-077: accepting commits the deleting state and the first turn together, so the saga can resume with no further request", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const { operationId } = await accept(h);

    expect(storedWorkspace(h, WORKSPACE)?.lifecycle).toEqual({
      state: "deleting",
      operationId,
    });
    expect(scheduledTasks(h, WORKSPACE)).toEqual([
      expect.objectContaining({
        kind: WORKSPACE_DELETION_LOCAL_TASK_KIND,
        operationId,
        state: "pending",
        payload: {
          operationId,
          phase: "memberships",
          cursor: null,
          slug: SLUG,
          advertisedSlug: SLUG,
        },
      }),
    ]);

    // Nothing else is asked of the request path: the stored row alone
    // carries the deletion to its end.
    await drainScopeTasks(h);
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
  });

  it("TC-workspace-076: re-requesting a deletion already in flight joins it instead of opening a second one", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const first = await accept(h);
    const second = await accept(h);

    expect(second).toEqual(first);
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(1);
    expect(manifest(h).deletionManifestHeaders.size).toBe(1);
  });

  it("TC-workspace-078: a confirmation name that does not match is CONFIRMATION_MISMATCH and changes nothing", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectValidation(
      accept(h, OWNER, "Workspac"),
      "CONFIRMATION_MISMATCH",
    );
    await expectValidation(accept(h, OWNER, ""), "CONFIRMATION_MISMATCH");

    expect(storedWorkspace(h, WORKSPACE)?.lifecycle.state).toBe("active");
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
    expect(manifest(h).deletionManifestHeaders.size).toBe(0);

    // Surrounding whitespace is trimmed, so a pasted name still matches.
    await expect(accept(h, OWNER, `  ${NAME}  `)).resolves.toMatchObject({
      status: "accepted",
    });
  });

  it("TC-workspace-079: an editor, a viewer and a non-member are all InsufficientRole", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    for (const userId of [EDITOR, VIEWER, "outsider-1"]) {
      await expect(accept(h, userId)).rejects.toMatchObject({
        code: "WORKSPACE_INSUFFICIENT_ROLE",
      });
    }
    expect(storedWorkspace(h, WORKSPACE)?.lifecycle.state).toBe("active");
  });

  it("TC-workspace-093: every member loses the workspace once the saga finishes", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await accept(h);
    await drainScopeTasks(h);

    for (const userId of [OWNER, EDITOR, VIEWER]) {
      await expectNotFound(
        resolveWorkspaceAccess({
          container: h.container,
          input: { workspaceId: WORKSPACE, userId },
        }),
      );
      await expect(
        listUserWorkspaces({ container: h.container, input: { userId } }),
      ).resolves.toMatchObject({ workspaces: [] });
    }
    expect(membershipEdges(h)).toHaveLength(0);
  });

  /**
   * A join whose `activate` was lost twice leaves the edge `activating`
   * while the workspace-local Membership exists, so the manifest names
   * it. The cleanup turn has to be able to end that item: parking on it
   * would leave the deletion permanently unfinished — no completed
   * header, no reclaimed manifest — with no request able to move it on.
   */
  it("TC-workspace-093: a member whose edge never settled does not park the global cleanup", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      name: NAME,
      slug: SLUG,
      publication: "published",
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        {
          userId: EDITOR,
          role: "editor",
          membershipId: "m-editor",
          edge: "none",
        },
      ],
    });
    await h.container.membershipDirectoryReservationStore.reserveAndClaimActivation(
      {
        operationId: "join-editor",
        userId: UserId.create(EDITOR),
        workspaceId: WorkspaceId.create(WORKSPACE),
        membershipId: MembershipId.create("m-editor"),
        role: "editor",
        expiresAt: new Date(h.clock.now().getTime() + 10 * 60 * 1000),
      },
    );
    expect(membershipEdges(h, EDITOR).map((edge) => edge.edgeState)).toEqual([
      "activating",
    ]);

    const { operationId } = await accept(h);
    await drainScopeTasks(h);

    expect(membershipEdges(h)).toHaveLength(0);
    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({ operationId, state: "completed" }),
    ]);
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
  });

  it("TC-workspace-095: the manifest fixes each member's userId and each invitation's tokenHash, and the Workspace row goes last", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const invitation = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
    });

    const { operationId } = await accept(h);

    // memberships → invitations → markReady
    await drive(h, 2);
    const items = manifest(h).deletionManifestItems.values();
    expect(
      items
        .flatMap((item) => (item.kind === "membership" ? [item.userId] : []))
        .sort(),
    ).toEqual([EDITOR, OWNER, VIEWER].sort());
    expect(
      items.flatMap((item) =>
        item.kind === "invitation" ? [item.tokenHash] : [],
      ),
    ).toEqual([invitation.tokenHash]);
    expect(storedWorkspace(h, WORKSPACE)?.lifecycle).toEqual({
      state: "deleting",
      operationId,
    });

    // the local delete page removes the children while the parent stands
    await drive(h, 1);
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(0);
    expect(storedWorkspace(h, WORKSPACE)).not.toBeNull();

    // only the turn that finds no child left retires the parent
    await drive(h, 1);
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(outboxTypes(h)).toContain(WORKSPACE_DELETED);
  });

  it("TC-workspace-099: the slug the deleted workspace held can be taken again", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await accept(h);
    await drainScopeTasks(h);
    expect(slugReservations(h)).toHaveLength(0);

    await expect(
      createWorkspace({
        container: h.container,
        input: { userId: OWNER, name: "Reborn", description: "", slug: SLUG },
      }),
    ).resolves.toMatchObject({ slug: SLUG });
  });

  /**
   * The slug the deletion carries is the one the scope named when the
   * request was accepted, and that is only ever *a* candidate: a rename
   * whose activation was lost for good moved the scope while the global
   * key stayed where it was. The workspace is about to disappear, so this
   * is the last call that could free it, and an `active` reservation has
   * no expiry behind it.
   */
  it("TC-workspace-319: a deletion frees the key the directory advertises, not only the one the scope named", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: "old-slug" });

    const store = h.container.workspaceSlugReservationStore;
    const activateFailure = new Error("reservation shard unreachable");
    await expect(
      changeWorkspaceSlug({
        container: {
          ...h.container,
          workspaceSlugReservationStore: {
            ...store,
            activate: () => Promise.reject(activateFailure),
          },
        },
        input: { workspaceId: WORKSPACE, userId: OWNER, slug: "team-gamma" },
      }),
    ).rejects.toBe(activateFailure);
    expect(storedWorkspace(h, WORKSPACE)?.slug).toBe("team-gamma");
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("old-slug");

    await accept(h);
    await drainScopeTasks(h);

    // `team-gamma` is merely `reserved`, so its expiry collects it; the
    // `active` key the directory advertised is the one that would be lost
    // to every workspace in the service.
    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([["team-gamma", WORKSPACE, "reserved"]]);
  });

  /**
   * The advertised candidate can only be read while the directory row is
   * there, and this deletion is what removes it. A shard that cannot
   * answer therefore is not "this workspace advertises nothing": folding
   * it that way admits a deletion carrying one candidate, and the
   * `active` reservation the directory named would outlive every caller
   * able to free it. Refusing keeps the scope open, which is what leaves
   * the requester somewhere to go.
   */
  it("TC-workspace-326: a deletion is refused while the directory cannot name the advertised key, and frees it once it can", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: "old-slug" });

    const store = h.container.workspaceSlugReservationStore;
    const activateFailure = new Error("reservation shard unreachable");
    await expect(
      changeWorkspaceSlug({
        container: {
          ...h.container,
          workspaceSlugReservationStore: {
            ...store,
            activate: () => Promise.reject(activateFailure),
          },
        },
        input: { workspaceId: WORKSPACE, userId: OWNER, slug: "team-gamma" },
      }),
    ).rejects.toBe(activateFailure);

    induceDirectoryOutage(h, WORKSPACE);
    await expectConflict(accept(h), "WORKSPACE_DIRECTORY_UNAVAILABLE");
    // Nothing was accepted: the scope is untouched and no turn is armed.
    expect(storedWorkspace(h, WORKSPACE)?.lifecycle.state).toBe("active");
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);

    clearDirectoryOutages(h);
    await accept(h);
    await drainScopeTasks(h);

    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([["team-gamma", WORKSPACE, "reserved"]]);
  });

  /**
   * The tombstone is the judgement the public route reads, and the turn
   * runs it before anything else it owes. A shard that refuses it must
   * stop the turn there — a slug freed while the directory row still
   * advertises it hands the next taker a URL two workspaces answer.
   */
  it("TC-workspace-325: a tombstone that never lands backs the turn off with the slug still held", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const { operationId } = await accept(h);

    await drive(h, 8, withFailingDirectoryTombstone(h));

    // The local half is done, the global one has not got past its first
    // act, and the row that drives it is ageing rather than spinning.
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(directoryRow(h, WORKSPACE)?.lifecycle).toBe("active");
    expect(slugReservations(h)).toHaveLength(1);
    expect(scheduledTasks(h, WORKSPACE)).toEqual([
      expect.objectContaining({
        kind: WORKSPACE_DELETION_GLOBAL_TASK_KIND,
        operationId,
        state: "pending",
      }),
    ]);
    expect(scheduledTasks(h, WORKSPACE)[0]?.attempt).toBeGreaterThan(0);

    // Once the shard answers again the same row carries the saga to the end.
    h.clock.advance(60 * 60 * 1000);
    await drainScopeTasks(h);
    expect(directoryRow(h, WORKSPACE)?.lifecycle).toBe("deleting");
    expect(slugReservations(h)).toHaveLength(0);
  });

  it("TC-workspace-100: the directory tombstone drops the slug and the display data, and the slug is freed only after it lands", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { slug: SLUG });
    const { operationId } = await accept(h);

    // Fail the slug release once, so the turn stops between the two.
    const store = h.workerContainer.workspaceSlugReservationStore;
    let failRelease = true;
    const worker: WorkerContainer = {
      ...h.workerContainer,
      workspaceSlugReservationStore: {
        ...store,
        release: async (input) => {
          if (failRelease) {
            failRelease = false;
            throw new Error("slug shard unreachable");
          }
          await store.release(input);
        },
      },
    };

    await drive(h, 6, worker);

    // The tombstone is durable before the slug is handed back.
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      slug: null,
      avatarUrl: null,
      lifecycle: "deleting",
      deletionOperationId: operationId,
    });
    expect(directoryRow(h, WORKSPACE)?.name).not.toBe(NAME);
    expect(slugReservations(h)).toHaveLength(1);

    h.clock.advance(60_000);
    await drive(h, 6, worker);
    expect(slugReservations(h)).toHaveLength(0);
  });

  it("TC-workspace-101: the accept and each cleanup phase are separate bounded transactions of one workspace scope", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await accept(h);

    const kinds: string[] = [];
    for (let round = 0; round < 12; round += 1) {
      const pending = pendingTurns(h);
      if (pending.length === 0) {
        break;
      }
      // One turn is due at a time: the phases never share a transaction.
      expect(pending).toHaveLength(1);
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      kinds.push(pending[0]!.kind);
      await drive(h, 1);
    }

    expect(kinds).toEqual([
      WORKSPACE_DELETION_LOCAL_TASK_KIND,
      WORKSPACE_DELETION_LOCAL_TASK_KIND,
      WORKSPACE_DELETION_LOCAL_TASK_KIND,
      WORKSPACE_DELETION_LOCAL_TASK_KIND,
      WORKSPACE_DELETION_GLOBAL_TASK_KIND,
      WORKSPACE_DELETION_COMPACT_TASK_KIND,
    ]);
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
  });

  it("TC-workspace-102: the public slug stops resolving as soon as the local half is done, before the global cleanup runs", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const before = await getPublicWorkspace({
      container: h.container,
      input: { slug: SLUG },
    });
    expect(before).toMatchObject({ slug: SLUG });

    await accept(h);
    // local half only: the Workspace row is gone, the directory row and
    // the slug reservation are untouched.
    await drive(h, 4);
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(directoryRow(h, WORKSPACE)?.lifecycle).toBe("active");
    expect(slugReservations(h)).toHaveLength(1);

    await expectNotFound(
      getPublicWorkspace({ container: h.container, input: { slug: SLUG } }),
    );

    // and the tombstone keeps the answer durable afterwards
    await drainScopeTasks(h);
    expect(directoryRow(h, WORKSPACE)?.lifecycle).toBe("deleting");
    await expectNotFound(
      getPublicWorkspace({ container: h.container, input: { slug: SLUG } }),
    );
  });

  it("TC-workspace-103: a global cleanup whose acknowledgement was lost repeats its deletes and converges", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    const { operationId } = await accept(h);
    await drive(h, 4);

    // The turn issues its global deletes, then loses the response of the
    // transaction that would have acknowledged them.
    const inner = h.workerContainer.scopeUnitOfWorkProvider;
    let runs = 0;
    const worker: WorkerContainer = {
      ...h.workerContainer,
      scopeUnitOfWorkProvider: {
        run: async <T>(
          scope: Parameters<typeof inner.run<T>>[0],
          callback: Parameters<typeof inner.run<T>>[1],
        ): Promise<T> => {
          runs += 1;
          if (runs === 2) {
            throw new Error("acknowledgement response lost");
          }
          return inner.run(scope, callback);
        },
      },
    };
    await expect(
      continueWorkspaceDeletionGlobalCleanup(worker, {
        scope: workspaceScope(WORKSPACE),
        payload: { operationId, cursor: null, slug: SLUG },
      }),
    ).rejects.toThrow("acknowledgement response lost");

    // The deletes landed; nothing is acknowledged yet.
    expect(membershipEdges(h)).toHaveLength(0);
    expect(slugReservations(h)).toHaveLength(0);
    expect(
      manifest(h)
        .deletionManifestItems.values()
        .every((item) => item.globalAckedAt === null),
    ).toBe(true);

    // Re-running the same turn repeats deletes that are already done and
    // then acknowledges, so the saga still reaches its tombstone.
    await drainScopeTasks(h);
    expect(manifest(h).deletionManifestItems.values()).toHaveLength(0);
    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({ state: "completed" }),
    ]);
    expect(invitationRoutes(h).map((route) => route.state)).toEqual([
      "revoked",
    ]);
  });

  it("TC-workspace-104 / 110 / 113 / 114: 101 members are fixed, deleted and reclaimed 100 at a time", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      name: NAME,
      slug: SLUG,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-000" },
        ...Array.from({ length: 100 }, (_unused, index) => ({
          userId: `member-${String(index).padStart(3, "0")}`,
          role: "editor" as const,
          membershipId: `m-${String(index + 1).padStart(3, "0")}`,
        })),
      ],
    });
    const { operationId } = await accept(h);

    // The first manifest page fixes 100 and carries its cursor and the
    // next turn in the same transaction.
    await drive(h, 1);
    expect(manifest(h).deletionManifestItems.size).toBe(100);
    expect(scheduledTasks(h, WORKSPACE)).toEqual([
      expect.objectContaining({
        kind: WORKSPACE_DELETION_LOCAL_TASK_KIND,
        payload: {
          operationId,
          phase: "memberships",
          cursor: "m-099",
          slug: SLUG,
          advertisedSlug: SLUG,
        },
      }),
    ]);
    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({ membershipCursor: "m-099" }),
    ]);

    // second membership page (1) → invitations → localDelete page (100)
    await drive(h, 3);
    expect(manifest(h).deletionManifestItems.size).toBe(101);
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(1);

    await drainScopeTasks(h);
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(manifest(h).deletionManifestItems.size).toBe(0);
    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({ operationId, state: "completed" }),
    ]);
    expect(outboxPayloads(h, WORKSPACE_DELETED)).toHaveLength(1);
  });

  it("TC-workspace-113: compaction empties the manifest a page at a time and only completes the header on the page that empties it", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      name: NAME,
      slug: SLUG,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-000" },
        ...Array.from({ length: 100 }, (_unused, index) => ({
          userId: `member-${String(index).padStart(3, "0")}`,
          role: "editor" as const,
          membershipId: `m-${String(index + 1).padStart(3, "0")}`,
        })),
      ],
    });
    await accept(h);

    const sizes: Array<readonly [number, string | undefined]> = [];
    for (let round = 0; round < 20; round += 1) {
      const isCompaction = pendingTurns(h).some(
        (turn) => turn.kind === WORKSPACE_DELETION_COMPACT_TASK_KIND,
      );
      if ((await drive(h, 1)) === 0) {
        break;
      }
      if (isCompaction) {
        sizes.push([
          manifest(h).deletionManifestItems.size,
          manifest(h).deletionManifestHeaders.values()[0]?.state,
        ]);
      }
    }

    // 101 → 1 → 0, and `completed` only once nothing is left.
    expect(sizes).toEqual([
      [1, "ready"],
      [0, "completed"],
    ]);
  });

  it("TC-workspace-105: a stop between the last local delete and the Workspace row deletes it once, with one event", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const { operationId } = await accept(h);

    // memberships → invitations → the local delete page that empties the
    // scope. The Workspace row is untouched at this point.
    await drive(h, 3);
    expect(storedMemberships(h, WORKSPACE)).toHaveLength(0);
    expect(storedWorkspace(h, WORKSPACE)).not.toBeNull();

    const resume: Turn = {
      kind: WORKSPACE_DELETION_LOCAL_TASK_KIND,
      payload: { operationId, phase: "localDelete", cursor: null, slug: SLUG },
    };
    await redeliver(h, resume);
    await redeliver(h, resume);

    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(outboxPayloads(h, WORKSPACE_DELETED)).toEqual([
      { workspaceId: WORKSPACE, operationId },
    ]);
  });

  it("TC-workspace-106: every turn redelivered twice still ends in one workspace.deleted and one completed manifest", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    const { operationId } = await accept(h);

    for (let round = 0; round < 20; round += 1) {
      const pending = pendingTurns(h);
      if (pending.length === 0) {
        break;
      }
      // At-least-once delivery: the same turn arrives on both sides of
      // the one the runner claims.
      for (const turn of pending) {
        await redeliver(h, turn);
      }
      await drive(h, 1);
      for (const turn of pending) {
        await redeliver(h, turn);
      }
    }

    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(outboxPayloads(h, WORKSPACE_DELETED)).toEqual([
      { workspaceId: WORKSPACE, operationId },
    ]);
    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({ operationId, state: "completed" }),
    ]);
    expect(manifest(h).deletionManifestItems.size).toBe(0);
    expect(membershipEdges(h)).toHaveLength(0);
    expect(slugReservations(h)).toHaveLength(0);
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
  });

  it("TC-workspace-106: a continuation naming a foreign operation is refused and settles its own row", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const { operationId } = await accept(h);
    await drive(h, 3);

    await h.container.scopeUnitOfWorkProvider.run(
      workspaceScope(WORKSPACE),
      (ctx) =>
        ctx.scopeTaskScheduler.schedule({
          kind: WORKSPACE_DELETION_LOCAL_TASK_KIND,
          operationId: "deletion-op-foreign",
          priority: 0,
          dueAt: h.clock.now(),
          payload: {
            operationId: "deletion-op-foreign",
            phase: "localDelete",
            cursor: null,
            slug: SLUG,
          },
        }),
    );

    await drainScopeTasks(h);

    // The foreign turn never ran the deletion; the real one still did.
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(outboxPayloads(h, WORKSPACE_DELETED)).toEqual([
      { workspaceId: WORKSPACE, operationId },
    ]);
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({ operationId }),
    ]);
  });

  it("TC-workspace-107: after the Workspace row is gone, an ordinary write is still refused with WORKSPACE_DELETING", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await accept(h);
    await drive(h, 4);
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();

    const assertWritable = () =>
      h.container.scopeUnitOfWorkProvider.run(
        workspaceScope(WORKSPACE),
        (ctx) => ctx.workspaceOperationLockStore.assertWritable(),
      );

    await expectConflict(assertWritable(), "WORKSPACE_DELETING");

    // and the completed tombstone keeps refusing it permanently
    await drainScopeTasks(h);
    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({ state: "completed" }),
    ]);
    await expectConflict(assertWritable(), "WORKSPACE_DELETING");
  });

  it("TC-workspace-109: a worker that stopped after a manifest page resumes from the stored cursor and never reopens the workspace", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      name: NAME,
      slug: SLUG,
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-000" },
        ...Array.from({ length: 100 }, (_unused, index) => ({
          userId: `member-${String(index).padStart(3, "0")}`,
          role: "editor" as const,
          membershipId: `m-${String(index + 1).padStart(3, "0")}`,
        })),
      ],
    });
    const { operationId } = await accept(h);
    await drive(h, 1);

    expect(storedWorkspace(h, WORKSPACE)?.lifecycle).toEqual({
      state: "deleting",
      operationId,
    });
    const resumed = pendingTurns(h)[0];
    expect(resumed?.payload).toMatchObject({ operationId, cursor: "m-099" });

    // The stored turn is all a fresh worker needs, and re-running it
    // fixes nothing new.
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    await redeliver(h, resumed!);
    expect(manifest(h).deletionManifestItems.size).toBe(101);
    expect(storedWorkspace(h, WORKSPACE)?.lifecycle.state).toBe("deleting");

    await drainScopeTasks(h);
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
    expect(outboxPayloads(h, WORKSPACE_DELETED)).toHaveLength(1);
  });

  it("TC-workspace-111: an invitation that reserved its token just before the scope closed is refused and gives the reservation back", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const store = h.container.invitationRouteStore;
    let closed = false;
    const container = {
      ...h.container,
      invitationRouteStore: {
        ...store,
        reserve: async (input: Parameters<typeof store.reserve>[0]) => {
          await store.reserve(input);
          if (!closed) {
            closed = true;
            await accept(h);
          }
        },
      },
    };

    await expectConflict(
      inviteMember({
        container,
        input: {
          workspaceId: WORKSPACE,
          userId: OWNER,
          email: "invitee@example.com",
          role: "editor",
        },
      }),
      "WORKSPACE_DELETING",
    );
    expect(closed).toBe(true);
    expect(invitationRoutes(h)).toHaveLength(0);
  });

  it("TC-workspace-111: an accept that claimed its edge just before the scope closed is refused and abandons the edge", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const invitation = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      email: "invitee@example.com",
    });
    const invitee = seedUser(h, {
      userId: "invitee-1",
      email: "invitee@example.com",
    });

    const store = h.container.membershipDirectoryReservationStore;
    let closed = false;
    const container = {
      ...h.container,
      membershipDirectoryReservationStore: {
        ...store,
        reserveAndClaimActivation: async (
          input: Parameters<typeof store.reserveAndClaimActivation>[0],
        ) => {
          await store.reserveAndClaimActivation(input);
          if (!closed) {
            closed = true;
            await accept(h);
          }
        },
      },
    };

    await expectConflict(
      acceptInvitation({
        container,
        input: { token: invitation.token, userId: invitee },
      }),
      "WORKSPACE_DELETING",
    );
    expect(closed).toBe(true);
    expect(
      membershipEdges(h).filter((edge) => edge.edgeState !== "active"),
    ).toHaveLength(0);
  });

  it("TC-workspace-115: a compaction turn redelivered after the tombstone leaves exactly one completed header", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const { operationId } = await accept(h);
    await drainScopeTasks(h);

    const compaction: Turn = {
      kind: WORKSPACE_DELETION_COMPACT_TASK_KIND,
      payload: { operationId },
    };
    await redeliver(h, compaction);
    await redeliver(h, compaction);

    expect(manifest(h).deletionManifestHeaders.values()).toEqual([
      expect.objectContaining({ operationId, state: "completed" }),
    ]);
    expect(manifest(h).deletionManifestItems.size).toBe(0);
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);
    expect(outboxPayloads(h, WORKSPACE_DELETED)).toHaveLength(1);
  });

  it("TC-workspace-116: a staged note move blocks the deletion until it settles", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await h.container.scopeUnitOfWorkProvider.run(
      workspaceScope(WORKSPACE),
      (ctx) =>
        ctx.workspaceOperationLockStore.stageMove({
          migrationId: "migration-1",
          actorUserId: UserId.create(OWNER),
        }),
    );

    await expectConflict(accept(h), "WORKSPACE_MOVE_IN_PROGRESS");
    expect(storedWorkspace(h, WORKSPACE)?.lifecycle.state).toBe("active");
    expect(scheduledTasks(h, WORKSPACE)).toHaveLength(0);

    await h.container.scopeUnitOfWorkProvider.run(
      workspaceScope(WORKSPACE),
      (ctx) => ctx.workspaceOperationLockStore.releaseMove("migration-1"),
    );

    await expect(accept(h)).resolves.toMatchObject({ status: "accepted" });
  });

  it("TC-workspace-107: a note created in the retiring workspace never lands behind the manifest cursor", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await accept(h);

    await expectConflict(
      createBlankNote({
        container: h.container,
        input: {
          userId: OWNER,
          ownerType: "workspace",
          ownerWorkspaceId: WORKSPACE,
          title: null,
        },
      }),
      "WORKSPACE_DELETING",
    );
    expect(h.backend.scope(workspaceScope(WORKSPACE)).notes.size).toBe(0);

    await drainScopeTasks(h);
    expect(storedWorkspace(h, WORKSPACE)).toBeNull();
  });
});
