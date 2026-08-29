import { UserId } from "@repo/core/domain/identity/valueObject";
import { Invitation } from "@repo/core/domain/workspace/invitation";
import {
  InvitationId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  compensate,
  ensureCanManageMembers,
  invitationNotFound,
  invitationNotPending,
  invitationUrl,
  retryOnce,
  sendInvitationMail,
} from "./invitation";
import { resolveWorkspaceAccess } from "./resolveWorkspaceAccess";
import type { ResentInvitationView } from "./view";

export type ResendInvitationInput = Readonly<{
  workspaceId: string;
  userId: string;
  invitationId: string;
}>;

/**
 * Mints a fresh token and a fresh 14-day window for a pending invitation
 * (UC-workspace-009, spec/usecases/workspace.md#resendinvitation).
 *
 * Saga: read the live invitation → `reserveReplacement` (global, the new
 * token is claimed while the old one keeps resolving) → scope commit of
 * `Invitation.resend` → `activateReplacement`, which closes the old route
 * and opens the new one in one transaction so no window exists in which
 * both or neither token resolves. A failed commit abandons the
 * replacement and leaves the link already in the recipient's inbox valid.
 *
 * The read and the write are two transactions because the reservation has
 * to sit between them: the new token must be globally claimed before the
 * scope commits to it. The OCC token captured by the read is what makes
 * the split safe — a concurrent resend or revoke bumps the version, and
 * this attempt loses the save and abandons its replacement, which is also
 * how two concurrent resends resolve to one live token.
 */
export async function resendInvitation({
  container,
  input,
}: ServiceArgs<ResendInvitationInput>): Promise<ResentInvitationView> {
  const {
    clock,
    config,
    idGenerator,
    invitationRouteStore,
    logger,
    scopeUnitOfWorkProvider,
    secureTokenGenerator,
  } = container;

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const invitationId = InvitationId.create(input.invitationId);
  const actorId = UserId.create(input.userId);

  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  ensureCanManageMembers(access.role);

  const scope = ScopeKey.workspace(workspaceId);
  const now = clock.now();
  const replacement = secureTokenGenerator.issue();
  const operationId = idGenerator.next();

  const pending = await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    // Refused before the replacement token is claimed globally, and again
    // inside the commit below (spec/usecases/workspace.md#deleteworkspace).
    await ctx.workspaceOperationLockStore.assertWritable();
    const stored = await ctx.invitationRepository.findById(invitationId);
    if (stored === null || stored.entity.workspaceId !== workspaceId) {
      throw invitationNotFound();
    }
    if (!Invitation.isPending(stored.entity)) {
      throw invitationNotPending();
    }
    return {
      oldTokenHash: stored.entity.tokenHash,
      email: stored.entity.email,
      role: stored.entity.role,
      expectedVersion: stored.expectedVersion,
      resent: Invitation.resend(stored.entity, replacement.hash, now),
    };
  });

  const expiresAt = pending.resent.entity.expiresAt;
  await invitationRouteStore.reserveReplacement({
    oldTokenHash: pending.oldTokenHash,
    newTokenHash: replacement.hash,
    workspaceId,
    invitationId,
    operationId,
    expiresAt,
  });

  try {
    await scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(actorId);
      await ctx.workspaceOperationLockStore.assertWritable();
      await ctx.invitationRepository.save(
        pending.resent.entity,
        pending.expectedVersion,
      );
      ctx.collectEvents(pending.resent.eventDrafts);
    });
  } catch (error) {
    await compensate(logger, "[resendInvitation] abandon", error, () =>
      invitationRouteStore.abandon({
        tokenHash: replacement.hash,
        operationId,
      }),
    );
    throw error;
  }

  await retryOnce(logger, "[resendInvitation] activateReplacement", () =>
    invitationRouteStore.activateReplacement({
      oldTokenHash: pending.oldTokenHash,
      newTokenHash: replacement.hash,
      invitationId,
      operationId,
    }),
  );

  const mailSent = await sendInvitationMail(container, {
    to: pending.email,
    workspaceName: access.workspaceName,
    role: pending.role,
    inviterId: actorId,
    token: replacement.token,
    expiresAt,
  });

  return {
    invitationId,
    expiresAt,
    invitationUrl: invitationUrl(config.appUrl, replacement.token),
    mailSent,
  };
}
