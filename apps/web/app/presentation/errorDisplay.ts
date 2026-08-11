import {
  extractSerializedError,
  type SerializedError,
  type SerializedErrorKind,
} from "@/presentation/errorResponse";

// P-46（spec/pages/index.md）は「不在」と「権限なし」を同一表示に収斂させる。
// 文言を共有することで、辞書側から権限の有無が漏れる経路を塞ぐ。
const NOTE_INACCESSIBLE_MESSAGE =
  "このノートは見つかりません。URL が変わったか、削除された可能性があります。";

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

  OAUTH_STATE_INVALID:
    "認可の手続きが途中で切れました。もう一度サインインからやり直してください。",
  OAUTH_CODE_INVALID:
    "認可の手続きを完了できませんでした。もう一度サインインからやり直してください。",
  OAUTH_EMAIL_UNVERIFIED:
    "メールアドレスが確認されていないため、この方法ではサインインできません。プロバイダー側でメールアドレスを確認してからお試しください。",
  EXISTING_ACCOUNT_UNVERIFIED:
    "このメールアドレスは登録済みですが、確認が済んでいません。確認メールのリンクを開いてからお試しください。",
  ACCOUNT_UNAVAILABLE:
    "このアカウントは使用できません。削除の処理が完了するまでサインインできません。",
  PROVIDER_ACCOUNT_ALREADY_LINKED:
    "この外部アカウントは別の利用者に紐づいています。別のアカウントでお試しください。",
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

  OPTIMISTIC_LOCK_FAILURE: "他の操作と競合しました。もう一度お試しください。",
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
