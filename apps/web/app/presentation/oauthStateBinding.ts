import { ValidationError } from "@repo/core/application/errors";

/**
 * OAuth の認可往復を「フローを開始したブラウザー」に束縛する
 * （spec/adr/029 と同型の login CSRF 対策）。
 *
 * 束縛が無いと、攻撃者は自分のフローを同意まで進めて最終ナビゲーション
 * だけを止め、`?state=…&code=…` の付いたコールバック URL を被害者に踏
 * ませられる。それを消費する POST は自オリジンのページ自身が発するので
 * `Origin` も CSRF トークンも正しく揃い、被害者のブラウザーに攻撃者の
 * セッションが焼かれる。攻撃者が被害者のブラウザーへ持ち込めないのは
 * Cookie だけなので、束縛はそこに置く。
 *
 * Cookie に載せるのは `state` そのものではなくその SHA-256。`Path=/` の
 * Cookie は同一オリジンの全要求に相乗りするので、単回消費の資格情報を
 * そのまま常時運ばせない。
 *
 * フレームワーク非依存の純関数として置く（Cookie の運搬は
 * `oauthStateCookie`）。
 */

const encoder = new TextEncoder();

export async function deriveOAuthStateBinding(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(state));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * 不一致・Cookie 不在はどちらも `OAUTH_STATE_INVALID` に畳む。開始した
 * ブラウザーでない以上、原因を区別しても利用者の取れる行動は「もう一度
 * やり直す」の 1 つしかない（intent が判らない時点の文言は中立に保つ）。
 */
export async function assertOAuthStateBinding(
  cookieValue: string | null,
  state: string,
): Promise<void> {
  if (
    cookieValue === null ||
    cookieValue !== (await deriveOAuthStateBinding(state))
  ) {
    throw new ValidationError(
      "OAUTH_STATE_INVALID",
      "Authorization state is not bound to this browser",
    );
  }
}
