import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import { scopeOfNoteOwner } from "../scope";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";
import { type TrashedNoteListView, toTrashedNoteListItemView } from "./view";

export type ListTrashedNotesOwnerInput =
  | Readonly<{ ownerType?: "user" }>
  | Readonly<{ ownerType: "workspace"; ownerWorkspaceId: string }>;

export type ListTrashedNotesInput = Readonly<{
  userId: string;
  page?: number;
  limit?: number;
}> &
  ListTrashedNotesOwnerInput;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Minimal internal read of one owner scope's trash for P-14 (ED-10).
 *
 * The counterpart of {@link import("./listNotes").listNotes} on the
 * trashed side, and the same kind of stand-in: the canonical read is
 * `searchNotes` with `lifecycle: "trashed"`
 * (spec/usecases/note.md#searchNotes), which arrives with the search
 * slice. It takes the same owner pair so a caller written against it
 * moves over unchanged.
 *
 * Two things separate it from `listNotes` rather than making it a
 * parameter of it. The permission is `viewTrash`, not `viewNote` — a
 * workspace viewer must not reach the trash at all
 * (spec/pages/index.md L-01) — and every row carries a `version` and a
 * `purgeAfter`, which only exist on a trashed note. Folding both into
 * one usecase would mean a nullable deadline on every active row and a
 * gate that changes meaning with an argument.
 *
 * The order is `listByOwner`'s (`updatedAt DESC, id DESC`), which is the
 * 「削除日時の新しい順」 P-14 asks for: nothing can update a note while
 * it sits in the trash, so its `updatedAt` is the moment it was trashed.
 */
export async function listTrashedNotes({
  container,
  input,
}: ServiceArgs<ListTrashedNotesInput>): Promise<TrashedNoteListView> {
  const owner = await resolveOwner(container, input);
  const scope = scopeOfNoteOwner(owner);
  const reader = container.noteReaderFor(scope);
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(input.page ?? 1, 1);
  const result = await reader.listByOwner(owner, "trashed", { page, limit });
  return {
    items: result.items
      .filter(Note.isTrashed)
      .map((note) => toTrashedNoteListItemView(note)),
    count: result.count,
  };
}

async function resolveOwner(
  container: RequestContainer,
  input: ListTrashedNotesInput,
): Promise<NoteOwner> {
  if (input.ownerType !== "workspace") {
    return NoteOwner.user(UserId.create(input.userId));
  }
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.ownerWorkspaceId, userId: input.userId },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can open the trash of this workspace",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "viewTrash");
  return NoteOwner.workspace(WorkspaceId.create(access.workspaceId));
}
