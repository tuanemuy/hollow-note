import { OAUTH_STATE_TTL_MS } from "@repo/core/application/identity/startOAuthFlow";
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";
import {
  assertOAuthStateBinding,
  deriveOAuthStateBinding,
} from "./oauthStateBinding";

/**
 * 認可往復の束縛 Cookie（{@link assertOAuthStateBinding} の運搬）。
 *
 * Server-only module: server function のハンドラーから動的 import する。
 *
 * 属性は session cookie に揃える（`HttpOnly` / `SameSite=Lax` / `Path=/`、
 * dev の平文 http を除いて `Secure`）。寿命は state 行と同じなので、
 * 取り残された Cookie も state より長く残らない。
 */
const OAUTH_STATE_COOKIE_NAME = "hollow_oauth_state";

// 免除は allowlist で判定する。Vite が `process.env.NODE_ENV` を
// ビルド時に畳み込むため、本番ビルドの成果物では定数 false になる。
const isDevelopment = (): boolean => process.env.NODE_ENV === "development";

export async function setOAuthStateCookie(
  state: string,
  now: Date,
): Promise<void> {
  setCookie(OAUTH_STATE_COOKIE_NAME, await deriveOAuthStateBinding(state), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: !isDevelopment(),
    expires: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
  });
}

/**
 * 束縛が成立しなければ `OAUTH_STATE_INVALID` を投げる。**ユースケースを
 * 呼ぶ前に通すこと** — 通していない `state` を消費すると、攻撃者の
 * コールバック URL を踏んだだけで code の交換まで進んでしまう。
 */
export async function assertOAuthStateCookie(state: string): Promise<void> {
  const value = getCookie(OAUTH_STATE_COOKIE_NAME);
  await assertOAuthStateBinding(
    value !== undefined && value !== "" ? value : null,
    state,
  );
}

export function clearOAuthStateCookie(): void {
  deleteCookie(OAUTH_STATE_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: !isDevelopment(),
  });
}

/**
 * 照合を通さずに終わる往復（キャンセル・引数欠落）のための破棄。
 * **束縛が一致した Cookie だけ**を捨てる — 一致しない Cookie は別の
 * ブラウザーが進行中のフローのものなので、コールバック URL を踏ませる
 * だけで他人のフローを壊せる経路になる。
 */
export async function clearBoundOAuthStateCookie(state: string): Promise<void> {
  const value = getCookie(OAUTH_STATE_COOKIE_NAME);
  if (value === undefined || value === "") {
    return;
  }
  if (value !== (await deriveOAuthStateBinding(state))) {
    return;
  }
  clearOAuthStateCookie();
}
