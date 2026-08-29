import type {
  DomainEventBase,
  EventDraft,
} from "@repo/core/domain/common/event";
import type { Version } from "@repo/core/domain/common/version";
import type { Email, UserId } from "@repo/core/domain/identity/valueObject";
import type {
  InvitationId,
  MembershipId,
  WorkspaceId,
  WorkspaceName,
  WorkspaceRole,
  WorkspaceSlug,
} from "./valueObject";

export type WorkspaceCreatedEvent = DomainEventBase<
  "workspace.created",
  Readonly<{ workspaceId: WorkspaceId; ownerId: UserId }>
>;

export type WorkspaceProfileUpdatedEvent = DomainEventBase<
  "workspace.profileUpdated",
  Readonly<{ workspaceId: WorkspaceId; name: WorkspaceName }>
>;

export type WorkspaceSlugChangedEvent = DomainEventBase<
  "workspace.slugChanged",
  Readonly<{
    workspaceId: WorkspaceId;
    previousSlug: WorkspaceSlug | null;
    currentSlug: WorkspaceSlug | null;
  }>
>;

export type WorkspacePublishedEvent = DomainEventBase<
  "workspace.published",
  Readonly<{ workspaceId: WorkspaceId; slug: WorkspaceSlug }>
>;

export type WorkspaceUnpublishedEvent = DomainEventBase<
  "workspace.unpublished",
  Readonly<{ workspaceId: WorkspaceId }>
>;

/**
 * Emitted directly by `deleteWorkspace` (there is no successor entity).
 * `operationId` is the deletion operation the manifest and the global
 * cleanup are keyed by, so consumers stay idempotent across redelivery.
 */
export type WorkspaceDeletedEvent = DomainEventBase<
  "workspace.deleted",
  Readonly<{ workspaceId: WorkspaceId; operationId: string }>
>;

export type MembershipAddedEvent = DomainEventBase<
  "workspace.membership.added",
  Readonly<{
    workspaceId: WorkspaceId;
    userId: UserId;
    role: WorkspaceRole;
  }>
>;

/**
 * `sourceVersion` is the Membership version the change produced, and it
 * is what orders the projection onto the global `membership_directory`
 * edge: delivery is at-least-once with no ordering guarantee, so the
 * consumer needs the payload itself to say which of two role changes is
 * the later one (spec/domains/workspace.md `ドメインイベント`).
 *
 * `membershipId` names the generation that version counts in. A version
 * is only comparable within one Membership — a removal and a rejoin of
 * the same `(workspaceId, userId)` restart it at zero — so the projection
 * needs the id to tell "an older change of this membership" from "a
 * change of the membership that came before this one".
 */
export type MembershipRoleChangedEvent = DomainEventBase<
  "workspace.membership.roleChanged",
  Readonly<{
    workspaceId: WorkspaceId;
    userId: UserId;
    membershipId: MembershipId;
    previousRole: WorkspaceRole;
    currentRole: WorkspaceRole;
    sourceVersion: Version;
  }>
>;

/** Emitted directly by `removeMember` / `leaveWorkspace`. */
export type MembershipRemovedEvent = DomainEventBase<
  "workspace.membership.removed",
  Readonly<{ workspaceId: WorkspaceId; userId: UserId }>
>;

export type InvitationCreatedEvent = DomainEventBase<
  "workspace.invitation.created",
  Readonly<{
    invitationId: InvitationId;
    workspaceId: WorkspaceId;
    email: Email;
    role: WorkspaceRole;
  }>
>;

export type InvitationAcceptedEvent = DomainEventBase<
  "workspace.invitation.accepted",
  Readonly<{
    invitationId: InvitationId;
    workspaceId: WorkspaceId;
    userId: UserId;
  }>
>;

export type InvitationRevokedEvent = DomainEventBase<
  "workspace.invitation.revoked",
  Readonly<{ invitationId: InvitationId; workspaceId: WorkspaceId }>
>;

export type WorkspaceEvent =
  | WorkspaceCreatedEvent
  | WorkspaceProfileUpdatedEvent
  | WorkspaceSlugChangedEvent
  | WorkspacePublishedEvent
  | WorkspaceUnpublishedEvent
  | WorkspaceDeletedEvent
  | MembershipAddedEvent
  | MembershipRoleChangedEvent
  | MembershipRemovedEvent
  | InvitationCreatedEvent
  | InvitationAcceptedEvent
  | InvitationRevokedEvent;

/**
 * Every event in this domain carries the `WorkspaceId` as its
 * `aggregateId`, including the membership / invitation ones. All three
 * aggregates live in the same workspace scope and the membership payloads
 * name their subject by `userId` rather than by `MembershipId`, so the
 * workspace is the only key that groups the whole domain consistently.
 */
export const WorkspaceEvents = {
  workspaceCreated: (
    workspaceId: WorkspaceId,
    ownerId: UserId,
    occurredAt: Date,
  ): EventDraft<WorkspaceCreatedEvent> => ({
    type: "workspace.created",
    payload: { workspaceId, ownerId },
    occurredAt,
    aggregateId: workspaceId,
  }),

  workspaceProfileUpdated: (
    workspaceId: WorkspaceId,
    name: WorkspaceName,
    occurredAt: Date,
  ): EventDraft<WorkspaceProfileUpdatedEvent> => ({
    type: "workspace.profileUpdated",
    payload: { workspaceId, name },
    occurredAt,
    aggregateId: workspaceId,
  }),

  workspaceSlugChanged: (
    workspaceId: WorkspaceId,
    previousSlug: WorkspaceSlug | null,
    currentSlug: WorkspaceSlug | null,
    occurredAt: Date,
  ): EventDraft<WorkspaceSlugChangedEvent> => ({
    type: "workspace.slugChanged",
    payload: { workspaceId, previousSlug, currentSlug },
    occurredAt,
    aggregateId: workspaceId,
  }),

  workspacePublished: (
    workspaceId: WorkspaceId,
    slug: WorkspaceSlug,
    occurredAt: Date,
  ): EventDraft<WorkspacePublishedEvent> => ({
    type: "workspace.published",
    payload: { workspaceId, slug },
    occurredAt,
    aggregateId: workspaceId,
  }),

  workspaceUnpublished: (
    workspaceId: WorkspaceId,
    occurredAt: Date,
  ): EventDraft<WorkspaceUnpublishedEvent> => ({
    type: "workspace.unpublished",
    payload: { workspaceId },
    occurredAt,
    aggregateId: workspaceId,
  }),

  workspaceDeleted: (
    workspaceId: WorkspaceId,
    operationId: string,
    occurredAt: Date,
  ): EventDraft<WorkspaceDeletedEvent> => ({
    type: "workspace.deleted",
    payload: { workspaceId, operationId },
    occurredAt,
    aggregateId: workspaceId,
  }),

  membershipAdded: (
    workspaceId: WorkspaceId,
    userId: UserId,
    role: WorkspaceRole,
    occurredAt: Date,
  ): EventDraft<MembershipAddedEvent> => ({
    type: "workspace.membership.added",
    payload: { workspaceId, userId, role },
    occurredAt,
    aggregateId: workspaceId,
  }),

  membershipRoleChanged: (
    params: Readonly<{
      workspaceId: WorkspaceId;
      userId: UserId;
      membershipId: MembershipId;
      previousRole: WorkspaceRole;
      currentRole: WorkspaceRole;
      sourceVersion: Version;
    }>,
    occurredAt: Date,
  ): EventDraft<MembershipRoleChangedEvent> => ({
    type: "workspace.membership.roleChanged",
    payload: params,
    occurredAt,
    aggregateId: params.workspaceId,
  }),

  membershipRemoved: (
    workspaceId: WorkspaceId,
    userId: UserId,
    occurredAt: Date,
  ): EventDraft<MembershipRemovedEvent> => ({
    type: "workspace.membership.removed",
    payload: { workspaceId, userId },
    occurredAt,
    aggregateId: workspaceId,
  }),

  invitationCreated: (
    params: Readonly<{
      invitationId: InvitationId;
      workspaceId: WorkspaceId;
      email: Email;
      role: WorkspaceRole;
    }>,
    occurredAt: Date,
  ): EventDraft<InvitationCreatedEvent> => ({
    type: "workspace.invitation.created",
    payload: params,
    occurredAt,
    aggregateId: params.workspaceId,
  }),

  invitationAccepted: (
    invitationId: InvitationId,
    workspaceId: WorkspaceId,
    userId: UserId,
    occurredAt: Date,
  ): EventDraft<InvitationAcceptedEvent> => ({
    type: "workspace.invitation.accepted",
    payload: { invitationId, workspaceId, userId },
    occurredAt,
    aggregateId: workspaceId,
  }),

  invitationRevoked: (
    invitationId: InvitationId,
    workspaceId: WorkspaceId,
    occurredAt: Date,
  ): EventDraft<InvitationRevokedEvent> => ({
    type: "workspace.invitation.revoked",
    payload: { invitationId, workspaceId },
    occurredAt,
    aggregateId: workspaceId,
  }),
};
