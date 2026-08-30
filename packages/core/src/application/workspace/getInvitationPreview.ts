import { UserId } from "@repo/core/domain/identity/valueObject";
import { Invitation } from "@repo/core/domain/workspace/invitation";
import type { Workspace } from "@repo/core/domain/workspace/workspace";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { invitationNotFound } from "./invitation";
import type { InvitationPreviewState, InvitationPreviewView } from "./view";

export type GetInvitationPreviewInput = Readonly<{
  token: string;
  userId: string | null;
}>;

/**
 * Shows what an invitation link leads to before it is accepted
 * (UC-workspace-011, spec/usecases/workspace.md#getinvitationpreview).
 *
 * Readable signed out — the page states the terms first and asks for a
 * session only at acceptance (WS-04). Only the token hash ever leaves
 * this function's scope, and the response carries no token at all.
 *
 * A workspace the deletion saga has already removed still previews: the
 * invitation row outlives it inside the scope, and `workspaceMissing` is
 * what tells the visitor the link led somewhere that no longer exists.
 * `alreadyMember` is decided last so a member who follows a live link is
 * sent to the workspace rather than told the invitation went stale — the
 * only branch whose response carries `workspaceId` (view.ts).
 */
export async function getInvitationPreview({
  container,
  input,
}: ServiceArgs<GetInvitationPreviewInput>): Promise<InvitationPreviewView> {
  const { clock, invitationRouteStore, secureTokenGenerator, userBatchReader } =
    container;

  const tokenHash = secureTokenGenerator.hashOf(input.token);
  const target = await invitationRouteStore.resolveActive(tokenHash);
  if (target === null) {
    throw invitationNotFound();
  }

  const reader = container.workspaceReaderFor(
    ScopeKey.workspace(target.workspaceId),
  );
  const stored = await reader.invitation.findByTokenHash(tokenHash);
  if (stored === null) {
    throw invitationNotFound();
  }
  const invitation = stored.entity;

  const workspace = await reader.workspace
    .findById(target.workspaceId)
    .then((versioned) => versioned?.entity ?? null);

  const viewerId = input.userId === null ? null : UserId.create(input.userId);
  const membership =
    workspace !== null && viewerId !== null
      ? await reader.membership.findByWorkspaceAndUser(
          target.workspaceId,
          viewerId,
        )
      : null;

  const users = await userBatchReader.resolveMany([invitation.invitedBy]);
  const inviter = users.get(invitation.invitedBy)?.entity;

  const state = previewState(
    workspace,
    invitation,
    membership !== null,
    clock.now(),
  );

  return {
    workspaceId: state === "alreadyMember" ? target.workspaceId : null,
    workspaceName: workspace?.name ?? "",
    workspaceDescription: workspace?.description ?? "",
    role: invitation.role,
    inviterName:
      inviter === undefined || inviter.status === "deleted"
        ? null
        : inviter.displayName,
    email: invitation.email,
    state,
  };
}

function previewState(
  workspace: Workspace | null,
  invitation: Invitation,
  isMember: boolean,
  now: Date,
): InvitationPreviewState {
  if (workspace === null) {
    return "workspaceMissing";
  }
  if (isMember) {
    return "alreadyMember";
  }
  switch (invitation.status) {
    case "accepted":
      return "accepted";
    case "revoked":
      return "revoked";
    default:
      return Invitation.isExpired(invitation, now) ? "expired" : "acceptable";
  }
}
