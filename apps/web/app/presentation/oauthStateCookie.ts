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

const isProduction = (): boolean => process.env.NODE_ENV === "production";

export async function setOAuthStateCookie(
  state: string,
  now: Date,
): Promise<void> {
  setCookie(OAUTH_STATE_COOKIE_NAME, await deriveOAuthStateBinding(state), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
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
    secure: isProduction(),
  });
}
