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
  /** 閲覧者自身の脱退を楽観的に適用済みか。 */
  left: boolean;
}>;

/**
 * `leave` の `membershipId` が `null` になりうるのは、閲覧者自身の行が
 * 読み込み済みのページに無い場合があるため（`joinedAt` 昇順なので後から
 * 参加した人ほど後ろのページに来る）。行が無くても総数は動くので、差分
 * だけを進める。
 */
export type RosterAction =
  | Readonly<{
      kind: "removeMember";
      membershipId: string;
      role: WorkspaceRoleView;
    }>
  | Readonly<{
      kind: "leave";
      membershipId: string | null;
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
  left: false,
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
    case "leave":
      return {
        ...current,
        members:
          action.membershipId === null
            ? current.members
            : current.members.filter(
                (member) => member.membershipId !== action.membershipId,
              ),
        memberDelta: current.memberDelta - 1,
        ownerDelta: current.ownerDelta - (action.role === "owner" ? 1 : 0),
        left: true,
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
 * 判定材料はどちらも読み込み済みのページの外から取る — owner 数はサーバー
 * の厳密値（ページから数え直すと、先頭 50 件に他の owner が載らないだけで
 * 自分が唯一の owner に見え、正当な脱退が閉じる）、閲覧者のロールは
 * `listMembers` の `viewerRole`（`joinedAt` 昇順なので、後から参加した閲覧者
 * 自身の行は先頭ページに無い）。楽観的な除名・脱退の分（`ownerDelta`）だけ
 * を足す。
 *
 * 自分の脱退を楽観適用した後は判定そのものが意味を失うので `left` で閉じる
 * — そうしないと、脱退の往復のあいだだけ「最後の owner は脱退できません」が
 * 出る。
 */
export const selfIsLastOwner = (
  roster: Roster,
  viewerRole: WorkspaceRoleView,
  serverOwnerCount: number,
): boolean =>
  !roster.left &&
  viewerRole === "owner" &&
  serverOwnerCount + roster.ownerDelta <= 1;

/**
 * 脱退（WS-06 手順 1）を出せるか。閲覧者自身の行が読み込み済みのページに
 * 載っているかには依存しない。
 */
export const canLeave = (
  roster: Roster,
  viewerRole: WorkspaceRoleView,
  serverOwnerCount: number,
): boolean =>
  !roster.left && !selfIsLastOwner(roster, viewerRole, serverOwnerCount);
