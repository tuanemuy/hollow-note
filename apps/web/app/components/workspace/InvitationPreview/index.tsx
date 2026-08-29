import type { InvitationPreviewView } from "@repo/core/application/workspace/view";
import type { ReactNode } from "react";
import { serializeError } from "@/presentation/errorResponse";
import { loadInvitationPreview } from "./action";
import { InvitationActions } from "./panel";

/**
 * P-06 招待の確認（モック P06-invitation.html、PAGE-p06-001..005）。
 *
 * 未サインインでも読める。参加の条件を先に示し、セッションを求めるのは
 * 受諾の時点だけ（WS-04）。
 *
 * 使えない招待は理由ごとに表示を分ける（P-06 の状態一覧、WS-04「その旨を
 * 表示し、招待者への連絡を促す」）。分けてよいのは**トークンが実在した
 * 場合だけ**で、届かないトークンは理由を持たない「使えません」に倒す
 * — 状態を答えること自体が、そのトークンが実在するという答えになるため。
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

/**
 * サインイン中の閲覧者。`email` は招待先との照合にだけ使い、この
 * サーバーコンポーネントの外（クライアント）へは出さない。
 */
type Viewer = Readonly<{ userId: string; email: string }>;

export async function InvitationPreview({
  token,
  viewer,
}: {
  token: string;
  viewer: Viewer | null;
}) {
  const userId = viewer === null ? null : viewer.userId;
  // 断片の中で `throw` すると Flight ストリームを素の Error が渡り、
  // `kind` タグを失ってからルートの境界に届くので、終端表示をここで描く。
  let preview: InvitationPreviewView;
  try {
    preview = await loadInvitationPreview(token, userId);
  } catch (error) {
    if (serializeError(error).kind === "notFound") {
      return <InvitationUnknown />;
    }
    throw error;
  }

  if (preview.state === "alreadyMember") {
    // 受諾済みのリンクを本人が再訪した経路。`acceptInvitation` は
    // `INVITATION_NOT_PENDING` で落ちるので受諾は出さず、そのワークスペース
    // のノート一覧へ直接送る（PAGE-p06-003、WS-04「参加済みである旨を示して
    // ワークスペースへ遷移する」）。`workspaceId` を載せるのはこの分岐だけで
    // （`InvitationPreviewView` の JSDoc）、`null` なら状態を作れていないので
    // 個人のノート一覧へ倒す。
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
              href={`/workspaces/${encodeURIComponent(preview.workspaceId)}/notes`}
            >
              {preview.workspaceName} を開く
            </a>
          )
        }
      />
    );
  }

  if (preview.state !== "acceptable") {
    return <InvitationUnusable state={preview.state} />;
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
        <InvitationActions
          token={token}
          inviteeEmail={preview.email}
          // 招待先と別のアカウントで開いているときだけ確認を挟む
          // （WS-04「異なる場合、確認したうえで参加させる」）。どちらも
          // `Email` の正規形なので単純な一致で判定できる。
          mismatched={viewer !== null && viewer.email !== preview.email}
        />
      )}
    </main>
  );
}

/** 実在しないトークン。理由を持たない終端表示に倒す。 */
function InvitationUnknown() {
  return (
    <ResultPanel
      tone="warning"
      title="この招待は使えません"
      body="リンクが正しくないか、招待が取り消されています。招待した人にもう一度送ってもらってください。"
      actions={
        <a className={ghostLinkClass} href="/">
          トップへ
        </a>
      }
    />
  );
}

type UnusableState = Exclude<
  InvitationPreviewView["state"],
  "acceptable" | "alreadyMember"
>;

const UNUSABLE_PANEL: Readonly<
  Record<UnusableState, Readonly<{ title: string; body: string }>>
> = {
  expired: {
    title: "この招待は期限が切れています",
    body: "招待の有効期限は 14 日です。招待した人に、もう一度送ってもらってください。",
  },
  revoked: {
    title: "この招待は取り消されています",
    body: "招待した人が取り消しました。参加が必要な場合は、招待し直してもらってください。",
  },
  accepted: {
    title: "この招待はすでに使われています",
    body: "別のアカウントがこの招待で参加しました。あなたが参加するには、招待した人に新しい招待を送ってもらってください。",
  },
  workspaceMissing: {
    title: "このワークスペースは削除されています",
    body: "招待の宛先だったワークスペースはもうありません。招待した人に確認してください。",
  },
};

function InvitationUnusable({ state }: { state: UnusableState }) {
  const panel = UNUSABLE_PANEL[state];
  return (
    <ResultPanel
      tone="warning"
      title={panel.title}
      body={panel.body}
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
