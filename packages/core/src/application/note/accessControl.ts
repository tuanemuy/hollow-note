import { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteViewer } from "@repo/core/domain/note/services/noteAccessPolicy";
import { createNoteAccessPolicy } from "@repo/core/domain/note/services/noteAccessPolicy";
import type { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import type { RequestContainer } from "../di/types";
import { isNotFoundError } from "../errors";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";

export const noteAccessPolicy = createNoteAccessPolicy(WorkspaceAuthorization);

/**
 * Builds the viewer context a note is evaluated against.
 *
 * The role is read from the note's own workspace scope, never from the
 * global membership directory: the directory's role is a projection, and
 * an access decision may only rest on the `Membership` the scope holds
 * (`UserWorkspaceDirectory`). A non-member resolves to `null`, which the
 * policy reads as "no workspace path" and falls through to the public /
 * unlisted routes.
 *
 * A workspace the deletion saga has already removed degrades to the same
 * `null` instead of propagating `WORKSPACE_NOT_FOUND`. This is a viewer
 * context, not an entry check: an anonymous viewer never resolves a
 * workspace at all, so propagating would make the very same public note
 * readable while signed out and `WORKSPACE_NOT_FOUND` while signed in.
 * Letting the policy decide keeps one answer per note — public / unlisted
 * still serve, anything else collapses to `NOTE_NOT_FOUND`.
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
  }).catch((error: unknown) => {
    if (isNotFoundError(error) && error.code === "WORKSPACE_NOT_FOUND") {
      return null;
    }
    throw error;
  });
  return {
    kind: "user",
    userId: viewerId,
    workspaceRole: access?.role ?? null,
  };
};
