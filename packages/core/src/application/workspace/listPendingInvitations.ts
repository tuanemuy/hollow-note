import { Invitation } from "@repo/core/domain/workspace/invitation";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { ensureCanManageMembers } from "./invitation";
import { resolvePagination } from "./pagination";
import { resolveWorkspaceAccess } from "./resolveWorkspaceAccess";
import {
  type PendingInvitationListView,
  toPendingInvitationView,
} from "./view";

export type ListPendingInvitationsInput = Readonly<{
  workspaceId: string;
  userId: string;
  page?: number;
  limit?: number;
}>;

const DEFAULT_LIMIT = 50;

/**
 * Lists the invitations still awaiting an answer
 * (UC-workspace-014, spec/usecases/workspace.md#listpendinginvitations).
 *
 * Only `manageMembers` may read it: a pending invitation names an address
 * that has not joined, which is not part of the member roster every
 * member may see.
 *
 * The store lists every status and the narrowing happens here, so `count`
 * is the number of pending invitations shown rather than the store's
 * total — an accepted or revoked invitation is not something the screen
 * counts. A lapsed invitation stays in the list, flagged `expired`, since
 * resending it is the action the screen offers.
 *
 * The response deliberately carries no token: the link is reachable only
 * from the mail, or from the URL the issuing call returned.
 */
export async function listPendingInvitations({
  container,
  input,
}: ServiceArgs<ListPendingInvitationsInput>): Promise<PendingInvitationListView> {
  const pagination = resolvePagination(input, DEFAULT_LIMIT);
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.workspaceId, userId: input.userId },
  });
  ensureCanManageMembers(access.role);

  const workspaceId = WorkspaceId.create(input.workspaceId);
  const page = await container
    .workspaceReaderFor(ScopeKey.workspace(workspaceId))
    .invitation.listByWorkspace(workspaceId, pagination);

  const now = container.clock.now();
  const invitations = page.items
    .filter(Invitation.isPending)
    .map((invitation) => toPendingInvitationView(invitation, now));

  return { invitations, count: invitations.length };
}
