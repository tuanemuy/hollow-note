import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { type ActiveNote, Note } from "@repo/core/domain/note/note";
import {
  NoteId,
  NoteOwner,
  NoteTitle,
} from "@repo/core/domain/note/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";
import { type CreatedNoteView, ownerOf } from "./view";

/**
 * Owner the note is created under. The workspace id belongs to the
 * workspace member alone, so an id-less workspace request cannot be built
 * and `WorkspaceId.create("")` is unreachable from here.
 */
export type CreateBlankNoteOwnerInput =
  | Readonly<{ ownerType: "user" }>
  | Readonly<{ ownerType: "workspace"; ownerWorkspaceId: string }>;

export type CreateBlankNoteInput = Readonly<{
  userId: string;
  title?: string | null;
}> &
  CreateBlankNoteOwnerInput;

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
 * A workspace-owned request is authorized before any saga state exists:
 * an absent workspace is `NotFoundError("WORKSPACE_NOT_FOUND")`, and a
 * non-member or a `viewer` is `BusinessRuleError(InsufficientRole)` —
 * the workspace was already proven to exist, so collapsing the two would
 * mislead a member who lost their role mid-session.
 */
export async function createBlankNote({
  container,
  input,
}: ServiceArgs<CreateBlankNoteInput>): Promise<CreatedNoteView> {
  const { clock, idGenerator, noteRouteStore, scopeUnitOfWorkProvider } =
    container;

  const userId = UserId.create(input.userId);
  const owner = await resolveOwner(container, input);
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
      await ctx.workspaceOperationLockStore.assertWritable();
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
      : NoteOwner.workspace(WorkspaceId.create(input.ownerId));
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

async function resolveOwner(
  container: RequestContainer,
  input: CreateBlankNoteInput,
): Promise<NoteOwner> {
  if (input.ownerType === "user") {
    return NoteOwner.user(UserId.create(input.userId));
  }
  const access = await resolveWorkspaceAccess({
    container,
    input: {
      workspaceId: input.ownerWorkspaceId,
      userId: input.userId,
    },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can create a note in this workspace",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "createNote");
  return NoteOwner.workspace(WorkspaceId.create(access.workspaceId));
}

function scopeOf(owner: NoteOwner): ScopeKey {
  return owner.type === "user"
    ? ScopeKey.user(owner.userId)
    : ScopeKey.workspace(owner.workspaceId);
}
