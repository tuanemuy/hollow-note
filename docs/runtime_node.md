# Runtime: Node.js + in-memory adapters (standalone)

Single-process runtime backed by the in-memory reference adapters (`packages/core/src/adapters/memory/`). No database, no Docker, no Cloudflare account required. The full Outbox / domain-event lifecycle (relay → consumer → pruner) runs inside the same process as the HTTP server.

This is the only runtime of the walking-skeleton slice and the default: `pnpm dev` / `pnpm build` / `pnpm start` all alias to the `:node` variants. The final target — Cloudflare Workers + Durable Objects + D1 (spec/platform) — arrives as Issue #11 and swaps only the adapter + entry layers; the memory adapters remain the fast local backend held to the same port-conformance suites.

## Quick start

```bash
pnpm install
cp apps/web/.env.example apps/web/.env    # set APP_URL
pnpm dev                                  # http://localhost:3000
```

For a production-shaped build:

```bash
pnpm build                 # vite build with the Node target (vite.config.node.ts)
pnpm start                 # tsx apps/web/scripts/listen.node.ts — boots @hono/node-server
```

The flow:

1. `vite build --config vite.config.node.ts` writes a fetch-handler bundle to `apps/web/dist/server/server.node.js`.
2. `apps/web/scripts/listen.node.ts` loads `dotenv`, dynamically imports the bundle, calls its `boot()` to construct the memory runtime + DI containers + worker runner, then registers the handler with `@hono/node-server`.
3. SIGTERM / SIGINT triggers the shutdown sequence described below.

## Persistence model

There is none — by design. `packages/core/src/application/di/memoryRuntime.ts` builds one process-wide `MemoryBackend` shared by the request and worker containers (pinned on `globalThis` so the SSR and RSC module graphs see the same store across dev HMR reloads). **All data is lost when the process exits or the dev server restarts.** Manual test scenarios must complete within one process lifetime.

The backend is a regular adapter, not a fake: it passes the shared port-conformance suites (`packages/core/src/adapters/conformance/`) that any future real backend must also pass. See `docs/test.md`.

Verification-mail links can be printed to the server log by the memory `MailSender`, so the sign-up → verify flow can be completed locally without a mail provider. This is **opt-in**: set `MEMORY_MAIL_LOG_ACTION_URL=true` and the `mail.sent` lines gain an `actionUrl` field. Leave it off otherwise — the verification URL embeds the raw one-shot token, and consuming it issues a session, so log access alone is enough to take over a freshly registered account.

## Environment variables

`apps/web/scripts/listen.node.ts` loads `apps/web/.env` before importing the rest of the app. The schema is validated at boot in `packages/core/src/application/di/serverNode.ts`.

| Variable              | Required | Default                 | Purpose                                                                             |
| --------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `APP_URL`             | yes      | `http://localhost:3000` | Public origin used to build absolute URLs (verification links, share URLs).         |
| `PORT`                | no       | `3000`                  | HTTP listener port.                                                                 |
| `HOSTNAME`            | no       | `0.0.0.0`               | HTTP listener bind address.                                                         |
| `OUTBOX_BATCH_SIZE`   | no       | `100`                   | Max outbox rows claimed per relay tick.                                             |
| `OUTBOX_LEASE_MS`     | no       | `300000`                | Lease window (ms) before a stuck claim becomes reclaimable.                         |
| `OUTBOX_MAX_ATTEMPTS` | no       | `2`                     | Per-event max attempts before quarantine (`failed_at` stamp).                       |
| `OUTBOX_RETENTION_MS` | no       | `604800000` (7 days)    | Retention window before processed outbox rows are pruned.                           |
| `MEMORY_MAIL_LOG_ACTION_URL` | no | `false`              | `true` logs the action URL (verification link, raw token) on `mail.sent`. Manual testing only. |

The share-token encryption key ring is minted fresh at process start (ephemeral AES-256-GCM key). Existing share URLs therefore survive only as long as the process — consistent with the rest of the in-memory model.

## Worker runner (relay / consumer / pruner)

`apps/web/app/worker/node/runner.ts#createNodeWorkerRunner` is the same-process orchestrator for the roles that ship as separate Workers on Cloudflare.

| Role     | Cloudflare (Issue #11)                  | Node                                                                                                              |
| -------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Relay    | cron + Service Binding                  | 60-second `setInterval` fallback + `InProcessRelayTrigger.kick()` from the request-path UoW (`setImmediate` fan)  |
| Consumer | Queue subscriber                        | `InMemoryQueueDispatcher` — currently a no-op handler: no event subscriber exists in the walking-skeleton slice   |
| Pruner   | crons (outbox + auth state)             | 24-hour `setInterval` running `pruneOutbox` only. `pruneExpiredAuthState` is implemented and tested but **not scheduled** here — its cron / queue wiring lands with the Cloudflare slice |
| DLQ      | Dedicated Worker                        | `processOutboxEvents` already logs `[outbox] quarantining event …` when `failed_at` is stamped — no separate sweep |

`runner.start()` fires an immediate relay tick (drains backlog), registers the two intervals plus SIGTERM / SIGINT handlers, and returns synchronously; the timers `unref` so short-lived scripts and tests can exit naturally. Commits kick the relay out-of-band via `bindNodeRelayTrigger`, and concurrent kicks collapse into one in-flight tick.

## Graceful shutdown

`apps/web/scripts/listen.node.ts` and `apps/web/app/server.node.ts` both register SIGTERM / SIGINT handlers:

1. `@hono/node-server` stops accepting new HTTP connections.
2. `runner.stop()` clears the intervals, stops the relay trigger, and awaits in-flight ticks.
3. `process.exit(0)`. Data is gone at this point (see *Persistence model*).

The shutdown promise is memoised — calling `stop()` repeatedly is safe.

## Single-process operational constraints

The runtime is **single-process by construction**: state lives in the process heap. Running multiple instances gives each its own, unrelated store. There is nothing to scale horizontally here; the multi-tenant target is the Cloudflare runtime.

## Logging and observability

The application uses the `ConsoleLogger` port (`packages/core/src/application/ports/logger.ts`) — every log line goes to stdout / stderr as JSON-ish objects. Notable lines:

- `mail.sent` — memory mail deliveries. Carries `actionUrl` (the verification link, raw token included) only when `MEMORY_MAIL_LOG_ACTION_URL=true`.
- `[outbox] quarantining event …` — the DLQ surface.

## Deployment conditions

**Behind a reverse proxy, replace the `clientKey` supplier.** `apps/web/app/presentation/clientKey.ts` returns the socket-derived request IP; `X-Forwarded-For` is deliberately not trusted because it is client-forgeable. Put a TLS terminator or load balancer in front of the process and every request then reports the proxy's address, so all clients collapse onto one `clientKey`. The login throttle is keyed `signIn:{email}:{clientKey}`, so it inverts from a defence into an attack: any visitor can fail ten sign-ins against a known e-mail and lock that account for 15 minutes, repeatably. A proxied deployment must supply the real client address there (a trusted-proxy hop setting is a follow-up issue; the Cloudflare slice replaces the module with `CF-Connecting-IP`).

## Known limitations

- **No durability.** Every restart starts blank. This is the intended shape of the walking skeleton, not an oversight.
- **No auth-state prune scheduling.** `pruneExpiredAuthState` runs only from tests; expired sessions / tokens are still rejected logically (absolute expiry + epoch checks), the physical rows just accumulate for the process lifetime.
- **No built-in DLQ surface** beyond the quarantine log line.
