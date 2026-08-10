import { getRequestIP } from "@tanstack/react-start/server";

/**
 * Origin key for the login-throttle (`LoginAttemptKey`). Node runtime:
 * the socket-derived request IP; `X-Forwarded-For` stays disabled because
 * it is client-forgeable without a trusted proxy. The Cloudflare slice
 * replaces this with `CF-Connecting-IP` (spec/platform).
 *
 * **Deployment condition — replace this supplier if a reverse proxy sits
 * in front of the process.** The socket IP is then the proxy's for every
 * request, so all clients collapse onto a single `clientKey` and the
 * throttle inverts into an attack: ten deliberate failures against a
 * known e-mail lock that account for 15 minutes
 * (`LoginThrottlePolicy.lockThreshold` / `lockDurationMs`), repeatable
 * indefinitely, from any visitor. Configuring a trusted-proxy hop count
 * is deferred to a follow-up issue; until then a proxied deployment must
 * supply the real client address here. See `docs/runtime_node.md`.
 *
 * Server-only module (imports `@tanstack/react-start/server`).
 */
export function resolveClientKey(): string {
  return getRequestIP() ?? "local";
}
