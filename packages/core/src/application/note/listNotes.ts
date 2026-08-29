import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";
import { type NoteListView, toNoteListItemView } from "./view";

export type ListNotesInput = Readonly<{
  userId: string;
  ownerType?: "user" | "workspace";
  ownerWorkspaceId?: string | null;
  page?: number;
  limit?: number;
}>;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Minimal internal read of the active notes of one owner scope for the
 * walking-skeleton note list (P-10). This deliberately does NOT preempt
 * the canonical `searchNotes` (UC-note-006) of a later slice: it reads
 * straight through `NoteRepository.listByOwner` and offers no keyword,
 * tag, month or sort. It takes the same owner pair as `searchNotes`
 * (`ownerType` / `ownerWorkspaceId`) so a caller written against it moves
 * over unchanged, and defaults to the personal scope.
 *
 * Authorization for the workspace context follows `searchNotes` 手順1:
 * `resolveWorkspaceAccess` for the role, then `viewNote` — every role
 * clears it, so this is where a non-member is turned away (WS-02 の
 * 「除名された・削除済みのワークスペースを URL で直接開いた」; a deleted
 * workspace is `WORKSPACE_NOT_FOUND` from the access resolution itself).
 */
export async function listNotes({
  container,
  input,
}: ServiceArgs<ListNotesInput>): Promise<NoteListView> {
  const owner = await resolveOwner(container, input);
  const scope =
    owner.type === "user"
      ? ScopeKey.user(owner.userId)
      : ScopeKey.workspace(owner.workspaceId);
  const reader = container.noteReaderFor(scope);
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(input.page ?? 1, 1);
  const result = await reader.listByOwner(owner, "active", {
    page,
    limit,
  });
  return {
    items: result.items.map(toNoteListItemView),
    count: result.count,
  };
}

async function resolveOwner(
  container: RequestContainer,
  input: ListNotesInput,
): Promise<NoteOwner> {
  if (input.ownerType !== "workspace") {
    return NoteOwner.user(UserId.create(input.userId));
  }
  const access = await resolveWorkspaceAccess({
    container,
    input: {
      workspaceId: input.ownerWorkspaceId ?? "",
      userId: input.userId,
    },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can list the notes of this workspace",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "viewNote");
  return NoteOwner.workspace(WorkspaceId.create(access.workspaceId));
}
