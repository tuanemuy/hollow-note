import type { InvitationPreviewView } from "@repo/core/application/workspace/view";
import type { ReactNode } from "react";
import { serializeError } from "@/presentation/errorResponse";
import { loadInvitationPreview } from "./action";
import { InvitationActions } from "./panel";

/**
 * P-06 招待の確認（モック P06-invitation.html、PAGE-p06-001..005）。
 *
 * 未サインインでも読める。参加の条件を先に示し、セッションを求めるのは
 * 受諾の時点だけ（WS-04）。期限切れ・取り消し済み・使用済み・届かない
 * トークンは同じ「使えない招待」に畳んで、存在の有無を漏らさない。
 */

const ROLE_NOTE: Readonly<Record<string, string>> = {
  owner: "メンバーと設定を含め、すべてを管理できます",
  editor: "ノートの取り込み・編集・公開ができます",
  viewer: "閲覧とダウンロードのみできます",
};

const primaryLinkClass =
  "inline-flex h-11 w-full items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed";

const ghostLinkClass =
  "inline-flex h-11 w-full items-center justify-center rounded-pill border border-hairline px-5 text-sm font-medium text-ink transition-colors hover:bg-surface";

export async function InvitationPreview({
  token,
  userId,
}: {
  token: string;
  userId: string | null;
}) {
  // 断片の中で `throw` すると Flight ストリームを素の Error が渡り、
  // `kind` タグを失ってからルートの境界に届くので、終端表示をここで描く。
  let preview: InvitationPreviewView;
  try {
    preview = await loadInvitationPreview(token, userId);
  } catch (error) {
    if (serializeError(error).kind === "notFound") {
      return <InvitationUnusable />;
    }
    throw error;
  }

  if (preview.state === "alreadyMember") {
    // 受諾済みのリンクを本人が再訪した経路。`acceptInvitation` は
    // `INVITATION_NOT_PENDING` で落ちるので受諾は出さず、そのワークスペース
    // の文脈へ直接送る（PAGE-p06-003）。`workspaceId` を載せるのはこの分岐
    // だけで（`InvitationPreviewView` の JSDoc）、`null` なら状態を作れて
    // いないのでノート一覧へ倒す。
    return (
      <ResultPanel
        tone="success"
        title="すでに参加しています"
        body={`${preview.workspaceName} のメンバーです。そのまま開けます。`}
        actions={
          preview.workspaceId === null ? (
            <a className={primaryLinkClass} href="/notes">
              ノート一覧へ
            </a>
          ) : (
            <a
              className={primaryLinkClass}
              href={`/workspaces/${encodeURIComponent(preview.workspaceId)}/settings/general`}
            >
              {preview.workspaceName} を開く
            </a>
          )
        }
      />
    );
  }

  if (preview.state !== "acceptable") {
    return <InvitationUnusable />;
  }

  const returnPath = `/invitations/${encodeURIComponent(token)}`;

  return (
    <main className="text-center">
      <span
        aria-hidden="true"
        className="mb-5 inline-flex size-11 items-center justify-center rounded-lg bg-ink text-sm font-medium text-bg"
      >
        {preview.workspaceName.trim().slice(0, 2) || "?"}
      </span>
      <h1 className="text-xl font-medium tracking-tight leading-snug">
        {preview.workspaceName} に招待されています
      </h1>
      <p className="mt-3 text-sm text-ink-secondary">
        {userId === null
          ? "参加するにはサインインが必要です。"
          : "参加すると、このワークスペースのノートを読んだり取り込んだりできるようになります。"}
      </p>

      <dl className="mt-6 mb-6 rounded-lg border border-hairline p-4 text-left text-sm">
        {preview.workspaceDescription === "" ? null : (
          <div className="flex gap-3 border-b border-hairline pb-3">
            <dt className="w-24 shrink-0 text-ink-tertiary">説明</dt>
            <dd className="min-w-0">{preview.workspaceDescription}</dd>
          </div>
        )}
        <div className="flex gap-3 border-b border-hairline py-3">
          <dt className="w-24 shrink-0 text-ink-tertiary">招待した人</dt>
          <dd className="min-w-0">{preview.inviterName ?? "退会した利用者"}</dd>
        </div>
        <div className="flex gap-3 border-b border-hairline py-3">
          <dt className="w-24 shrink-0 text-ink-tertiary">あなたの権限</dt>
          <dd className="min-w-0">
            {preview.role}
            <span className="mt-0.5 block text-xs text-ink-tertiary">
              {ROLE_NOTE[preview.role]}
            </span>
          </dd>
        </div>
        <div className="flex gap-3 pt-3">
          <dt className="w-24 shrink-0 text-ink-tertiary">招待先</dt>
          <dd className="min-w-0 break-all">{preview.email}</dd>
        </div>
      </dl>

      {userId === null ? (
        // PAGE-p06-004。招待 URL を同一オリジンの復帰先として両方の経路へ
        // 渡す。`/signup` の復帰先は外部プロバイダー登録ならそのまま効き、
        // メール + パスワードならサインインへ引き継がれる（メール確認を
        // 挟むので、その往復の中では復帰できない）。
        <div className="flex flex-col gap-2">
          <a
            className={primaryLinkClass}
            href={`/signin?redirect=${encodeURIComponent(returnPath)}`}
          >
            サインインして参加する
          </a>
          <a
            className={ghostLinkClass}
            href={`/signup?redirect=${encodeURIComponent(returnPath)}`}
          >
            アカウントを作る
          </a>
          <p className="mt-2 text-xs text-ink-tertiary">
            メールで登録した場合は、確認を終えてからこの招待リンクをもう一度開いてください。
          </p>
        </div>
      ) : (
        <InvitationActions token={token} />
      )}
    </main>
  );
}

function InvitationUnusable() {
  return (
    <ResultPanel
      tone="warning"
      title="この招待は使えません"
      body="期限が切れているか、取り消されています。招待した人にもう一度送ってもらってください。"
      actions={
        <a className={ghostLinkClass} href="/">
          トップへ
        </a>
      }
    />
  );
}

function ResultPanel({
  tone,
  title,
  body,
  actions,
}: {
  tone: "success" | "warning";
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <main className="text-center">
      <span
        aria-hidden="true"
        className={`mb-5 inline-flex ${
          tone === "success" ? "text-success" : "text-warning"
        }`}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          {tone === "success" ? (
            <polyline points="16 9.5 10.8 15 8 12.3" />
          ) : (
            <polyline points="12 6 12 12 16 14" />
          )}
        </svg>
      </span>
      <h1 className="text-xl font-medium tracking-tight leading-snug">
        {title}
      </h1>
      <p className="mt-3 mb-6 text-sm text-ink-secondary">{body}</p>
      <div className="flex flex-col gap-2">{actions}</div>
    </main>
  );
}
