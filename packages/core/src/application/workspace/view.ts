import { Invitation } from "@repo/core/domain/workspace/invitation";
import type { Membership } from "@repo/core/domain/workspace/membership";
import type {
  PublishedWorkspace,
  Workspace,
} from "@repo/core/domain/workspace/workspace";

/**
 * DTO projections for the workspace usecases
 * (spec/usecases/workspace.md). Fields are primitives only; branded value
 * objects widen naturally, so projection needs no casts.
 */

export type WorkspaceRoleView = "owner" | "editor" | "viewer";
export type WorkspacePublicationView = "private" | "published";

/**
 * `role: null` is "not a member", which every workspace-scoped usecase
 * resolves before acting. It is deliberately not an error here: the
 * public workspace page and the invitation flow both read a workspace the
 * viewer has no role in.
 */
export type WorkspaceAccessView = Readonly<{
  workspaceId: string;
  role: WorkspaceRoleView | null;
  workspaceName: string;
  publication: WorkspacePublicationView;
}>;

export type CreatedWorkspaceView = Readonly<{
  workspaceId: string;
  name: string;
  slug: string | null;
  publication: WorkspacePublicationView;
  role: WorkspaceRoleView;
}>;

export type WorkspaceProfileView = Readonly<{
  workspaceId: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  slug: string | null;
  publication: WorkspacePublicationView;
  createdAt: Date;
  updatedAt: Date;
}>;

export type WorkspaceSlugChangeView = Readonly<{
  workspaceId: string;
  slug: string | null;
  previousSlug: string | null;
}>;

export type WorkspacePublishedView = Readonly<{
  workspaceId: string;
  publication: "published";
  publicUrl: string;
  publicNoteCount: number;
}>;

/**
 * No public note count, unlike {@link WorkspacePublishedView}: once the
 * page is gone the number has nothing to describe
 * (spec/usecases/workspace.md `unpublishWorkspace`).
 */
export type WorkspaceUnpublishedView = Readonly<{
  workspaceId: string;
  publication: "private";
}>;

export type WorkspaceDeletionAcceptedView = Readonly<{
  operationId: string;
  status: "accepted";
}>;

export type IssuedInvitationView = Readonly<{
  invitationId: string;
  email: string;
  role: WorkspaceRoleView;
  expiresAt: Date;
  invitationUrl: string;
}>;

export type ResentInvitationView = Readonly<{
  invitationId: string;
  expiresAt: Date;
  invitationUrl: string;
}>;

export type InvitationPreviewState =
  | "acceptable"
  | "expired"
  | "revoked"
  | "accepted"
  | "alreadyMember"
  | "workspaceMissing";

/**
 * `inviterName` is nullable because `UserBatchReader.resolveMany` omits
 * ids it cannot resolve — an inviter whose account was deleted has no
 * display name left to show, and the preview must still render.
 */
export type InvitationPreviewView = Readonly<{
  workspaceName: string;
  workspaceDescription: string;
  role: WorkspaceRoleView;
  inviterName: string | null;
  email: string;
  state: InvitationPreviewState;
}>;

export type AcceptedInvitationView = Readonly<{
  workspaceId: string;
  role: WorkspaceRoleView;
}>;

/** Current display of a member, as the identity plane answers it. */
export type MemberDisplay = Readonly<{
  displayName: string;
  email: string;
  avatarUrl: string | null;
}>;

/**
 * Display fields are nullable for the same reason as
 * {@link InvitationPreviewView}: a membership outlives the moment its
 * user row becomes a PII-free tombstone, and the row still has to render
 * (spec/testcases/workspace/listMembers.md).
 */
export type WorkspaceMemberView = Readonly<{
  membershipId: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: WorkspaceRoleView;
  joinedAt: Date;
}>;

export type WorkspaceMemberListView = Readonly<{
  members: readonly WorkspaceMemberView[];
  count: number;
  ownerCount: number;
  canManage: boolean;
}>;

export type PendingInvitationView = Readonly<{
  invitationId: string;
  email: string;
  role: WorkspaceRoleView;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date;
  expired: boolean;
}>;

export type PendingInvitationListView = Readonly<{
  invitations: readonly PendingInvitationView[];
  count: number;
}>;

export type ActiveUserWorkspaceView = Readonly<{
  status: "active";
  workspaceId: string;
  name: string;
  slug: string | null;
  avatarUrl: string | null;
  role: WorkspaceRoleView;
  publication: WorkspacePublicationView;
}>;

/**
 * A workspace whose directory shard could not answer. Kept in the list
 * in degraded form rather than dropped — dropping it would make a brief
 * shard outage look like a removal
 * (`WorkspaceDirectoryBatchReader` の `unavailable`).
 */
export type UnavailableUserWorkspaceView = Readonly<{
  status: "unavailable";
  workspaceId: string;
  role: WorkspaceRoleView;
  retryAfterSeconds: number | null;
}>;

export type UserWorkspaceView =
  | ActiveUserWorkspaceView
  | UnavailableUserWorkspaceView;

export type UserWorkspaceListView = Readonly<{
  workspaces: readonly UserWorkspaceView[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

export type ChangedMemberRoleView = Readonly<{
  membershipId: string;
  role: WorkspaceRoleView;
}>;

export type PublicWorkspaceEntryView = Readonly<{
  slug: string;
  updatedAt: Date;
}>;

export type PublicWorkspaceListView = Readonly<{
  entries: readonly PublicWorkspaceEntryView[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

/**
 * The public workspace page. Carries nothing about the workspace's
 * members — the page is served to anonymous visitors
 * (spec/testcases/workspace/getPublicWorkspace.md).
 */
export type PublicWorkspaceView = Readonly<{
  workspaceId: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  slug: string;
}>;

export type DeletedMembershipsView = Readonly<{
  deletedCount: number;
}>;

export const toWorkspaceProfileView = (
  workspace: Workspace,
): WorkspaceProfileView => ({
  workspaceId: workspace.id,
  name: workspace.name,
  description: workspace.description,
  avatarUrl: workspace.avatarUrl,
  slug: workspace.slug,
  publication: workspace.publication,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
});

export const toPublicWorkspaceView = (
  workspace: PublishedWorkspace,
): PublicWorkspaceView => ({
  workspaceId: workspace.id,
  name: workspace.name,
  description: workspace.description,
  avatarUrl: workspace.avatarUrl,
  slug: workspace.slug,
});

export const toWorkspaceMemberView = (
  membership: Membership,
  display: MemberDisplay | null,
): WorkspaceMemberView => ({
  membershipId: membership.id,
  userId: membership.userId,
  displayName: display?.displayName ?? null,
  email: display?.email ?? null,
  avatarUrl: display?.avatarUrl ?? null,
  role: membership.role,
  joinedAt: membership.joinedAt,
});

export const toPendingInvitationView = (
  invitation: Invitation,
  now: Date,
): PendingInvitationView => ({
  invitationId: invitation.id,
  email: invitation.email,
  role: invitation.role,
  invitedBy: invitation.invitedBy,
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
  expired: Invitation.isExpired(invitation, now),
});
