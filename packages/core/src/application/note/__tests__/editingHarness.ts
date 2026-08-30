import { ScopeKey } from "@repo/core/application/scope";
import { User } from "@repo/core/domain/identity/user";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import {
  NoteRevision,
  type RevisionReason,
} from "@repo/core/domain/note/noteRevision";
import { Membership } from "@repo/core/domain/workspace/membership";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { createBlankNote } from "../createBlankNote";
import type { ActiveNoteJob, NoteEditingJobs, NoteJobScope } from "../jobs";

/**
 * Shared seeding for the note-editing usecase tests
 * (`updateNoteBody` / `applyTextNodeEdits` / `renameNote` /
 * `changeNoteStyleMode` / `listNoteRevisions` / `restoreNoteRevision`).
 *
 * Everything runs against the memory backend through production DI; the
 * only stand-in is {@link recordingJobs}, because the Job aggregate does
 * not exist yet and `NoteEditingJobs` therefore has no adapter to wire.
 */

export const OWNER = "user-owner";
export const MEMBER = "user-member";
export const VIEWER = "user-viewer";
export const WORKSPACE = "workspace-1";

export const userScope = ScopeKey.user(UserId.create(OWNER));
export const workspaceScope = ScopeKey.workspace(WorkspaceId.create(WORKSPACE));

export type WorkspaceRoleSeed = Readonly<{
  userId: string;
  role: "owner" | "editor" | "viewer";
}>;

export function seedUser(
  h: TestHarness,
  userId: string,
  displayName: string,
): void {
  h.backend.users.set(
    userId,
    User.createVerified(
      { id: userId, email: `${userId}@example.test`, displayName },
      h.clock.now(),
    ).entity,
  );
}

/** Inserts the workspace and its memberships without running the sagas. */
export async function seedWorkspace(
  h: TestHarness,
  members: readonly WorkspaceRoleSeed[],
): Promise<void> {
  const workspaceId = WorkspaceId.create(WORKSPACE);
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(workspaceScope, async (ctx) => {
    await ctx.workspaceRepository.insert(
      Workspace.create(
        {
          id: WORKSPACE,
          ownerId: UserId.create(OWNER),
          name: "Workspace",
          description: "",
          slug: null,
        },
        now,
      ).entity,
    );
    for (const [index, member] of members.entries()) {
      await ctx.membershipRepository.insert(
        Membership.create(
          {
            id: `membership-${index}`,
            workspaceId,
            userId: UserId.create(member.userId),
            role: member.role,
          },
          now,
        ).entity,
      );
    }
  });
}

export async function removeMembership(
  h: TestHarness,
  userId: string,
): Promise<void> {
  await h.container.scopeUnitOfWorkProvider.run(workspaceScope, async (ctx) => {
    const stored = await ctx.membershipRepository.findByWorkspaceAndUser(
      WorkspaceId.create(WORKSPACE),
      UserId.create(userId),
    );
    if (stored !== null) {
      await ctx.membershipRepository.delete(
        stored.entity.id,
        stored.expectedVersion,
      );
    }
  });
}

/** A personal note owned by {@link OWNER}, with an empty `ready` body. */
export async function createPersonalNote(h: TestHarness): Promise<string> {
  const view = await createBlankNote({
    container: h.container,
    input: { userId: OWNER, ownerType: "user" },
  });
  return view.noteId;
}

export async function createWorkspaceNote(
  h: TestHarness,
  asUserId: string = OWNER,
): Promise<string> {
  const view = await createBlankNote({
    container: h.container,
    input: {
      userId: asUserId,
      ownerType: "workspace",
      ownerWorkspaceId: WORKSPACE,
    },
  });
  return view.noteId;
}

export const storedNote = (
  h: TestHarness,
  noteId: string,
  scope: ScopeKey = userScope,
): Note | null => h.backend.scope(scope).notes.get(noteId) ?? null;

export type NoteSeedOverrides = Readonly<{
  contentStatus?: "processing" | "awaitingIntegration" | "failed";
  title?: string;
  titleOrigin?: "auto" | "manual";
}>;

/**
 * Rewrites the stored note through `Note.reconstruct` — the persisted
 * shape — so a state whose only producer belongs to another slice (a
 * `processing` body, an `auto` title left by a conversion) can be reached
 * without imitating that slice's transitions.
 */
export function reseedNote(
  h: TestHarness,
  noteId: string,
  overrides: NoteSeedOverrides,
  scope: ScopeKey = userScope,
): void {
  const note = storedNote(h, noteId, scope);
  if (note === null) {
    throw new Error(`note ${noteId} is not seeded`);
  }
  const contentStatus = overrides.contentStatus ?? note.content.status;
  const ready = note.content.status === "ready" ? note.content : null;
  h.backend.scope(scope).notes.set(
    noteId,
    Note.reconstruct({
      id: note.id,
      ownerType: note.owner.type,
      ownerId:
        note.owner.type === "user" ? note.owner.userId : note.owner.workspaceId,
      createdBy: note.createdBy,
      title: overrides.title ?? note.title.value,
      titleOrigin: overrides.titleOrigin ?? note.title.origin,
      contentStatus,
      failureReason: contentStatus === "failed" ? "unsupportedFormat" : null,
      html: ready?.html ?? null,
      text: ready?.text ?? null,
      excerpt: ready?.excerpt ?? null,
      headings: ready?.headings ?? [],
      visibilityStatus: note.visibility.status,
      styleMode: note.styleMode,
      lifecycle: note.lifecycle,
      version: note.version,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }),
  );
}

export const seedContentStatus = (
  h: TestHarness,
  noteId: string,
  contentStatus: "processing" | "awaitingIntegration" | "failed",
  scope: ScopeKey = userScope,
): void => reseedNote(h, noteId, { contentStatus }, scope);

export const readyBody = (note: Note | null): string =>
  note !== null && note.content.status === "ready" ? note.content.html : "";

/** Newest first, matching `NoteRevisionRepository.listByNote`. */
export const storedRevisions = (
  h: TestHarness,
  noteId: string,
  scope: ScopeKey = userScope,
): readonly NoteRevision[] =>
  h.backend
    .scope(scope)
    .noteRevisions.values()
    .filter((revision) => revision.noteId === noteId)
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );

export type RevisionSeed = Readonly<{
  id: string;
  html: string;
  createdAt: Date;
  createdBy?: string;
  reason?: RevisionReason;
  title?: string;
  titleOrigin?: "auto" | "manual";
  styleMode?: "default" | "preserve";
}>;

/**
 * Writes a revision row straight into the scope's table. The usecases
 * trim to the newest 20 as they write, so a note holding more than that —
 * or a revision left by a slice that does not exist yet
 * (`reason: "regeneration"`) — is only reachable by seeding the row.
 */
export function seedRevision(
  h: TestHarness,
  noteId: string,
  seed: RevisionSeed,
  scope: ScopeKey = userScope,
): NoteRevision {
  const revision = NoteRevision.reconstruct({
    id: seed.id,
    noteId,
    html: seed.html,
    title: seed.title ?? "無題",
    titleOrigin: seed.titleOrigin ?? "manual",
    styleMode: seed.styleMode ?? "default",
    createdBy: seed.createdBy ?? OWNER,
    createdAt: seed.createdAt,
    reason: seed.reason ?? "manualEdit",
  });
  h.backend.scope(scope).noteRevisions.set(seed.id, revision);
  return revision;
}

export const outboxTypes = (h: TestHarness): readonly string[] =>
  h.backend.outbox.values().map((row) => row.type);

export const eventsOfType = (
  h: TestHarness,
  type: string,
): readonly Readonly<{ payload: unknown }>[] =>
  h.backend.outbox.values().filter((row) => row.type === type);

export type RecordedImportRequest = Readonly<{
  noteId: string;
  scope: NoteJobScope;
  requestedBy: string;
}>;

export type RecordingJobs = NoteEditingJobs &
  Readonly<{ requests: RecordedImportRequest[] }>;

/**
 * Stand-in for the Job half of note editing. The Job aggregate belongs to
 * a later slice, so its seam has no adapter — this records what the
 * usecases ask of it and answers with the active jobs the case seeds.
 */
export function recordingJobs(
  active: readonly ActiveNoteJob[] = [],
  issuedJobId = "job-reference-import",
): RecordingJobs {
  const requests: RecordedImportRequest[] = [];
  return {
    requests,
    async listActiveForNote(): Promise<readonly ActiveNoteJob[]> {
      return active;
    },
    async requestReferenceImport(_container, params): Promise<string | null> {
      requests.push({
        noteId: params.noteId,
        scope: params.scope,
        requestedBy: params.requestedBy,
      });
      return issuedJobId;
    },
  };
}

export { createTestHarness, type TestHarness };
