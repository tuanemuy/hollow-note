import type {
  PendingInvitationListView,
  WorkspaceMemberListView,
} from "@repo/core/application/workspace/view";
import { WorkspaceUnavailable } from "@/components/workspace/WorkspaceUnavailable";
import { serializeError } from "@/presentation/errorResponse";
import { loadMembers, loadPendingInvitations } from "./action";
import { WorkspaceMembersBoard } from "./board";

/**
 * P-32 メンバー管理の本体（モック P32-workspace-members.html、
 * PAGE-p32-001..008）。
 *
 * 保留中の招待は `manageMembers` を持つ人しか読めないので、先に
 * `listMembers` の `canManage` を見てから 2 本目を投げる。読み取り専用の
 * メンバーには招待パネルごと出さない。
 */
export async function WorkspaceMembersPanel({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  // 非メンバー（除名直後・削除済み）は `InsufficientRole` で来る。断片の
  // 中で `throw` すると `kind` タグを失ってルート境界に届くので、終端表示を
  // ここで描く（`WorkspacePublishPanel` と同じ理由）。
  let members: WorkspaceMemberListView;
  try {
    members = await loadMembers(workspaceId, userId);
  } catch (error) {
    const { kind } = serializeError(error);
    if (kind === "business" || kind === "forbidden" || kind === "notFound") {
      return <WorkspaceUnavailable />;
    }
    throw error;
  }

  const invitations: PendingInvitationListView = members.canManage
    ? await loadPendingInvitations(workspaceId, userId)
    : { invitations: [], count: 0 };

  return (
    <WorkspaceMembersBoard
      workspaceId={workspaceId}
      viewerUserId={userId}
      members={members.members}
      memberCount={members.count}
      ownerCount={members.ownerCount}
      canManage={members.canManage}
      invitations={invitations.invitations}
      invitationCount={invitations.count}
    />
  );
}
