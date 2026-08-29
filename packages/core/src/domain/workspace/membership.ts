import type { WithEventDrafts } from "@repo/core/domain/common/event";
import { Version } from "@repo/core/domain/common/version";
import { RehydrationError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { type WorkspaceEvent, WorkspaceEvents } from "./events";
import { MembershipId, WorkspaceId, WorkspaceRole } from "./valueObject";

export type Membership = Readonly<{
  id: MembershipId;
  workspaceId: WorkspaceId;
  userId: UserId;
  role: WorkspaceRole;
  version: Version;
  joinedAt: Date;
  updatedAt: Date;
}>;

type ReconstructInput = Readonly<{
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  version: number;
  joinedAt: Date;
  updatedAt: Date;
}>;

export const Membership = {
  create: (
    params: Readonly<{
      id: string;
      workspaceId: WorkspaceId;
      userId: UserId;
      role: string;
    }>,
    now: Date,
  ): WithEventDrafts<Membership, WorkspaceEvent> => {
    const membership: Membership = {
      id: MembershipId.create(params.id),
      workspaceId: params.workspaceId,
      userId: params.userId,
      role: WorkspaceRole.create(params.role),
      version: Version.initial(),
      joinedAt: now,
      updatedAt: now,
    };
    return {
      entity: membership,
      eventDrafts: [
        WorkspaceEvents.membershipAdded(
          membership.workspaceId,
          membership.userId,
          membership.role,
          now,
        ),
      ],
    };
  },

  changeRole: (
    membership: Membership,
    role: string,
    now: Date,
  ): WithEventDrafts<Membership, WorkspaceEvent> => {
    const nextRole = WorkspaceRole.create(role);
    if (nextRole === membership.role) {
      return { entity: membership, eventDrafts: [] };
    }
    const next: Membership = {
      ...membership,
      role: nextRole,
      version: Version.next(membership.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        WorkspaceEvents.membershipRoleChanged(
          {
            workspaceId: next.workspaceId,
            userId: next.userId,
            previousRole: membership.role,
            currentRole: nextRole,
          },
          now,
        ),
      ],
    };
  },

  reconstruct: (input: ReconstructInput): Membership => {
    try {
      return {
        id: MembershipId.create(input.id),
        workspaceId: WorkspaceId.create(input.workspaceId),
        userId: UserId.create(input.userId),
        role: WorkspaceRole.create(input.role),
        version: Version.create(input.version),
        joinedAt: input.joinedAt,
        updatedAt: input.updatedAt,
      };
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct Membership ${input.id}`,
        error,
      );
    }
  },
};
