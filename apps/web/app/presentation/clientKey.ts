import { getRequestIP } from "@tanstack/react-start/server";

/**
 * Origin key for the login-throttle (`LoginAttemptKey`). Node runtime:
 * the socket-derived request IP; `X-Forwarded-For` stays disabled because
 * it is client-forgeable without a trusted proxy. The Cloudflare slice
 * replaces this with `CF-Connecting-IP` (spec/platform).
 *
 * Server-only module (imports `@tanstack/react-start/server`).
 */
export function resolveClientKey(): string {
  return getRequestIP() ?? "local";
}
