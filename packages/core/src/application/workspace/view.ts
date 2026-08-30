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

/**
 * What the three settings screens read before they edit anything
 * (P-31 / P-33 / P-34). It is the read counterpart of
 * `updateWorkspaceProfile`, so it carries every field that screen writes —
 * rendering the description empty because the read did not supply it would
 * erase it on the next save.
 *
 * The three capability flags are separate because the three screens gate
 * on three different actions; that they share a minimum role today is the
 * authorization table's business, not the caller's. `role` is non-null:
 * a non-member has no settings screen to render.
 */
export type WorkspaceSettingsView = Readonly<{
  workspaceId: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  slug: string | null;
  publication: WorkspacePublicationView;
  role: WorkspaceRoleView;
  canManage: boolean;
  canPublish: boolean;
  canDelete: boolean;
}>;

/**
 * An advisory answer about one slug, shaped like `HandleAvailabilityView`
 * of the identity plane: the winner is decided by the reservation
 * `createWorkspace` / `changeWorkspaceSlug` takes, not by this read.
 */
export type WorkspaceSlugAvailabilityView = Readonly<{
  slug: string;
  available: boolean;
  ownedBySelf: boolean;
}>;

/**
 * The publication screen's initial read (P-33), giving before the fact
 * what `publishWorkspace` only answers after it. `publicUrl` is non-null
 * exactly while the workspace is published — a slug held by a private
 * workspace resolves to no page.
 */
export type WorkspacePublicationStatusView = Readonly<{
  workspaceId: string;
  publication: WorkspacePublicationView;
  slug: string | null;
  publicUrl: string | null;
  publicNoteCount: number;
  canPublish: boolean;
}>;

/**
 * Progress of a workspace deletion (P-34 の「実行中 / 完了」).
 *
 * `completed` is reported from the absence of the Workspace row, which is
 * what the saga deletes at the end of its local phase; the global cleanup
 * that follows is invisible to the member, who has already lost the
 * workspace. `operationId` is present only while the scope is closed under
 * one, since that is the only state that names it.
 */
export type WorkspaceDeletionStatusView = Readonly<{
  workspaceId: string;
  status: "none" | "inProgress" | "completed";
  operationId: string | null;
  canDelete: boolean;
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

/**
 * `mailSent` is false when the mail could not be handed to `MailSender`.
 * The invitation itself is already durable — the send is deliberately not
 * allowed to fail it (spec/usecases/workspace.md#invitemember) — so the
 * flag is what lets P-32 warn that the recipient has no mail and that
 * `invitationUrl` has to be shared by hand.
 */
export type IssuedInvitationView = Readonly<{
  invitationId: string;
  email: string;
  role: WorkspaceRoleView;
  expiresAt: Date;
  invitationUrl: string;
  mailSent: boolean;
}>;

/** `mailSent` as in {@link IssuedInvitationView}. */
export type ResentInvitationView = Readonly<{
  invitationId: string;
  expiresAt: Date;
  invitationUrl: string;
  mailSent: boolean;
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
 *
 * `workspaceId` is non-null exactly while `state` is `alreadyMember`, the
 * one branch whose viewer already holds the workspace anyway: the preview
 * is readable signed out, so any other branch would hand a workspace
 * identifier to whoever holds the link. It is what sends a member who
 * opens a live pending link to the workspace itself, since
 * `acceptInvitation` returns their existing role without consuming it.
 */
export type InvitationPreviewView = Readonly<{
  workspaceId: string | null;
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

/**
 * `viewerRole` is the reader's own role, answered separately from
 * `members` because the page need not contain the reader's row: the list
 * is ordered by `joinedAt`, so a member who joined after the first page
 * was filled is absent from it. A screen that gates the reader's own
 * actions (leaving, WS-06) on their role therefore cannot read it out of
 * `members`. It is non-null because a non-member gets no list at all.
 */
export type WorkspaceMemberListView = Readonly<{
  members: readonly WorkspaceMemberView[];
  count: number;
  ownerCount: number;
  viewerRole: WorkspaceRoleView;
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
