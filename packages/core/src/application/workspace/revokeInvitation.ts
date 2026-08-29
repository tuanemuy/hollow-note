import { UserId } from "@repo/core/domain/identity/valueObject";
import { Invitation } from "@repo/core/domain/workspace/invitation";
import {
  InvitationId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  ensureCanManageMembers,
  invitationNotFound,
  invitationNotPending,
  retryOnce,
} from "./invitation";
import { resolveWorkspaceAccess } from "./resolveWorkspaceAccess";

export type RevokeInvitationInput = Readonly<{
  workspaceId: string;
  userId: string;
  invitationId: string;
}>;

/**
 * Cancels a pending invitation
 * (UC-workspace-010, spec/usecases/workspace.md#revokeinvitation).
 *
 * The scope commit comes first and the global route is closed after it,
 * the opposite order from issuing. That is deliberate: between the two,
 * the authoritative Invitation already reads `revoked`, so preview and
 * accept reject the still-resolving link — while the reverse order would
 * leave a live invitation nobody could reach. `revoke` is idempotent
 * against the target state rather than the operation, so a lost response
 * is repaired by repeating the call under a fresh operation id.
 */
export async function revokeInvitation({
  container,
  input,
}: ServiceArgs<RevokeInvitationInput>): Promise<void> {
  const { clock, idGenerator, invitationRouteStore, logger } = container;

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const invitationId = InvitationId.create(input.invitationId);
  const actorId = UserId.create(input.userId);

  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  ensureCanManageMembers(access.role);

  const now = clock.now();
  const operationId = idGenerator.next();

  const tokenHash = await container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(workspaceId),
    async (ctx) => {
      await ctx.cleanupAdmission.assertWritable();
      await ctx.cleanupAdmission.assertActorWritable(actorId);
      const stored = await ctx.invitationRepository.findById(invitationId);
      if (stored === null || stored.entity.workspaceId !== workspaceId) {
        throw invitationNotFound();
      }
      if (!Invitation.isPending(stored.entity)) {
        throw invitationNotPending();
      }
      const revoked = Invitation.revoke(stored.entity, now);
      await ctx.invitationRepository.save(
        revoked.entity,
        stored.expectedVersion,
      );
      ctx.collectEvents(revoked.eventDrafts);
      return revoked.entity.tokenHash;
    },
  );

  await retryOnce(logger, "[revokeInvitation] revoke route", () =>
    invitationRouteStore.revoke({ tokenHash, invitationId, operationId }),
  );
}
