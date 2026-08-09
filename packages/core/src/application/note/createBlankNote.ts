import { UserId } from "@repo/core/domain/identity/valueObject";
import { type ActiveNote, Note } from "@repo/core/domain/note/note";
import {
  NoteId,
  NoteOwner,
  NoteTitle,
} from "@repo/core/domain/note/valueObject";
import { NotFoundError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { type CreatedNoteView, ownerOf } from "./view";

export type CreateBlankNoteInput = Readonly<{
  userId: string;
  ownerType: "user" | "workspace";
  ownerWorkspaceId?: string | null;
  title?: string | null;
}>;

/** TTL of the `reserved` route while the scope-local commit runs. */
const CREATE_RESERVATION_TTL_MS = 10 * 60 * 1000;

/**
 * Creates a blank note (UC-note-001, spec/usecases/note.md#createblanknote).
 *
 * Saga: `NoteRouteStore.reserveCreate` (global) → scope UoW
 * (`assertWritable` / `assertActorWritable` → projection-revision bump →
 * `Note.createBlank` insert + `note.created`) → `activateCreate`.
 * A failed commit abandons the reservation; a lost activate response is
 * retried once with the same operation id (all saga steps are idempotent
 * per operation). An expired `reserved` route is reconciled by
 * {@link recoverBlankNoteCreation}.
 *
 * Workspace ownership is a stub in this slice: no workspace exists, so
 * every workspace-owned request resolves to
 * `NotFoundError("WORKSPACE_NOT_FOUND")`; role evaluation arrives with
 * slice #3.
 */
export async function createBlankNote({
  container,
  input,
}: ServiceArgs<CreateBlankNoteInput>): Promise<CreatedNoteView> {
  const { clock, idGenerator, noteRouteStore, scopeUnitOfWorkProvider } =
    container;

  const userId = UserId.create(input.userId);
  const owner = resolveOwner(input);
  const scope = scopeOf(owner);
  const rawTitle = input.title ?? "";
  // Validate before reserving the route so an invalid title never
  // creates saga state (spec flow: title construction precedes step 3).
  NoteTitle.manual(rawTitle);

  const now = clock.now();
  const noteId = NoteId.create(idGenerator.next());
  const operationId = idGenerator.next();

  await noteRouteStore.reserveCreate({
    noteId,
    scope,
    createdBy: userId,
    operationId,
    expiresAt: new Date(now.getTime() + CREATE_RESERVATION_TTL_MS),
  });

  let note: ActiveNote;
  try {
    note = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(userId);
      const projectionRevision =
        await ctx.noteProjectionRevisionStore.bump(noteId);
      const created = Note.createBlank(
        {
          id: noteId,
          owner,
          createdBy: userId,
          title: rawTitle,
          projectionRevision,
        },
        now,
      );
      await ctx.noteRepository.insert(created.entity);
      ctx.collectEvents(created.eventDrafts);
      return created.entity;
    });
  } catch (error) {
    try {
      await noteRouteStore.abandonCreate({ noteId, operationId });
    } catch (abandonError) {
      container.logger.error(
        "[createBlankNote] reservation abandon failed after commit failure",
        { cause: error, abandonError },
      );
    }
    throw error;
  }

  try {
    await noteRouteStore.activateCreate({ noteId, operationId });
  } catch (cause) {
    // A lost activate response: the same operation id converges an
    // already-active route, so one retry settles both outcomes.
    container.logger.error(
      "[createBlankNote] activate response lost; retrying once",
      { cause },
    );
    await noteRouteStore.activateCreate({ noteId, operationId });
  }

  return {
    noteId: note.id,
    title: note.title.value,
    ...ownerOf(note),
    visibility: note.visibility.status,
    styleMode: note.styleMode,
    createdAt: note.createdAt,
  };
}

export type RecoverBlankNoteCreationInput = Readonly<{
  noteId: string;
  operationId: string;
  ownerType: "user" | "workspace";
  ownerId: string;
}>;

export type RecoverBlankNoteCreationView = Readonly<{
  outcome: "activated" | "abandoned";
}>;

/**
 * Reconciles an expired `reserved` route (spec/usecases/note.md
 * createBlankNote 手順5の回復): when the scope object holds the note the
 * commit was durable and the route is activated with the same operation
 * id; otherwise the reservation is abandoned. The cron that feeds this
 * function expired reservations is wired in a later slice — here it is
 * invoked with the reservation's own values.
 */
export async function recoverBlankNoteCreation({
  container,
  input,
}: ServiceArgs<RecoverBlankNoteCreationInput>): Promise<RecoverBlankNoteCreationView> {
  const noteId = NoteId.create(input.noteId);
  const owner =
    input.ownerType === "user"
      ? NoteOwner.user(UserId.create(input.ownerId))
      : (() => {
          throw new NotFoundError(
            "WORKSPACE_NOT_FOUND",
            "Workspaces are not available in this slice",
          );
        })();
  const scope = scopeOf(owner);

  const stored = await container
    .noteReaderFor(scope)
    .findById(noteId)
    .then((versioned) => versioned?.entity ?? null);
  if (stored !== null) {
    await container.noteRouteStore.activateCreate({
      noteId,
      operationId: input.operationId,
    });
    return { outcome: "activated" };
  }
  await container.noteRouteStore.abandonCreate({
    noteId,
    operationId: input.operationId,
  });
  return { outcome: "abandoned" };
}

function resolveOwner(input: CreateBlankNoteInput): NoteOwner {
  if (input.ownerType === "user") {
    return NoteOwner.user(UserId.create(input.userId));
  }
  // No workspace exists in the walking-skeleton slice, so any workspace
  // id — present or missing — resolves to not-found.
  throw new NotFoundError("WORKSPACE_NOT_FOUND", "Workspace not found");
}

function scopeOf(owner: NoteOwner): ScopeKey {
  return owner.type === "user"
    ? ScopeKey.user(owner.userId)
    : ScopeKey.workspace(owner.workspaceId);
}
