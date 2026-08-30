import type { WithEventDrafts } from "@repo/core/domain/common/event";
import { Version } from "@repo/core/domain/common/version";
import { BusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import {
  Email,
  TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "./errorCode";
import { type WorkspaceEvent, WorkspaceEvents } from "./events";
import { InvitationId, WorkspaceId, WorkspaceRole } from "./valueObject";

type InvitationBase = Readonly<{
  id: InvitationId;
  workspaceId: WorkspaceId;
  email: Email;
  role: WorkspaceRole;
  invitedBy: UserId;
  tokenHash: TokenHash;
  version: Version;
  createdAt: Date;
  expiresAt: Date;
}>;

export type PendingInvitation = InvitationBase &
  Readonly<{ status: "pending" }>;
export type AcceptedInvitation = InvitationBase &
  Readonly<{ status: "accepted"; acceptedAt: Date; acceptedBy: UserId }>;
export type RevokedInvitation = InvitationBase &
  Readonly<{ status: "revoked"; revokedAt: Date }>;

export type Invitation =
  | PendingInvitation
  | AcceptedInvitation
  | RevokedInvitation;

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITATION_TTL_MS = 14 * DAY_MS;

type ReconstructInput = Readonly<{
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  invitedBy: string;
  tokenHash: string;
  status: string;
  acceptedAt?: Date | null;
  acceptedBy?: string | null;
  revokedAt?: Date | null;
  version: number;
  createdAt: Date;
  expiresAt: Date;
}>;

const isExpired = (invitation: Invitation, now: Date): boolean =>
  invitation.expiresAt.getTime() <= now.getTime();

export const Invitation = {
  isPending: (invitation: Invitation): invitation is PendingInvitation =>
    invitation.status === "pending",

  isExpired,

  /** The invitation is valid for 14 days from issue. */
  issue: (
    params: Readonly<{
      id: string;
      workspaceId: WorkspaceId;
      email: string;
      role: string;
      invitedBy: UserId;
      tokenHash: TokenHash;
    }>,
    now: Date,
  ): WithEventDrafts<PendingInvitation, WorkspaceEvent> => {
    const invitation: PendingInvitation = {
      status: "pending",
      id: InvitationId.create(params.id),
      workspaceId: params.workspaceId,
      email: Email.create(params.email),
      role: WorkspaceRole.create(params.role),
      invitedBy: params.invitedBy,
      tokenHash: params.tokenHash,
      version: Version.initial(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    };
    return {
      entity: invitation,
      eventDrafts: [createdEvent(invitation, now)],
    };
  },

  /**
   * Replaces the token and restarts the 14-day window. The previous token
   * stops resolving once the route store points at the new hash, so a
   * resend invalidates the link already sent.
   */
  resend: (
    invitation: PendingInvitation,
    tokenHash: TokenHash,
    now: Date,
  ): WithEventDrafts<PendingInvitation, WorkspaceEvent> => {
    const next: PendingInvitation = {
      ...invitation,
      tokenHash,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      version: Version.next(invitation.version),
    };
    return { entity: next, eventDrafts: [createdEvent(next, now)] };
  },

  accept: (
    invitation: PendingInvitation,
    acceptedBy: UserId,
    now: Date,
  ): WithEventDrafts<AcceptedInvitation, WorkspaceEvent> => {
    if (isExpired(invitation, now)) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InvitationExpired,
        "The invitation has expired",
      );
    }
    const next: AcceptedInvitation = {
      ...invitation,
      status: "accepted",
      acceptedAt: now,
      acceptedBy,
      version: Version.next(invitation.version),
    };
    return {
      entity: next,
      eventDrafts: [
        WorkspaceEvents.invitationAccepted(
          next.id,
          next.workspaceId,
          acceptedBy,
          now,
        ),
      ],
    };
  },

  revoke: (
    invitation: PendingInvitation,
    now: Date,
  ): WithEventDrafts<RevokedInvitation, WorkspaceEvent> => {
    const next: RevokedInvitation = {
      ...invitation,
      status: "revoked",
      revokedAt: now,
      version: Version.next(invitation.version),
    };
    return {
      entity: next,
      eventDrafts: [
        WorkspaceEvents.invitationRevoked(next.id, next.workspaceId, now),
      ],
    };
  },

  reconstruct: (input: ReconstructInput): Invitation => {
    try {
      const base: InvitationBase = {
        id: InvitationId.create(input.id),
        workspaceId: WorkspaceId.create(input.workspaceId),
        email: Email.create(input.email),
        role: WorkspaceRole.create(input.role),
        invitedBy: UserId.create(input.invitedBy),
        tokenHash: TokenHash.create(input.tokenHash),
        version: Version.create(input.version),
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      };
      switch (input.status) {
        case "pending":
          return { ...base, status: "pending" };
        case "accepted":
          return {
            ...base,
            status: "accepted",
            acceptedAt: requireField(input.acceptedAt, "acceptedAt"),
            acceptedBy: UserId.create(
              requireField(input.acceptedBy, "acceptedBy"),
            ),
          };
        case "revoked":
          return {
            ...base,
            status: "revoked",
            revokedAt: requireField(input.revokedAt, "revokedAt"),
          };
        default:
          throw new BusinessRuleError(
            WorkspaceErrorCode.InvalidId,
            `Invalid invitation status: ${input.status}`,
          );
      }
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct Invitation ${input.id}`,
        error,
      );
    }
  },
};

function createdEvent(
  invitation: PendingInvitation,
  occurredAt: Date,
): ReturnType<typeof WorkspaceEvents.invitationCreated> {
  return WorkspaceEvents.invitationCreated(
    {
      invitationId: invitation.id,
      workspaceId: invitation.workspaceId,
      email: invitation.email,
      role: invitation.role,
    },
    occurredAt,
  );
}

function requireField<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InvalidId,
      `Missing invitation field: ${field}`,
    );
  }
  return value;
}
