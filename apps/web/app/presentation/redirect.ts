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
