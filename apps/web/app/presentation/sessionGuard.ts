import { redirect } from "@tanstack/react-router";
import { signInRedirectOptions } from "./redirect";

/**
 * 断片ブリッジ用のガード。セッションを解決し、無ければ遷移元へ戻れる形で
 * `/signin` へ送る。ルートの `beforeLoad` ガードと違い、判定と断片の描画が
 * 同じ要求に収まる。`redirectTo` は転送境界から来るので、行き先の組み立ては
 * `signInRedirectOptions`（`safeRedirectPath` を必ず通す純関数）に委ねる。
 *
 * Server-only module: `session.ts` を動的 import する規約はそのまま。
 */
export async function requireSessionOrRedirect(redirectTo: string) {
  const { sessionUserOrNull } = await import("./session");
  const user = await sessionUserOrNull();
  if (user === null) {
    throw redirect(signInRedirectOptions(redirectTo));
  }
  return user;
}
