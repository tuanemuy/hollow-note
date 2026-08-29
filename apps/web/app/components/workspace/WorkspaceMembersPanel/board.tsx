"use client";

import type {
  PendingInvitationView,
  WorkspaceMemberView,
  WorkspaceRoleView,
} from "@repo/core/application/workspace/view";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useActionState,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { emailFormatError } from "@/components/auth/fieldValidation";
import {
  fieldErrorClass,
  inputClass,
  inputInvalidClass,
} from "@/components/auth/formStyles";
import {
  dangerButtonClass,
  errorTextClass,
  ghostButtonClass,
  panelClass,
  panelNoteClass,
  panelTitleClass,
  primaryButtonClass,
  subtleButtonClass,
} from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import {
  changeMemberRoleFn,
  inviteMemberFn,
  leaveWorkspaceFn,
  removeMemberFn,
  resendInvitationFn,
  revokeInvitationFn,
} from "@/routes/workspaces/$workspaceId/settings/-action";

/**
 * P-32 の操作を持つ島（モック P32-workspace-members.html、
 * PAGE-p32-001..008）。
 *
 * 招待の発行・取り消し・メンバーの除名・脱退はいずれも**一覧メンバー
 * シップの変更**なので、CLAUDE.md の所有権の規則どおり 2 つの一覧をこの
 * 親が所有する。特に取り消し・除名・脱退は、楽観的除去が行を先に
 * アンマウントするため行側に持たせるとエラー表示ごと消えてしまう。
 * ロール変更と再送は行の中で完結する変更なので、それぞれの葉が自分の
 * `useOptimistic` と失敗表示を持つ。
 *
 * 最後の owner の保護はサーバー（`MembershipPolicy`）が正本で、ここでは
 * **楽観的リストから引き直した** owner 数で操作を先に閉じる。サーバーが
 * 返した `ownerCount` は変更前の集合に対する判定なので、1 人降格した直後
 * に「まだ降ろせる」と見えてしまう。
 *
 * この保護が画面に出るのは**自分の脱退だけ**である。ロール変更・除名を
 * 出せるのは `canManage`（= owner）の閲覧者に限られ、その閲覧者自身が
 * owner を 1 人数えてしまうので、「他人が唯一の owner」は成立しない。
 * 他人の行に降格・除名の禁止を描いても到達しないため、置いていない。
 */

const ROLES: readonly WorkspaceRoleView[] = ["owner", "editor", "viewer"];

const ROLE_LABEL: Readonly<Record<WorkspaceRoleView, string>> = {
  owner: "owner",
  editor: "editor",
  viewer: "viewer",
};

/** 送信中の招待だけが持つ番兵。実 ID とは衝突しない。 */
const PENDING_INVITATION_ID = "optimistic-invitation";

type Roster = Readonly<{
  members: readonly WorkspaceMemberView[];
  invitations: readonly PendingInvitationView[];
}>;

type RosterAction =
  | Readonly<{ kind: "removeMember"; membershipId: string }>
  | Readonly<{ kind: "revokeInvitation"; invitationId: string }>
  | Readonly<{ kind: "addInvitation"; email: string; role: WorkspaceRoleView }>;

function applyRoster(current: Roster, action: RosterAction): Roster {
  switch (action.kind) {
    case "removeMember":
      return {
        ...current,
        members: current.members.filter(
          (member) => member.membershipId !== action.membershipId,
        ),
      };
    case "revokeInvitation":
      return {
        ...current,
        invitations: current.invitations.filter(
          (invitation) => invitation.invitationId !== action.invitationId,
        ),
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
      };
  }
}

type IssuedInvitation = Readonly<{ email: string; url: string }>;

/**
 * 送信の要求（`<form action>` が渡す `FormData`）と、owner の確認に対する
 * 返事を 1 つの入口に束ねる。確認は送信そのものの一段であって別の状態
 * ではないので、`useActionState` の外に持つと pending が二重になる。
 */
type InvitePayload = FormData | "confirmOwner" | "cancelOwner";

type InviteState = Readonly<{
  error: string | null;
  issued: IssuedInvitation | null;
  /** owner ロールの重さを説明する確認の待ち（WS-03 異常系）。 */
  ownerConfirmEmail: string | null;
}>;

const IDLE_INVITE: InviteState = {
  error: null,
  issued: null,
  ownerConfirmEmail: null,
};

type Confirming =
  | Readonly<{ kind: "removeMember"; membershipId: string }>
  | Readonly<{ kind: "revokeInvitation"; invitationId: string }>
  | Readonly<{ kind: "leave" }>
  | null;

export function WorkspaceMembersBoard({
  workspaceId,
  viewerUserId,
  members,
  invitations,
  canManage,
}: {
  workspaceId: string;
  viewerUserId: string;
  members: readonly WorkspaceMemberView[];
  invitations: readonly PendingInvitationView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const inviteMember = useServerFn(inviteMemberFn);
  const revokeInvitation = useServerFn(revokeInvitationFn);
  const removeMember = useServerFn(removeMemberFn);
  const leaveWorkspace = useServerFn(leaveWorkspaceFn);

  const [roster, dispatchRoster] = useOptimistic(
    { members, invitations },
    applyRoster,
  );
  const [isMutating, startMutating] = useTransition();
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRoleView>("editor");
  const emailId = useId();
  const roleId = useId();
  const inviteErrorId = useId();
  const membersHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const invitationsHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const ownerCount = roster.members.filter(
    (member) => member.role === "owner",
  ).length;
  const self =
    roster.members.find((member) => member.userId === viewerUserId) ?? null;
  const selfIsLastOwner =
    self !== null && self.role === "owner" && ownerCount <= 1;

  const reconcile = () =>
    router.invalidate().catch(() => {
      console.error("Workspace members reconcile failed");
    });

  const [inviteState, submitInvite, isInviting] = useActionState(
    async (
      _previous: InviteState,
      payload: InvitePayload,
    ): Promise<InviteState> => {
      if (payload === "cancelOwner") return IDLE_INVITE;
      const address = email.trim();
      // 形式は送る前に弾く（WS-03）。転送境界も同じパターンで閉じている
      // ので、ここを抜けた値だけがユースケースに届く。
      const formatError = emailFormatError(address);
      if (formatError !== null) {
        return { error: formatError, issued: null, ownerConfirmEmail: null };
      }
      if (inviteRole === "owner" && payload !== "confirmOwner") {
        return { error: null, issued: null, ownerConfirmEmail: address };
      }
      dispatchRoster({
        kind: "addInvitation",
        email: address,
        role: inviteRole,
      });
      let issued: IssuedInvitation;
      try {
        const view = await inviteMember({
          data: { workspaceId, email: address, role: inviteRole },
        });
        issued = { email: view.email, url: view.invitationUrl };
      } catch (error) {
        return {
          error: displayError(error),
          issued: null,
          ownerConfirmEmail: null,
        };
      }
      setEmail("");
      // 招待はもう成立しているので、再取得の失敗を「送れなかった」と
      // 見せない（再送で 2 通目を出させないため try の外に置く）。
      await reconcile();
      return { error: null, issued, ownerConfirmEmail: null };
    },
    IDLE_INVITE,
  );

  // 入力中の形式の指摘。空欄は「まだ書いていない」なので指摘しない
  // （送信ボタンの活性は空欄でも閉じる）。
  const emailProblem = email.trim() === "" ? null : emailFormatError(email);
  const inviteProblem = emailProblem ?? inviteState.error;

  const copyInvitationUrl = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => setCopyNotice("招待リンクをコピーしました"))
      .catch(() =>
        setCopyNotice(
          "コピーできませんでした。リンクを選択してコピーしてください",
        ),
      );
  };

  const onRevokeInvitation = (invitationId: string) => {
    setConfirming(null);
    startMutating(async () => {
      setNotice(null);
      dispatchRoster({ kind: "revokeInvitation", invitationId });
      try {
        await revokeInvitation({ data: { workspaceId, invitationId } });
      } catch (error) {
        setRosterError(displayError(error));
        return;
      }
      setRosterError(null);
      setNotice("招待を取り消しました。");
      // 押した「取り消し」は楽観的除去で行ごと消えるので、焦点をこの
      // 一覧の見出しへ引き取らないと `document.body` へ落ちる。
      invitationsHeadingRef.current?.focus();
      await reconcile();
    });
  };

  const onRemoveMember = (membershipId: string) => {
    setConfirming(null);
    startMutating(async () => {
      setNotice(null);
      dispatchRoster({ kind: "removeMember", membershipId });
      try {
        await removeMember({ data: { workspaceId, membershipId } });
      } catch (error) {
        setRosterError(displayError(error));
        return;
      }
      setRosterError(null);
      setNotice("メンバーを除名しました。");
      membersHeadingRef.current?.focus();
      await reconcile();
    });
  };

  const onLeave = () => {
    setConfirming(null);
    startMutating(async () => {
      setNotice(null);
      if (self !== null) {
        dispatchRoster({
          kind: "removeMember",
          membershipId: self.membershipId,
        });
      }
      try {
        await leaveWorkspace({ data: { workspaceId } });
      } catch (error) {
        setRosterError(displayError(error));
        return;
      }
      setRosterError(null);
      // 脱退した文脈はもう開けない。個人のノートへ戻す（WS-06 手順 4）。
      await router.navigate({ to: "/notes", search: {} });
    });
  };

  return (
    <>
      {canManage ? null : (
        <Alert tone="info" title="読み取り専用です" role="note">
          メンバーの招待・ロール変更・除名ができるのは owner だけです。
        </Alert>
      )}

      {canManage ? (
        <section className={panelClass}>
          <h2 className={panelTitleClass}>メンバーを招待</h2>
          <p className={panelNoteClass}>
            招待メールを送ります。まだ Hollow
            のアカウントがない相手も、そのまま登録して参加できます。
          </p>

          <form action={submitInvite} noValidate>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor={emailId}>
                メールアドレス
              </label>
              <input
                id={emailId}
                type="email"
                autoComplete="off"
                placeholder="メールアドレス"
                className={`${inputClass} h-10 min-w-50 flex-1 text-sm ${
                  inviteProblem === null ? "" : inputInvalidClass
                }`}
                value={email}
                disabled={isInviting}
                aria-invalid={inviteProblem !== null}
                aria-describedby={inviteErrorId}
                onChange={(event) => setEmail(event.target.value)}
              />
              <label className="sr-only" htmlFor={roleId}>
                ロール
              </label>
              <select
                id={roleId}
                className={selectClass}
                value={inviteRole}
                disabled={isInviting}
                onChange={(event) =>
                  setInviteRole(event.target.value as WorkspaceRoleView)
                }
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className={primaryButtonClass}
                disabled={
                  isInviting || email.trim() === "" || emailProblem !== null
                }
                aria-busy={isInviting}
              >
                {isInviting ? "送信中..." : "招待を送る"}
              </button>
            </div>

            <p
              className={fieldErrorClass}
              id={inviteErrorId}
              aria-live="polite"
            >
              {inviteProblem}
            </p>
            <p className="mt-2 text-xs text-ink-tertiary">
              editor はノートの取り込み・編集・公開ができます。viewer
              は閲覧とダウンロードのみです。
            </p>
          </form>

          {inviteState.ownerConfirmEmail === null ? null : (
            <Alert
              tone="warning"
              role="note"
              title="owner として招待しますか"
              actions={
                <>
                  <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={isInviting}
                    aria-busy={isInviting}
                    onClick={() => submitInvite("confirmOwner")}
                  >
                    {isInviting ? "送信中..." : "owner として招待する"}
                  </button>
                  <button
                    type="button"
                    className={ghostButtonClass}
                    disabled={isInviting}
                    onClick={() => submitInvite("cancelOwner")}
                  >
                    やめる
                  </button>
                </>
              }
            >
              owner
              はメンバーの招待・ロール変更・除名に加えて、ワークスペースの設定・公開・削除まで行えます。
              <b className="font-medium text-ink">
                {inviteState.ownerConfirmEmail}
              </b>{" "}
              に同じ権限を渡すことになります。
            </Alert>
          )}

          {inviteState.issued !== null ? (
            <div className="mt-4 border-t border-hairline pt-4">
              <p className="mb-2 text-sm text-ink-secondary">
                <b className="font-medium text-ink">
                  {inviteState.issued.email}
                </b>{" "}
                に招待を送りました。リンクを直接渡すこともできます。
              </p>
              <button
                type="button"
                className={subtleButtonClass}
                onClick={() => {
                  if (inviteState.issued !== null) {
                    copyInvitationUrl(inviteState.issued.url);
                  }
                }}
              >
                招待リンクをコピー
              </button>
            </div>
          ) : null}

          <p
            className="text-xs text-ink-tertiary not-empty:mt-2"
            role="status"
            aria-live="polite"
          >
            {copyNotice}
          </p>
        </section>
      ) : null}

      <section className={panelClass}>
        <h2
          ref={membersHeadingRef}
          tabIndex={-1}
          className={`${panelTitleClass} focus-visible:shadow-none`}
        >
          メンバー{" "}
          <span className="text-sm font-normal text-ink-tertiary">
            {roster.members.length} 人
          </span>
        </h2>

        <ul>
          {roster.members.map((member) => (
            <MemberRow
              key={member.membershipId}
              workspaceId={workspaceId}
              member={member}
              isSelf={member.userId === viewerUserId}
              canManage={canManage}
              isLastOwner={member.userId === viewerUserId && selfIsLastOwner}
              busy={isMutating}
              confirming={
                confirming?.kind === "removeMember" &&
                confirming.membershipId === member.membershipId
              }
              confirmingLeave={
                confirming?.kind === "leave" && member.userId === viewerUserId
              }
              onConfirmRemove={() =>
                setConfirming({
                  kind: "removeMember",
                  membershipId: member.membershipId,
                })
              }
              onConfirmLeave={() => setConfirming({ kind: "leave" })}
              onCancel={() => setConfirming(null)}
              onRemove={() => onRemoveMember(member.membershipId)}
              onLeave={onLeave}
              onChanged={reconcile}
            />
          ))}
        </ul>

        {selfIsLastOwner ? (
          <p className="mt-3 text-xs text-ink-tertiary" id={LAST_OWNER_HINT_ID}>
            最後の owner は脱退できません。別のメンバーを owner
            にするか、ワークスペースごと必要なくなった場合は{" "}
            <Link
              to="/workspaces/$workspaceId/settings/danger"
              params={{ workspaceId }}
              className="text-ink underline underline-offset-2"
            >
              ワークスペースを削除
            </Link>
            してください。
          </p>
        ) : null}
      </section>

      {canManage ? (
        <section className={panelClass}>
          <h2
            ref={invitationsHeadingRef}
            tabIndex={-1}
            className={`${panelTitleClass} focus-visible:shadow-none`}
          >
            保留中の招待{" "}
            <span className="text-sm font-normal text-ink-tertiary">
              {roster.invitations.length} 件
            </span>
          </h2>

          {roster.invitations.length === 0 ? (
            <p className="text-sm text-ink-tertiary">
              返事を待っている招待はありません。
            </p>
          ) : (
            <ul>
              {roster.invitations.map((invitation) => (
                <PendingRow
                  key={invitation.invitationId}
                  workspaceId={workspaceId}
                  invitation={invitation}
                  sending={invitation.invitationId === PENDING_INVITATION_ID}
                  busy={isMutating}
                  confirming={
                    confirming?.kind === "revokeInvitation" &&
                    confirming.invitationId === invitation.invitationId
                  }
                  onConfirm={() =>
                    setConfirming({
                      kind: "revokeInvitation",
                      invitationId: invitation.invitationId,
                    })
                  }
                  onCancel={() => setConfirming(null)}
                  onRevoke={() => onRevokeInvitation(invitation.invitationId)}
                  onCopy={copyInvitationUrl}
                  onResent={reconcile}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* 常設の live region。一覧を変える操作の失敗と成功はここだけに出る。 */}
      <p className={errorTextClass} role="status" aria-live="polite">
        {rosterError}
      </p>
      <p className="text-xs text-success not-empty:mt-2" aria-live="polite">
        {notice}
      </p>
    </>
  );
}

function MemberRow({
  workspaceId,
  member,
  isSelf,
  canManage,
  isLastOwner,
  busy,
  confirming,
  confirmingLeave,
  onConfirmRemove,
  onConfirmLeave,
  onCancel,
  onRemove,
  onLeave,
  onChanged,
}: {
  workspaceId: string;
  member: WorkspaceMemberView;
  isSelf: boolean;
  canManage: boolean;
  /** 自分が唯一の owner のときだけ立つ（脱退の禁止）。 */
  isLastOwner: boolean;
  busy: boolean;
  confirming: boolean;
  confirmingLeave: boolean;
  onConfirmRemove: () => void;
  onConfirmLeave: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onLeave: () => void;
  onChanged: () => Promise<void>;
}) {
  const changeMemberRole = useServerFn(changeMemberRoleFn);
  // ロール変更は行の中で完結する（一覧の増減にならない）ので、葉が自分で
  // 楽観的な値と失敗表示を持つ。
  const [role, setRole] = useOptimistic(
    member.role,
    (_current: WorkspaceRoleView, next: WorkspaceRoleView) => next,
  );
  const [isChanging, startChanging] = useTransition();
  const [roleError, setRoleError] = useState<string | null>(null);
  const roleId = useId();
  const confirmNoteId = useId();

  const onSelectRole = (next: WorkspaceRoleView) => {
    startChanging(async () => {
      setRole(next);
      try {
        await changeMemberRole({
          data: { workspaceId, membershipId: member.membershipId, role: next },
        });
      } catch (error) {
        setRoleError(displayError(error));
        return;
      }
      setRoleError(null);
      await onChanged();
    });
  };

  const name = member.displayName ?? "退会した利用者";
  const confirmOpen = confirming || confirmingLeave;

  return (
    <li className="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-hairline py-3 first:border-t-0 first:pt-0 min-[520px]:grid-cols-[auto_1fr_auto]">
      <span
        aria-hidden="true"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-medium text-ink-secondary"
      >
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          {name}
          {isSelf ? (
            <span className="rounded-xs border border-hairline px-1.5 text-xs text-ink-tertiary">
              あなた
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-tertiary">
          {member.email ?? "メールアドレス非公開"} ·{" "}
          {formatDate(member.joinedAt)}に参加
        </span>
        <span className={fieldErrorClass} role="status" aria-live="polite">
          {roleError}
        </span>
      </span>
      <span className="col-start-2 flex shrink-0 flex-wrap items-center gap-2 min-[520px]:col-start-3">
        {canManage && !isSelf ? (
          <>
            <label className="sr-only" htmlFor={roleId}>
              {name} のロール
            </label>
            <select
              id={roleId}
              className={`${selectClass} h-7.5 px-2 text-xs`}
              value={role}
              disabled={busy || isChanging}
              aria-busy={isChanging}
              onChange={(event) =>
                onSelectRole(event.target.value as WorkspaceRoleView)
              }
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABEL[option]}
                </option>
              ))}
            </select>
          </>
        ) : (
          // 自分のロールは自分では変えられない（`CannotChangeOwnRole`）。
          // 選べない選択肢を出さず、現在のロールだけを示す。
          <span className="text-xs text-ink-tertiary">{ROLE_LABEL[role]}</span>
        )}

        {confirmOpen ? (
          <>
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy}
              aria-describedby={confirmNoteId}
              onClick={confirmingLeave ? onLeave : onRemove}
            >
              {confirmingLeave ? "脱退する" : "除名する"}
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              disabled={busy}
              onClick={onCancel}
            >
              やめる
            </button>
          </>
        ) : isSelf ? (
          <button
            type="button"
            className={ghostButtonClass}
            disabled={busy || isLastOwner}
            aria-describedby={isLastOwner ? LAST_OWNER_HINT_ID : undefined}
            onClick={onConfirmLeave}
          >
            脱退
          </button>
        ) : canManage ? (
          <button
            type="button"
            className={dangerButtonClass}
            disabled={busy}
            onClick={onConfirmRemove}
          >
            除名
          </button>
        ) : null}
      </span>
      {confirmOpen ? (
        <span
          id={confirmNoteId}
          className="col-start-2 text-xs text-ink-secondary"
        >
          {confirmingLeave
            ? "脱退すると、このワークスペースのノートには一切アクセスできなくなります。あなたが作成したノートはワークスペースに残ります。再び参加するには招待が必要です。"
            : `除名すると、${name} はこのワークスペースのノートに一切アクセスできなくなります。${name} が作成したノートはワークスペースに残ります。`}
        </span>
      ) : null}
    </li>
  );
}

function PendingRow({
  workspaceId,
  invitation,
  sending,
  busy,
  confirming,
  onConfirm,
  onCancel,
  onRevoke,
  onCopy,
  onResent,
}: {
  workspaceId: string;
  invitation: PendingInvitationView;
  sending: boolean;
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRevoke: () => void;
  onCopy: (url: string) => void;
  onResent: () => Promise<void>;
}) {
  const resendInvitation = useServerFn(resendInvitationFn);
  // 再送は行の中で完結する。新しい 14 日の窓が張り直されるので、期限切れ
  // の表示は先に消してよい（失敗すればトランジションの終了で戻る）。
  const [expired, setExpired] = useOptimistic(
    invitation.expired,
    (_current: boolean, next: boolean) => next,
  );
  const [isResending, startResending] = useTransition();
  const [resendError, setResendError] = useState<string | null>(null);
  const [resentUrl, setResentUrl] = useState<string | null>(null);

  const onResend = () => {
    startResending(async () => {
      setExpired(false);
      let url: string;
      try {
        const view = await resendInvitation({
          data: { workspaceId, invitationId: invitation.invitationId },
        });
        url = view.invitationUrl;
      } catch (error) {
        setResendError(displayError(error));
        return;
      }
      setResendError(null);
      setResentUrl(url);
      await onResent();
    });
  };

  return (
    <li className="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-hairline py-3 first:border-t-0 first:pt-0 min-[520px]:grid-cols-[auto_1fr_auto]">
      <span
        aria-hidden="true"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-ink-tertiary"
      >
        <MailIcon />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm">{invitation.email}</span>
        <span
          className={`mt-0.5 block text-xs ${
            expired ? "text-warning" : "text-ink-tertiary"
          }`}
        >
          {sending
            ? `${ROLE_LABEL[invitation.role]} として招待を送信中...`
            : expired
              ? `${ROLE_LABEL[invitation.role]} として招待 · 期限切れ（${formatDate(invitation.expiresAt)}）`
              : `${ROLE_LABEL[invitation.role]} として招待 · ${formatDate(invitation.expiresAt)}まで有効`}
        </span>
        <span className={fieldErrorClass} role="status" aria-live="polite">
          {resendError}
        </span>
      </span>
      <span className="col-start-2 flex shrink-0 flex-wrap items-center gap-2 min-[520px]:col-start-3">
        {sending ? null : confirming ? (
          <>
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy}
              onClick={onRevoke}
            >
              取り消す
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              disabled={busy}
              onClick={onCancel}
            >
              やめる
            </button>
          </>
        ) : (
          <>
            {resentUrl === null ? null : (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => onCopy(resentUrl)}
              >
                リンクをコピー
              </button>
            )}
            <button
              type="button"
              className={expired ? subtleButtonClass : ghostButtonClass}
              disabled={busy || isResending}
              aria-busy={isResending}
              onClick={onResend}
            >
              {isResending ? "送信中..." : expired ? "招待し直す" : "再送"}
            </button>
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy || isResending}
              onClick={onConfirm}
            >
              取り消し
            </button>
          </>
        )}
      </span>
    </li>
  );
}

const LAST_OWNER_HINT_ID = "workspace-last-owner-hint";

const selectClass =
  "h-10 rounded-md border border-hairline-strong bg-bg px-3 text-sm text-ink transition-colors focus:border-transparent focus:shadow-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-55";

const initials = (name: string): string => name.trim().slice(0, 2) || "?";

// 時間帯を明示する。この島は SSR で 1 度描かれてからハイドレートされる
// ので、既定（実行環境の時間帯）のままだとサーバーとブラウザーで日付が
// 1 日ずれ、その差がハイドレーション不一致として出る。
const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

const formatDate = (value: Date): string => dateFormat.format(value);

function MailIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="22 6 12 13 2 6" />
    </svg>
  );
}
