import { BusinessRuleError } from "@repo/core/domain/error";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { countPublicNotes } from "./publicNoteCount";
import {
  resolveWorkspaceAccess,
  workspaceNotFound,
} from "./resolveWorkspaceAccess";
import type { WorkspacePublicationStatusView } from "./view";

export type GetWorkspacePublicationInput = Readonly<{
  workspaceId: string;
  userId: string;
}>;

/**
 * Reads the publication state of a workspace for the publication screen.
 *
 * The write-free counterpart of `publishWorkspace` /
 * `unpublishWorkspace`, and the only way the screen can show the public
 * URL and the note count on first render: `publishWorkspace` answers both,
 * but only to the request that flipped the switch.
 *
 * The count comes from the same scope walk that usecase uses, with the
 * same caveat (see `countPublicNotes`), and it is reported while private
 * too — the screen warns about an empty page *before* publishing, which
 * is the only moment the warning can still change a decision.
 *
 * Any member may read; `canPublish` is what puts the screen into its
 * read-only state for a non-owner.
 */
export async function getWorkspacePublication({
  container,
  input,
}: ServiceArgs<GetWorkspacePublicationInput>): Promise<WorkspacePublicationStatusView> {
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  const role = access.role;
  if (role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can read the workspace publication settings",
    );
  }

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const stored = await container
    .workspaceReaderFor(ScopeKey.workspace(workspaceId))
    .workspace.findById(workspaceId);
  if (stored === null) {
    throw workspaceNotFound();
  }
  const workspace = stored.entity;

  return {
    workspaceId: workspace.id,
    publication: workspace.publication,
    slug: workspace.slug,
    publicUrl: Workspace.isPublished(workspace)
      ? `${container.config.appUrl}/w/${workspace.slug}`
      : null,
    publicNoteCount: await countPublicNotes(container, workspaceId),
    canPublish: WorkspaceAuthorization.can(role, "publishWorkspace"),
  };
}
