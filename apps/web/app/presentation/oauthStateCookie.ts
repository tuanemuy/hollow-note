import { ValidationError } from "@repo/core/application/errors";
import { OAUTH_STATE_TTL_MS } from "@repo/core/application/identity/startOAuthFlow";
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

/**
 * 認可往復の束縛 Cookie の運搬。
 *
 * Server-only module: server function のハンドラーから動的 import する。
 *
 * 載るのは `state` と独立した一回限りの秘密で、`state` を知るだけでは
 * 再現できない（`state` は認可 URL とコールバック URL に載って往復する）。
 * 値の照合は `state` の消費と同じ原子操作の中で行われるため、ここが持つ
 * のは運搬と不在判定だけになる。
 *
 * 属性は session cookie に揃える（`HttpOnly` / `SameSite=Lax` / `Path=/`、
 * dev の平文 http を除いて `Secure`）。寿命は state 行と同じなので、
 * 取り残された Cookie も state より長く残らない。
 */
const OAUTH_STATE_COOKIE_NAME = "hollow_oauth_state";

// 免除は allowlist で判定する。Vite が `process.env.NODE_ENV` を
// ビルド時に畳み込むため、本番ビルドの成果物では定数 false になる。
const isDevelopment = (): boolean => process.env.NODE_ENV === "development";

export function setOAuthStateCookie(stateBinding: string, now: Date): void {
  setCookie(OAUTH_STATE_COOKIE_NAME, stateBinding, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: !isDevelopment(),
    expires: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
  });
}

export function readOAuthStateCookie(): string | null {
  const value = getCookie(OAUTH_STATE_COOKIE_NAME);
  return value !== undefined && value !== "" ? value : null;
}

/**
 * Cookie が無い消費要求はユースケースを呼ぶ前に畳む。原因を区別しても
 * 利用者の取れる行動は「もう一度やり直す」の 1 つしかないので、束縛の
 * 不一致と同じ `OAUTH_STATE_INVALID` にする。
 */
export function requireOAuthStateCookie(): string {
  const value = readOAuthStateCookie();
  if (value === null) {
    throw new ValidationError(
      "OAUTH_STATE_INVALID",
      "Authorization state is not bound to this browser",
    );
  }
  return value;
}

export function clearOAuthStateCookie(): void {
  deleteCookie(OAUTH_STATE_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: !isDevelopment(),
  });
}
