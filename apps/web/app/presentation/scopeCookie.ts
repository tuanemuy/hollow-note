import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";
import { parseScope, type ScopeSelection, serializeScope } from "./scope";

/**
 * 表示中のスコープの運搬（WS-02「選択は URL に反映され、次回の訪問時にも
 * 引き継がれる」）。
 *
 * URL が正本で、この Cookie は**入口（`/`）だけが読む引き継ぎ**である。
 * localStorage ではなく Cookie なのは、引き継ぎが必要な瞬間がサーバー側の
 * リダイレクト判定だからで、クライアントに置くと一度個人の文脈を描いてから
 * 飛び直すことになる。
 *
 * server-only モジュール — ハンドラーの中から動的 import で読むこと。
 */
const SCOPE_COOKIE_NAME = "hollow_scope";

/** 引き継ぎの寿命。セッションより長くてよい（権限は開いた先が判定する）。 */
const SCOPE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// `session.ts` と同じ allowlist 判定（spec/adr/037）。分類できない
// `NODE_ENV` は `Secure` を付ける側へ倒す。
const isDevelopment = (): boolean => process.env.NODE_ENV === "development";

export function readScopeSelection(): ScopeSelection {
  return parseScope(getCookie(SCOPE_COOKIE_NAME) ?? null);
}

export function writeScopeSelection(scope: ScopeSelection): void {
  if (scope.kind === "personal") {
    clearScopeSelection();
    return;
  }
  setCookie(SCOPE_COOKIE_NAME, serializeScope(scope), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: !isDevelopment(),
    maxAge: SCOPE_COOKIE_MAX_AGE_SECONDS,
  });
}

/** 個人へ戻す。削除・脱退のように文脈が消える操作の応答でも呼ぶ。 */
export function clearScopeSelection(): void {
  deleteCookie(SCOPE_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: !isDevelopment(),
  });
}
