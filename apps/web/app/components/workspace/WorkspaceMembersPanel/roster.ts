import type {
  PendingInvitationView,
  WorkspaceMemberView,
  WorkspaceRoleView,
} from "@repo/core/application/workspace/view";

/** 送信中の招待だけが持つ番兵。実 ID とは衝突しない。 */
export const PENDING_INVITATION_ID = "optimistic-invitation";

/**
 * P-32 の 2 つの一覧に対する楽観的な状態。
 *
 * `members` / `invitations` は**読み込み済みのページ**であって全体では
 * ない（`listMembers` / `listPendingInvitations` はどちらも 50 件ずつ返す）。
 * ワークスペース全体の総数を知っているのはサーバーが返す `count` /
 * `ownerCount` だけなので、この型はページから数え直す代わりに、その総数へ
 * 足し引きする差分を持つ。
 */
export type Roster = Readonly<{
  members: readonly WorkspaceMemberView[];
  invitations: readonly PendingInvitationView[];
  memberDelta: number;
  ownerDelta: number;
  invitationDelta: number;
}>;

export type RosterAction =
  | Readonly<{
      kind: "removeMember";
      membershipId: string;
      role: WorkspaceRoleView;
    }>
  | Readonly<{ kind: "revokeInvitation"; invitationId: string }>
  | Readonly<{ kind: "addInvitation"; email: string; role: WorkspaceRoleView }>;

export const rosterOf = (
  members: readonly WorkspaceMemberView[],
  invitations: readonly PendingInvitationView[],
): Roster => ({
  members,
  invitations,
  memberDelta: 0,
  ownerDelta: 0,
  invitationDelta: 0,
});

export function applyRoster(current: Roster, action: RosterAction): Roster {
  switch (action.kind) {
    case "removeMember":
      return {
        ...current,
        members: current.members.filter(
          (member) => member.membershipId !== action.membershipId,
        ),
        memberDelta: current.memberDelta - 1,
        ownerDelta: current.ownerDelta - (action.role === "owner" ? 1 : 0),
      };
    case "revokeInvitation":
      return {
        ...current,
        invitations: current.invitations.filter(
          (invitation) => invitation.invitationId !== action.invitationId,
        ),
        invitationDelta: current.invitationDelta - 1,
      };
    case "addInvitation":
      return {
        ...current,
        invitations: [
          ...current.invitations,
          {
            invitationId: PENDING_INVITATION_ID,
            email: action.email,
            role: action.role,
            invitedBy: "",
            createdAt: new Date(0),
            expiresAt: new Date(0),
            expired: false,
          },
        ],
        invitationDelta: current.invitationDelta + 1,
      };
  }
}

/** 閲覧者自身の行。読み込み済みのページに載っていなければ `null`。 */
export const selfOf = (
  roster: Roster,
  viewerUserId: string,
): WorkspaceMemberView | null =>
  roster.members.find((member) => member.userId === viewerUserId) ?? null;

/**
 * 最後の owner の脱退禁止（WS-06 / PAGE-p32-008）。
 *
 * owner 数はワークスペース全体の値で判定する — 読み込み済みのページから
 * 数え直すと、先頭 50 件に他の owner が載らないだけで自分が唯一の owner に
 * 見え、正当な脱退が閉じる。サーバーの厳密値に、楽観的な除名・脱退の分
 * （`ownerDelta`）だけを足す。
 */
export const selfIsLastOwner = (
  roster: Roster,
  viewerUserId: string,
  serverOwnerCount: number,
): boolean => {
  const self = selfOf(roster, viewerUserId);
  return (
    self !== null &&
    self.role === "owner" &&
    serverOwnerCount + roster.ownerDelta <= 1
  );
};
