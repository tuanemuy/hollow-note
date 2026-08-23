import { SameOriginPolicy } from "@repo/core/domain/identity/services/sameOriginPolicy";

/**
 * Open-redirect guard: only same-origin absolute paths survive
 * (`//evil.example`, scheme-ful values and control-character smuggling
 * all fall back to `/notes`).
 *
 * 述語そのものは ADR 051 でドメインに 1 本化されている（`//host` /
 * バックスラッシュ / 制御文字の 3 つの回避形）。ここが持つのは「弾いた
 * ときどこへ倒すか」という導線の決定だけ。
 *
 * Kept in its own module — free of `createServerFn` and every other
 * framework import — so it stays a plain pure function that unit tests can
 * import without pulling the server-function runtime in.
 */
export function safeRedirectPath(value: string | undefined | null): string {
  return typeof value === "string" && SameOriginPolicy.isSameOriginPath(value)
    ? value
    : "/notes";
}

/** 転送境界が `redirect` に課す DoS 上限。 */
export const REDIRECT_MAX_LENGTH = 2048;

/**
 * loader が遷移元として渡す `location.href` の clamp。`/notes` 系は
 * `validateSearch` を持たず任意長のクエリが href に載るので、上限超えを
 * そのまま送ると転送境界の拒否で画面ごと errorComponent に落ちる。倒し先は
 * `safeRedirectPath` が弾いたときと同じ `/notes`。
 */
export function boundedRedirectSource(href: string): string {
  return href.length <= REDIRECT_MAX_LENGTH ? href : "/notes";
}

/**
 * `/signin` へ戻す redirect の options。フレームワークの `redirect()` は
 * 呼ばず options だけを返すので、このモジュールは純関数のまま保たれる。
 */
export function signInRedirectOptions(redirectTo: string | undefined | null): {
  to: "/signin";
  search: { redirect: string };
} {
  return { to: "/signin", search: { redirect: safeRedirectPath(redirectTo) } };
}
