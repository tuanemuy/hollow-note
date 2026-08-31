import {
  extractSerializedError,
  type SerializedError,
  type SerializedErrorKind,
} from "@/presentation/errorResponse";

// P-46（spec/pages/index.md）は「不在」と「権限なし」を同一表示に収斂させる。
// 文言を共有することで、辞書側から権限の有無が漏れる経路を塞ぐ。
const NOTE_INACCESSIBLE_MESSAGE =
  "このノートは見つかりません。URL が変わったか、削除された可能性があります。";

// 「開けないワークスペース」の文言。壊れた ID（`WORKSPACE_INVALID_ID`）と
// 不在・除名（`WORKSPACE_NOT_FOUND`）を同一表示に収斂させる —
// `presentation/scope.ts:workspaceUnavailability` が両方を「開けない」に
// 畳むので、辞書だけが両者を区別すると同じ失敗が経路ごとに違って見える。
const WORKSPACE_INACCESSIBLE_MESSAGE =
  "このワークスペースは開けません。削除されたか、メンバーから外れた可能性があります。";

/**
 * 認可の往復が途中で切れたときの文言。P-05 は `SerializedError` を伴わ
 * ない失敗（プロバイダーが `code` / `state` を返さない）も同じ状態に畳む
 * ので、辞書の外からも同じ文字列を読めるようにしてある。
 */
export const OAUTH_FLOW_INTERRUPTED_MESSAGE =
  "認可の手続きが途中で切れました。もう一度やり直してください。";

/**
 * UI に出るエラー文言の唯一の辞書（spec/design/index.md §9・§10）。
 *
 * `SerializedError` から読むのは `kind` と `code` だけ。原文 message・
 * 内部エラーコード・zod の既定文言は UI に出さないため、表示文字列が
 * サーバー由来の文字列を含む経路をここで断ち切る。辞書に無い `code` は
 * kind ごとの共通文言へ倒すので、新しいエラーが増えても英語が漏れる
 * ことはない（代わりに具体性が落ちるだけ）。
 *
 * 文言は §9 の 2 部構成（何が起きたか + 何をすればいいか）に従う。
 */
const MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  UNAUTHENTICATED:
    "サインインが必要です。サインインしてからもう一度お試しください。",
  INVALID_CREDENTIALS:
    "メールアドレスかパスワードが違います。入力内容を確認してもう一度お試しください。",
  EMAIL_NOT_VERIFIED:
    "メールアドレスの確認が済んでいません。登録時に送った確認メールのリンクを開いてください。",
  ACCOUNT_DELETING:
    "このアカウントは削除処理中です。削除の処理が完了するまでサインインできません。",
  THROTTLED:
    "続けて失敗したため、サインインを一時的に受け付けられません。少し待ってからもう一度お試しください。",
  LOCKED:
    "失敗が続いたため、サインインを一時的に停止しています。パスワードを再設定すると、待たずに使えるようになります。",
  RATE_LIMITED:
    "操作の回数が上限に達しました。少し待ってからもう一度お試しください。",

  TERMS_NOT_ACCEPTED:
    "利用規約とプライバシーポリシーへの同意が必要です。チェックを入れてからもう一度お試しください。",
  IDENTITY_INVALID_EMAIL:
    "メールアドレスの形式が正しくありません。入力内容を確認してもう一度お試しください。",
  IDENTITY_INVALID_DISPLAY_NAME:
    "表示名の形式が正しくありません。入力内容を確認してもう一度お試しください。",
  IDENTITY_WEAK_PASSWORD:
    "パスワードの条件を満たしていません。8 文字以上で、英字と数字の両方を含めてください。",

  IDENTITY_TOKEN_EXPIRED:
    "このリンクは期限が切れています。新しいリンクを送り直してください。",
  AUTH_TOKEN_NOT_FOUND:
    "このリンクは使えません。メールのリンクをもう一度開くか、送り直してください。",
  AUTH_TOKEN_ALREADY_CONSUMED:
    "このリンクはすでに使われています。そのままサインインしてください。",

  OAUTH_STATE_INVALID: OAUTH_FLOW_INTERRUPTED_MESSAGE,
  OAUTH_CODE_INVALID:
    "認可の手続きを完了できませんでした。もう一度やり直してください。",
  OAUTH_EMAIL_UNVERIFIED:
    "メールアドレスが確認されていないため、この方法ではサインインできません。プロバイダー側でメールアドレスを確認してからお試しください。",
  EXISTING_ACCOUNT_UNVERIFIED:
    "このメールアドレスは登録済みですが、確認が済んでいません。確認メールのリンクを開いてからお試しください。",
  ACCOUNT_UNAVAILABLE:
    "このアカウントは使用できません。削除の処理が完了するまでサインインできません。",
  PROVIDER_ACCOUNT_ALREADY_LINKED:
    "この外部アカウントは別の利用者に紐づいています。別のアカウントでお試しください。",
  PROVIDER_ACCOUNT_RELEASE_PENDING:
    "この外部アカウントの解除処理が進行中です。少し待ってからもう一度お試しください。",
  IDENTITY_LIMIT_EXCEEDED:
    "登録できるログイン方法は 8 件までです。使っていない方法を解除してからお試しください。",
  INVALID_REDIRECT:
    "遷移先が正しくありません。もう一度最初からお試しください。",
  USER_REQUIRED:
    "サインインが必要です。サインインしてからもう一度お試しください。",

  NOTE_NOT_FOUND: NOTE_INACCESSIBLE_MESSAGE,
  NOTE_GONE: "このノートは削除されています。ノート一覧からお探しください。",
  NOTE_ACCESS_DENIED: NOTE_INACCESSIBLE_MESSAGE,
  NOTE_IS_TRASHED:
    "このノートはゴミ箱にあります。元に戻してからもう一度お試しください。",
  NOTE_CONTENT_TOO_LARGE:
    "内容が上限を超えています。分割してからもう一度お試しください。",
  // 編集（P-12）とゴミ箱（P-14）が届く分。`NOTE_LOCKED_BY_JOB` の共通文言
  // （「もう一度お試しください」）は、ジョブが終わるまで成功しない再試行を
  // 勧めてしまうので、待つことを言う（移動サガの 4 コードと同じ理由）。
  NOTE_LOCKED_BY_JOB:
    "このノートは処理中のため編集できません。変換または再生成が終わるまで待ってから、画面を再読み込みしてください。",
  NOTE_INVALID_TITLE:
    "タイトルは 200 文字までです。短くしてからもう一度お試しください。",
  NOTE_INVALID_STYLE_MODE:
    "表示スタイルの指定が正しくありません。既定スタイルを適用 / 元の装飾のみ から選んでください。",
  NOTE_CANNOT_CAPTURE_EMPTY_CONTENT:
    "本文がまだ用意できていないため編集できません。取り込みが終わってからお試しください。",
  // ゴミ箱の一覧が古いときに出る。再読み込みを促す（`restoreNote` は
  // 冪等ではないので、成功として畳まず理由を返す）。
  NOTE_NOT_TRASHED:
    "このノートはゴミ箱にありません。すでに元に戻されたか完全に削除された可能性があります。画面を再読み込みしてください。",
  REVISION_NOT_FOUND:
    "この版は見つかりません。保持されるのは直近 20 版までです。版の一覧を開き直してください。",

  IDENTITY_PASSWORD_IDENTITY_ALREADY_EXISTS:
    "この方法はすでに登録されています。パスワードを変えたいときは「パスワードを変更」をお使いください。",
  IDENTITY_LAST_IDENTITY_CANNOT_BE_REMOVED:
    "最後のログイン方法は解除できません。別の方法を追加してから解除してください。",
  IDENTITY_NOT_FOUND:
    "このログイン方法は見つかりません。画面を再読み込みしてもう一度お試しください。",
  PASSWORD_IDENTITY_NOT_FOUND:
    "パスワードが登録されていません。先にパスワードを追加してください。",
  USER_NOT_FOUND:
    "アカウントが見つかりません。サインインし直してからお試しください。",

  HANDLE_ALREADY_USED:
    "このハンドルは使われています。別のハンドルでお試しください。",
  IDENTITY_INVALID_HANDLE:
    "ハンドルは英小文字・数字・ハイフン・アンダースコアの 3〜30 文字です。入力内容を確認してもう一度お試しください。",
  IDENTITY_HANDLE_RESERVED:
    "このハンドルは予約されていて使えません。別のハンドルでお試しください。",
  IDENTITY_INVALID_BIO:
    "自己紹介は 500 文字までです。短くしてからもう一度お試しください。",
  IDENTITY_INVALID_AVATAR_URL:
    "このアイコンの場所は保存できません。画像を選び直してからお試しください。",

  // 用途（アイコン / 本文のメディア）で許す形式も上限も違うのに、
  // ドメインが投げるコードは 1 つである。辞書は `code` しか読まないので、
  // 用途で文言を分けることはできない — 両方の条件を書くことでしか
  // 「何を選べばいいか」を伝えられない（`UploadValidationPolicy` の
  // `RULES` が正典）。
  STORAGE_UNSUPPORTED_MIME_TYPE:
    "この形式のファイルは扱えません。アイコンは PNG / JPEG / WebP、本文に挿入する画像・動画は PNG / JPEG / GIF / WebP / SVG / MP4 / WebM が使えます。",
  STORAGE_FILE_TOO_LARGE:
    "ファイルが大きすぎます。アイコンは 5 MB、画像は 20 MB（SVG は 128 KB）、動画は 200 MB までです。",
  USAGE_STORAGE_QUOTA_EXCEEDED:
    "保存できる容量の上限に達しました。不要なノートやファイルを削除してからもう一度お試しください。",
  WORKSPACE_INSUFFICIENT_ROLE: "この操作を行う権限がありません。",
  WORKSPACE_NOT_FOUND: WORKSPACE_INACCESSIBLE_MESSAGE,
  WORKSPACE_INVALID_ID: WORKSPACE_INACCESSIBLE_MESSAGE,
  WORKSPACE_INVALID_NAME:
    "ワークスペース名は 1〜80 文字です。入力内容を確認してもう一度お試しください。",
  WORKSPACE_INVALID_DESCRIPTION:
    "説明は 500 文字までです。短くしてからもう一度お試しください。",
  WORKSPACE_INVALID_SLUG:
    "スラッグは英小文字・数字・ハイフン・アンダースコアの 3〜30 文字です。入力内容を確認してもう一度お試しください。",
  WORKSPACE_SLUG_RESERVED:
    "このスラッグは予約されていて使えません。別のスラッグでお試しください。",
  SLUG_ALREADY_USED:
    "このスラッグは使われています。別のスラッグでお試しください。",
  WORKSPACE_SLUG_REQUIRED_TO_PUBLISH:
    "公開するにはスラッグの設定が必要です。一般設定でスラッグを決めてからお試しください。",
  WORKSPACE_PUBLISHED_REQUIRES_SLUG:
    "公開中はスラッグを解除できません。先に非公開に戻してからお試しください。",
  WORKSPACE_QUOTA_EXCEEDED:
    "作成できるワークスペースは 20 件までです。使っていないワークスペースを削除してからお試しください。",
  WORKSPACE_DELETING:
    "このワークスペースは削除処理中です。操作は受け付けられません。",
  WORKSPACE_DIRECTORY_UNAVAILABLE:
    "ワークスペースの情報を確認できませんでした。少し待ってからもう一度お試しください。",
  WORKSPACE_MOVE_IN_PROGRESS:
    "ノートの移動が進行中です。完了してからもう一度お試しください。",
  // 移動サガが返す 4 コード。`conflict` の共通文言（「もう一度お試し
  // ください」）は、ロックが解けるまで成功しない再試行を勧めてしまう。
  NOTE_MOVE_IN_PROGRESS:
    "このノートは別の移動が進行中です。その移動が終わるまで待ってから、画面を再読み込みしてください。",
  MOVE_AUTHORIZATION_LOCK_CONFLICT:
    "このワークスペースで別の移動が進行中です。その移動が終わるまで待ってから、画面を再読み込みしてください。",
  STALE_MEMBERSHIP:
    "移動の途中でメンバーの状態が変わりました。画面を再読み込みして、権限を確かめてからお試しください。",
  STALE_SCOPE_ROUTE:
    "このノートは別の場所へ移されました。画面を再読み込みして、移動先をご確認ください。",
  WORKSPACE_INVALID_ROLE:
    "ロールの指定が正しくありません。owner・editor・viewer から選んでください。",
  ALREADY_MEMBER:
    "このメールアドレスはすでにメンバーです。招待は必要ありません。",
  INVITATION_LIMIT_REACHED:
    "返事待ちの招待が上限に達しました。不要な招待を取り消してからお試しください。",
  INVITATION_NOT_FOUND:
    "この招待は使えません。招待した人にもう一度送ってもらってください。",
  INVITATION_NOT_PENDING:
    "この招待はすでに使われたか、取り消されています。招待した人にもう一度送ってもらってください。",
  WORKSPACE_INVITATION_EXPIRED:
    "この招待は期限が切れています。招待した人にもう一度送ってもらってください。",
  MEMBERSHIP_NOT_FOUND:
    "このメンバーは見つかりません。画面を再読み込みしてもう一度お試しください。",
  MEMBERSHIP_ALREADY_EXISTS:
    "すでにこのワークスペースのメンバーです。そのまま開けます。",
  WORKSPACE_LAST_OWNER_CANNOT_LEAVE:
    "最後の owner は降格・除名・脱退ができません。別のメンバーを owner にしてからお試しください。",
  WORKSPACE_CANNOT_CHANGE_OWN_ROLE:
    "自分のロールは変更できません。他の owner に変更してもらってください。",
  WORKSPACE_CANNOT_REMOVE_SELF:
    "自分を除名することはできません。抜けるときは「脱退」をお使いください。",

  OPTIMISTIC_LOCK_FAILURE: "他の操作と競合しました。もう一度お試しください。",

  CONFIRMATION_MISMATCH:
    "メールアドレスが一致しません。アカウントのメールアドレスをそのまま入力してください。",
  WORKSPACE_MEMBERSHIPS_REMAIN:
    "参加中のワークスペースがあるため、アカウントを削除できません。ワークスペースから脱退するか、owner を他のメンバーに譲るか、ワークスペースを削除してからもう一度お試しください。",
  INVALID_REQUEST_ID:
    "削除の要求を組み立てられませんでした。画面を再読み込みしてもう一度お試しください。",
  IDENTITY_ACCOUNT_DELETION_RETRY_LIMIT_EXCEEDED:
    "削除のやり直しが続いたため、しばらく受け付けられません。時間をおいてからお試しください。",
  ACCOUNT_DELETION_OPERATION_MISMATCH:
    "別の削除処理が進行中です。画面を再読み込みして進捗をご確認ください。",
  DELETION_OPERATION_NOT_FOUND:
    "この削除処理は見つかりません。サインインし直して状態をご確認ください。",
  DELETION_TICKET_INVALID:
    "進捗を確認できませんでした。削除の処理はこのまま進みます。",
  DELETION_TICKET_EXPIRED:
    "進捗を確認できる期間を過ぎました。削除の処理はこのまま進みます。",
};

const MESSAGE_BY_KIND: Readonly<Record<SerializedErrorKind, string>> = {
  business: "入力内容を確認してもう一度お試しください。",
  notFound:
    "対象が見つかりません。URL が変わったか、削除された可能性があります。",
  conflict: "他の操作と競合しました。もう一度お試しください。",
  unauthorized:
    "サインインが必要です。サインインしてからもう一度お試しください。",
  forbidden: "この操作を行う権限がありません。",
  validation: "入力内容を確認してもう一度お試しください。",
  system: "一時的な問題が発生しました。少し待ってからもう一度お試しください。",
  unknown: "うまく処理できませんでした。少し待ってからもう一度お試しください。",
};

export function renderErrorMessage(error: SerializedError): string {
  // `code` はサーバー由来の任意文字列なので、`Object.prototype` 由来の
  // メンバー（"constructor" 等）を辞書のヒットとして拾わないようにする。
  const byCode =
    error.code !== null && Object.hasOwn(MESSAGE_BY_CODE, error.code)
      ? MESSAGE_BY_CODE[error.code]
      : undefined;
  return byCode ?? MESSAGE_BY_KIND[error.kind];
}

export function displayError(error: unknown): string {
  return renderErrorMessage(extractSerializedError(error));
}

export function sanitizeRouteError(error: unknown): string {
  if (import.meta.env.DEV) {
    console.error("Route error:", error);
  } else {
    console.error("Route error");
  }
  return renderErrorMessage(extractSerializedError(error));
}
