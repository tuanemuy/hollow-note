import { Email, UserId } from "@repo/core/domain/identity/valueObject";
import { Invitation } from "@repo/core/domain/workspace/invitation";
import {
  InvitationId,
  WorkspaceId,
  WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
import { ConflictError, ValidationError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  compensate,
  ensureCanManageMembers,
  invitationUrl,
  retryOnce,
  sendInvitationMail,
} from "./invitation";
import { resendInvitation } from "./resendInvitation";
import { resolveWorkspaceAccess } from "./resolveWorkspaceAccess";
import type { IssuedInvitationView } from "./view";

export type InviteMemberInput = Readonly<{
  workspaceId: string;
  userId: string;
  email: string;
  role: string;
}>;

const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Outstanding invitations one workspace may hold from the last 24 hours.
 * A quota on stock, not a rate limit: accepting or revoking one frees its
 * slot immediately, so nothing can say when the limit lifts.
 */
const PENDING_INVITATION_QUOTA = 50;

/**
 * Issues an invitation and mails the link
 * (UC-workspace-008, spec/usecases/workspace.md#invitemember).
 *
 * Saga: `InvitationRouteStore.reserve` (global, the token hash is its own
 * uniqueness reservation) → scope commit of `Invitation.issue` →
 * `activate` → mail. A failed commit abandons the reservation, so neither
 * the invitation nor the mail survives a half-issued attempt.
 *
 * A second invitation to an address that already holds a pending one is a
 * **tail call** to {@link resendInvitation} rather than a second row: it
 * keeps one live token per address, and nothing has been written here
 * yet, so no unit of work is open when that usecase opens its own. The
 * existing invitation's role is deliberately preserved — changing it
 * means revoking and inviting again (WS-03).
 */
export async function inviteMember({
  container,
  input,
}: ServiceArgs<InviteMemberInput>): Promise<IssuedInvitationView> {
  const {
    clock,
    config,
    idGenerator,
    identityUniqueDirectory,
    invitationRouteStore,
    logger,
    scopeUnitOfWorkProvider,
    secureTokenGenerator,
  } = container;

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const inviterId = UserId.create(input.userId);

  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  ensureCanManageMembers(access.role);

  const email = Email.create(input.email);
  const role = WorkspaceRole.create(input.role);

  const scope = ScopeKey.workspace(workspaceId);
  const reader = container.workspaceReaderFor(scope);

  // The invitee is addressed by email, so "already a member" is only
  // answerable through the identity plane's global email claim; an
  // address nobody has registered cannot be a member of anything.
  const inviteeId = await identityUniqueDirectory.resolve("email", email);
  if (inviteeId !== null) {
    const membership = await reader.membership.findByWorkspaceAndUser(
      workspaceId,
      inviteeId,
    );
    if (membership !== null) {
      throw new ConflictError(
        "ALREADY_MEMBER",
        "The address already belongs to a member of this workspace",
      );
    }
  }

  const now = clock.now();
  const outstanding = await reader.invitation.countPendingIssuedSince(
    workspaceId,
    new Date(now.getTime() - QUOTA_WINDOW_MS),
  );
  if (outstanding >= PENDING_INVITATION_QUOTA) {
    throw new ValidationError(
      "INVITATION_LIMIT_REACHED",
      `The workspace already holds ${PENDING_INVITATION_QUOTA} outstanding invitations`,
    );
  }

  const live = await reader.invitation.findPendingByWorkspaceAndEmail(
    workspaceId,
    email,
  );
  if (live !== null) {
    const resent = await resendInvitation({
      container,
      input: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        invitationId: live.entity.id,
      },
    });
    return {
      invitationId: resent.invitationId,
      email: live.entity.email,
      role: live.entity.role,
      expiresAt: resent.expiresAt,
      invitationUrl: resent.invitationUrl,
    };
  }

  const invitationId = InvitationId.create(idGenerator.next());
  const operationId = idGenerator.next();
  const secret = secureTokenGenerator.issue();
  const issued = Invitation.issue(
    {
      id: invitationId,
      workspaceId,
      email,
      role,
      invitedBy: inviterId,
      tokenHash: secret.hash,
    },
    now,
  );
  const expiresAt = issued.entity.expiresAt;

  // Refused before the token is claimed globally, and again inside the
  // commit below (spec/usecases/workspace.md#deleteworkspace).
  await reader.admission.assertWritable();

  // The route row carries a single expiry that serves both phases, so it
  // is the invitation's own — a short reservation TTL would stop the link
  // resolving right after activation (ports/invitationRouteStore.ts).
  await invitationRouteStore.reserve({
    tokenHash: secret.hash,
    workspaceId,
    invitationId,
    operationId,
    expiresAt,
  });

  try {
    await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(inviterId);
      await ctx.workspaceOperationLockStore.assertWritable();
      await ctx.invitationRepository.insert(issued.entity);
      ctx.collectEvents(issued.eventDrafts);
    });
  } catch (error) {
    await compensate(logger, "[inviteMember] abandon", error, () =>
      invitationRouteStore.abandon({ tokenHash: secret.hash, operationId }),
    );
    throw error;
  }

  await retryOnce(logger, "[inviteMember] activate", () =>
    invitationRouteStore.activate({ tokenHash: secret.hash, operationId }),
  );

  await sendInvitationMail(container, {
    to: email,
    workspaceName: access.workspaceName,
    role,
    inviterId,
    token: secret.token,
    expiresAt,
  });

  return {
    invitationId,
    email,
    role,
    expiresAt,
    invitationUrl: invitationUrl(config.appUrl, secret.token),
  };
}
