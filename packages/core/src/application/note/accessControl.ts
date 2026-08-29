import { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteViewer } from "@repo/core/domain/note/services/noteAccessPolicy";
import { createNoteAccessPolicy } from "@repo/core/domain/note/services/noteAccessPolicy";
import type { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import type { RequestContainer } from "../di/types";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";

export const noteAccessPolicy = createNoteAccessPolicy(WorkspaceAuthorization);

/**
 * Builds the viewer context a note is evaluated against
 * (spec/usecases/note.md 共通: 閲覧者コンテキストの解決 手順 4).
 *
 * The role is read from the note's own workspace scope, never from the
 * global membership directory: the directory's role is a projection, and
 * an access decision may only rest on the `Membership` the scope holds
 * (`UserWorkspaceDirectory`). A non-member resolves to `null`, which the
 * policy reads as "no workspace path" and falls through to the public /
 * unlisted routes.
 */
export const viewerFor = async (
  container: RequestContainer,
  owner: NoteOwner,
  userId: string | null,
): Promise<NoteViewer> => {
  if (userId === null) {
    return { kind: "anonymous" };
  }
  const viewerId = UserId.create(userId);
  if (owner.type === "user") {
    return { kind: "user", userId: viewerId, workspaceRole: null };
  }
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: owner.workspaceId, userId },
  });
  return { kind: "user", userId: viewerId, workspaceRole: access.role };
};
