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
 * The narrowing to `pending` happens in the store, so `count` is the
 * total number of pending invitations rather than how many this page
 * holds: narrowing after the page was drawn would report "no pending
 * invitations" for a workspace whose latest page is all accepted or
 * revoked, and would hand the pager a number it cannot page with. A
 * lapsed invitation stays in the list, flagged `expired`, since resending
 * it is the action the screen offers.
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
    .invitation.listPendingByWorkspace(workspaceId, pagination);

  const now = container.clock.now();
  const invitations = page.items.map((invitation) =>
    toPendingInvitationView(invitation, now),
  );

  return { invitations, count: page.count };
}
