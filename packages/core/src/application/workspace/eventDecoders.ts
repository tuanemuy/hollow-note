import { Version } from "@repo/core/domain/common/version";
import { Email, UserId } from "@repo/core/domain/identity/valueObject";
import type {
  InvitationAcceptedEvent,
  InvitationCreatedEvent,
  InvitationRevokedEvent,
  MembershipAddedEvent,
  MembershipRemovedEvent,
  MembershipRoleChangedEvent,
  WorkspaceCreatedEvent,
  WorkspaceDeletedEvent,
  WorkspaceProfileUpdatedEvent,
  WorkspacePublishedEvent,
  WorkspaceSlugChangedEvent,
  WorkspaceUnpublishedEvent,
} from "@repo/core/domain/workspace/events";
import {
  InvitationId,
  MembershipId,
  WorkspaceId,
  WorkspaceName,
  type WorkspaceRole,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import { z } from "zod";
import { buildEventDecoder } from "../events/buildDecoder";

/**
 * Wire decoders for the workspace events. Decoders live in the application
 * layer because they depend on it. Each schema is `.strict()` so a payload
 * with extra keys — a schema-skewed row — fails as
 * `SystemError(DataIntegrityError)` instead of passing silently.
 *
 * Every one of the twelve is registered even though all but
 * `membership.roleChanged` are audit-only
 * (`spec/domains/workspace.md` ドメインイベント) and have no subscriber: the
 * relay decodes before it dispatches, so an unregistered type is
 * quarantined at `maxAttempts` rather than acknowledged with a warning.
 */

const roleSchema = z.enum(["owner", "editor", "viewer"]);

const workspaceIdOnly = z.object({ workspaceId: z.string().min(1) }).strict();
type WorkspaceIdOnly = z.infer<typeof workspaceIdOnly>;

export const workspaceEventDecoders = {
  "workspace.created": buildEventDecoder<
    WorkspaceCreatedEvent,
    { workspaceId: string; ownerId: string }
  >(
    "workspace.created",
    z
      .object({ workspaceId: z.string().min(1), ownerId: z.string().min(1) })
      .strict(),
    (parsed) => ({
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      ownerId: UserId.create(parsed.ownerId),
    }),
  ),

  "workspace.profileUpdated": buildEventDecoder<
    WorkspaceProfileUpdatedEvent,
    { workspaceId: string; name: string }
  >(
    "workspace.profileUpdated",
    z
      .object({ workspaceId: z.string().min(1), name: z.string().min(1) })
      .strict(),
    (parsed) => ({
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      name: WorkspaceName.create(parsed.name),
    }),
  ),

  "workspace.slugChanged": buildEventDecoder<
    WorkspaceSlugChangedEvent,
    {
      workspaceId: string;
      previousSlug: string | null;
      currentSlug: string | null;
    }
  >(
    "workspace.slugChanged",
    z
      .object({
        workspaceId: z.string().min(1),
        previousSlug: z.string().min(1).nullable(),
        currentSlug: z.string().min(1).nullable(),
      })
      .strict(),
    (parsed) => ({
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      previousSlug:
        parsed.previousSlug === null
          ? null
          : WorkspaceSlug.create(parsed.previousSlug),
      currentSlug:
        parsed.currentSlug === null
          ? null
          : WorkspaceSlug.create(parsed.currentSlug),
    }),
  ),

  "workspace.published": buildEventDecoder<
    WorkspacePublishedEvent,
    { workspaceId: string; slug: string }
  >(
    "workspace.published",
    z
      .object({ workspaceId: z.string().min(1), slug: z.string().min(1) })
      .strict(),
    (parsed) => ({
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      slug: WorkspaceSlug.create(parsed.slug),
    }),
  ),

  "workspace.unpublished": buildEventDecoder<
    WorkspaceUnpublishedEvent,
    WorkspaceIdOnly
  >("workspace.unpublished", workspaceIdOnly, (parsed) => ({
    workspaceId: WorkspaceId.create(parsed.workspaceId),
  })),

  "workspace.deleted": buildEventDecoder<
    WorkspaceDeletedEvent,
    { workspaceId: string; operationId: string }
  >(
    "workspace.deleted",
    z
      .object({
        workspaceId: z.string().min(1),
        operationId: z.string().min(1),
      })
      .strict(),
    (parsed) => ({
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      operationId: parsed.operationId,
    }),
  ),

  "workspace.membership.added": buildEventDecoder<
    MembershipAddedEvent,
    { workspaceId: string; userId: string; role: WorkspaceRole }
  >(
    "workspace.membership.added",
    z
      .object({
        workspaceId: z.string().min(1),
        userId: z.string().min(1),
        role: roleSchema,
      })
      .strict(),
    (parsed) => ({
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      userId: UserId.create(parsed.userId),
      role: parsed.role,
    }),
  ),

  "workspace.membership.roleChanged": buildEventDecoder<
    MembershipRoleChangedEvent,
    {
      workspaceId: string;
      userId: string;
      membershipId: string;
      previousRole: WorkspaceRole;
      currentRole: WorkspaceRole;
      sourceVersion: number;
    }
  >(
    "workspace.membership.roleChanged",
    z
      .object({
        workspaceId: z.string().min(1),
        userId: z.string().min(1),
        membershipId: z.string().min(1),
        previousRole: roleSchema,
        currentRole: roleSchema,
        sourceVersion: z.number(),
      })
      .strict(),
    (parsed) => ({
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      userId: UserId.create(parsed.userId),
      membershipId: MembershipId.create(parsed.membershipId),
      previousRole: parsed.previousRole,
      currentRole: parsed.currentRole,
      sourceVersion: Version.create(parsed.sourceVersion),
    }),
  ),

  "workspace.membership.removed": buildEventDecoder<
    MembershipRemovedEvent,
    { workspaceId: string; userId: string }
  >(
    "workspace.membership.removed",
    z
      .object({ workspaceId: z.string().min(1), userId: z.string().min(1) })
      .strict(),
    (parsed) => ({
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      userId: UserId.create(parsed.userId),
    }),
  ),

  "workspace.invitation.created": buildEventDecoder<
    InvitationCreatedEvent,
    {
      invitationId: string;
      workspaceId: string;
      email: string;
      role: WorkspaceRole;
    }
  >(
    "workspace.invitation.created",
    z
      .object({
        invitationId: z.string().min(1),
        workspaceId: z.string().min(1),
        email: z.string().min(1),
        role: roleSchema,
      })
      .strict(),
    (parsed) => ({
      invitationId: InvitationId.create(parsed.invitationId),
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      email: Email.create(parsed.email),
      role: parsed.role,
    }),
  ),

  "workspace.invitation.accepted": buildEventDecoder<
    InvitationAcceptedEvent,
    { invitationId: string; workspaceId: string; userId: string }
  >(
    "workspace.invitation.accepted",
    z
      .object({
        invitationId: z.string().min(1),
        workspaceId: z.string().min(1),
        userId: z.string().min(1),
      })
      .strict(),
    (parsed) => ({
      invitationId: InvitationId.create(parsed.invitationId),
      workspaceId: WorkspaceId.create(parsed.workspaceId),
      userId: UserId.create(parsed.userId),
    }),
  ),

  "workspace.invitation.revoked": buildEventDecoder<
    InvitationRevokedEvent,
    { invitationId: string; workspaceId: string }
  >(
    "workspace.invitation.revoked",
    z
      .object({
        invitationId: z.string().min(1),
        workspaceId: z.string().min(1),
      })
      .strict(),
    (parsed) => ({
      invitationId: InvitationId.create(parsed.invitationId),
      workspaceId: WorkspaceId.create(parsed.workspaceId),
    }),
  ),
} as const;
