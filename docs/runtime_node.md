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

1. `vite build --config vite.config.node.ts` writes a fetch-handler bundle to `apps/web/dist/server/server.node.js` and the browser build to `apps/web/dist/client/`.
2. `apps/web/scripts/listen.node.ts` loads `dotenv`, dynamically imports the bundle, calls its `boot()` to construct the memory runtime + DI containers + worker runner, then registers the handler with `@hono/node-server`.
3. SIGTERM / SIGINT triggers the shutdown sequence described below.

## Static assets

`vite dev` serves the browser build itself, so static serving is a production-only concern. `apps/web/scripts/listen.node.ts` puts a small file handler in front of the app's fetch handler: a `GET` / `HEAD` whose path resolves to a real file under `dist/client` is answered from disk, everything else falls through to the app. The client root is derived from whichever server-entry candidate resolved, so a deployment that ships `dist/` as its own root (`server/` + `client/` siblings) works unchanged.

Headers differ from the app's by design:

| Response          | `Cache-Control`                          | Other                                    |
| ----------------- | ---------------------------------------- | ---------------------------------------- |
| `/assets/*`       | `public, max-age=31536000, immutable`    | `nosniff`, content-type from extension   |
| other static file | `public, max-age=0, must-revalidate`     | `nosniff`, content-type from extension   |
| app responses     | `private, no-store` (+ CSP, Referrer-Policy, nosniff) | see `apps/web/app/server.node.ts` |

Vite content-hashes everything under `assets/`, so those URLs are safe to pin forever; files copied verbatim from `apps/web/public/` keep their name across deploys and must be revalidated. The app's `private, no-store` default deliberately does **not** reach static files — it exists because SSR HTML and GET server-function responses are user-specific, which a hashed bundle is not.

Putting a CDN or reverse proxy in front of the process is the expected production shape; the handler here is the floor, not a replacement for one.

`apps/web/public/` does not exist yet, so the brand assets `__root.tsx` links (`/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`, `/site.webmanifest`, `/og-image.png`) 404 in every mode, `pnpm dev` included. Dropping the files into that directory is all that is needed — vite copies them to `dist/client/` and the handler above serves them.

## Persistence model

There is none — by design. `packages/core/src/application/di/memoryRuntime.ts` builds one process-wide `MemoryBackend` shared by the request and worker containers (pinned on `globalThis` so the SSR and RSC module graphs see the same store across dev HMR reloads). **All data is lost when the process exits or the dev server restarts.** Manual test scenarios must complete within one process lifetime.

The backend is a regular adapter, not a fake: it passes the shared port-conformance suites (`packages/core/src/adapters/conformance/`) that any future real backend must also pass. See `docs/test.md`.

Verification-mail links can be printed to the server log by the memory `MailSender`, so the sign-up → verify flow can be completed locally without a mail provider. This is **opt-in**: set `MEMORY_MAIL_LOG_ACTION_URL=true` and the `mail.sent` lines gain an `actionUrl` field. Leave it off otherwise — the verification URL embeds the raw one-shot token, and consuming it issues a session, so log access alone is enough to take over a freshly registered account.

## Environment variables

`apps/web/scripts/listen.node.ts` loads `apps/web/.env` before importing the rest of the app. The schema is validated at boot in `packages/core/src/application/di/serverNode.ts`.

| Variable              | Required | Default                 | Purpose                                                                             |
| --------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `APP_URL`             | yes      | `http://localhost:3000` | Public origin used to build absolute URLs (verification links, share URLs).         |
| `OAUTH_DEV_MODE`      | see below | — (commented out in `.env.example`) | `true` selects the loopback dev identity provider (`/dev/oauth/authorize`). Accepted **only** under `NODE_ENV=development`, which only `vite dev` sets; every other value refuses to boot. |
| `NODE_ENV`            | no       | `production` under `pnpm start` | `scripts/listen.node.ts` declares it before loading `.env`, so the boot-time guards see the same value vite folded into the bundle. Only the literal `development` unlocks the dev IdP. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | see below | — | Google OpenID Connect credentials. Authorized redirect URI: `${APP_URL}/auth/callback/google`. |
| `DELETION_TICKET_KEY`  | no       | per-process random key   | Signing key (32 bytes, base64url) for the status ticket the account-deletion screen polls with. Unset means the key is minted at boot, so a restart makes outstanding tickets unreadable and the progress display falls back to "the deletion keeps going"; the deletion itself still runs to completion. Set but not 32 base64url bytes is a startup error. |
| `PORT`                | no       | `3000`                  | HTTP listener port.                                                                 |
| `HOSTNAME`            | no       | `0.0.0.0`               | HTTP listener bind address.                                                         |
| `OUTBOX_BATCH_SIZE`   | no       | `100`                   | Max outbox rows claimed per relay tick.                                             |
| `OUTBOX_LEASE_MS`     | no       | `300000`                | Lease window (ms) before a stuck claim becomes reclaimable.                         |
| `SCOPE_TASK_LEASE_MS` | no       | `300000`                | Lease window (ms) a scope-task claim holds its whole batch for. In this runtime it sets exactly one thing: how long a row the turn did not settle stays invisible to the ticks (see *Worker runner*). The default needs no adjustment here, because neither bound of the band bites — a second writer settling a row the first still holds takes a second writer, and a crashed writer leaves no rows behind at all. Pick a value from that band (lower = worst-case turn, upper = the oldest-task age SLO, one minute at priority 0) on a deployment where tasks outlive the writer that claimed them; `spec/platform` states it. |
| `OUTBOX_MAX_ATTEMPTS` | no       | `2`                     | Per-event max attempts before quarantine (`failed_at` stamp).                       |
| `OUTBOX_RETENTION_MS` | no       | `604800000` (7 days)    | Retention window before processed outbox rows are pruned.                           |
| `MEMORY_MAIL_LOG_ACTION_URL` | no | `false`              | `true` logs the action URL (verification link, raw token) on `mail.sent`. Manual testing only. |

### Choosing an OAuth identity provider

Boot picks exactly one sign-in provider and **fails if it cannot** — there is no silent fallback to a fake:

1. `OAUTH_DEV_MODE=true` **and `NODE_ENV=development`** → the loopback dev IdP. It serves its own consent screen at `/dev/oauth/authorize` (the route and its consent server function both 404 whenever the flag is off), so the approve *and* cancel paths of the OAuth flow are reachable without Google credentials. `OAUTH_DEV_MODE=true` under any other `NODE_ENV` is a startup error.
2. Otherwise `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` → real Google.
3. Neither → startup error.

Rule 1 is an allowlist, not a `production` denylist: `staging`, an empty value, and an unset `NODE_ENV` are all refused. A deployment whose environment we cannot classify must not serve a consent screen that signs in whoever is typed into it, and empty values are ordinary in container manifests (`NODE_ENV=$UNSET_VAR`), where `??=` in `scripts/listen.node.ts` cannot restore the default.

The dev IdP is therefore **opt-in per machine and per launcher**: `.env.example` ships the flag commented out, and only `pnpm dev` (`vite dev`, which sets `NODE_ENV=development`) accepts it. Copying `.env.example` and running `pnpm dev` stops at rule 3 with the setup hint — **uncomment `OAUTH_DEV_MODE=true` in your own `apps/web/.env`** (never on a deployed host). The same line is what an `.env` from an earlier revision needs.

Running the production build against the dev IdP is deliberately awkward: it takes an explicit `NODE_ENV=development pnpm start` on the command line. Prefer `pnpm dev` for that.

The share-token encryption key ring is minted fresh at process start (ephemeral AES-256-GCM key). Existing share URLs therefore survive only as long as the process — consistent with the rest of the in-memory model.

## Worker runner (relay / consumer / scope tasks / pruner)

`apps/web/app/worker/node/runner.ts#createNodeWorkerRunner` is the same-process orchestrator for the roles that ship as separate Workers on Cloudflare.

| Role        | Cloudflare (Issue #11)      | Node                                                                                                              |
| ----------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Relay       | cron + Service Binding      | 60-second `setInterval` fallback + `InProcessRelayTrigger.kick()` from the request-path UoW (`setImmediate` fan)   |
| Consumer    | Queue subscriber            | `InMemoryQueueDispatcher` → `dispatchDomainEvent` (`packages/core/src/application/workers/subscribers.ts`): the registry routes an event to the subscribers registered for its type, and an event nobody subscribes to is acked with a warning |
| Scope tasks | Durable Object alarms       | 1-second `setInterval` + `ScopeTaskTrigger.kick()` from a scope-plane commit that stored a continuation, both draining `runDueScopeTasks` |
| Pruner      | crons (outbox + auth state) | 24-hour `setInterval` — plus one round at `start()` — running three mutually isolated sweeps: `pruneOutbox`, `pruneAccountDeletionManifests` (terminal deletion headers and their control-plane rows), and the 30-day `identity_removal_receipts` sweep. `pruneExpiredAuthState` is implemented and tested but **not scheduled** here — its cron / queue wiring is Issue #15 |
| DLQ         | Dedicated Worker            | `processOutboxEvents` already logs `[outbox] quarantining event …` when `failed_at` is stamped — no separate sweep |

A scope-task claim takes a lease, so a row the turn did not settle — a kind this deployment has no handler for, a row whose own `backoff` then failed — is invisible to the ticks until `SCOPE_TASK_LEASE_MS` lapses (five minutes by default), not until the next second. Both cases log as they happen, and `[scope-tasks] no handler for …` carries the row's `dueAt`: reclaiming a lapsed lease leaves `dueAt` where it was, so how far past its time that row has drifted reads off the line, while how often the line repeats only tracks the lease period. There is no surface here for the age of the oldest task across all rows — the SLO that would measure it belongs to the runtime where a crashed writer's rows outlive the writer (`spec/platform`, Issue #11).

`runner.start()` drives one round of the relay, the scope tasks and the pruner immediately (crash-leftover backlog, due continuations left by a previous process, and retention that must not wait a whole interval), registers the three intervals plus SIGTERM / SIGINT handlers, and returns synchronously; the timers `unref` so short-lived scripts and tests can exit naturally. Commits kick the relay and the scope-task runner out-of-band via `bindNodeRelayTrigger` / `bindNodeScopeTaskTrigger`, and concurrent kicks collapse into one in-flight tick.

There is exactly one runner per process. `apps/web/app/server.node.ts` pins the booted server on `globalThis` / `import.meta.hot.data`, so a `vite dev` reload — which re-evaluates the module and boots again — retires the previous boot (`[server.node] retiring the previous boot`) before starting the replacement (`[server.node] worker runner started`). Two "started" lines without a "retiring" line between them would mean two runners ticking the same store.

## Graceful shutdown

`apps/web/scripts/listen.node.ts` and `apps/web/app/server.node.ts` both register SIGTERM / SIGINT handlers:

1. `@hono/node-server` stops accepting new HTTP connections.
2. `runner.stop()` clears the intervals, deregisters its own signal listeners, stops the relay and scope-task triggers, and awaits in-flight ticks.
3. `process.exit(0)`. Data is gone at this point (see *Persistence model*).

The shutdown promise is memoised — calling `stop()` repeatedly is safe.

## Single-process operational constraints

The runtime is **single-process by construction**: state lives in the process heap. Running multiple instances gives each its own, unrelated store. There is nothing to scale horizontally here; the multi-tenant target is the Cloudflare runtime.

Request bodies are therefore capped at **12 MB** (`MAX_REQUEST_BODY_BYTES` in `apps/web/scripts/listen.node.ts`), enforced two different ways. A request that declares a `Content-Length` above the cap is answered `413` without a byte of its body being read. A `Transfer-Encoding: chunked` request declares nothing, so it is metered as it streams: the cut-off fires only while the body is being read, and the response is replaced with `413` once more than 12 MB has actually flowed. A chunked request whose body no handler reads is therefore not refused — the cap bounds what the process buffers, not what it accepts. Server functions materialise the whole body into `FormData` / `File` before their validator runs, and the request and worker planes share this process, so an oversized POST would otherwise buffer against the in-flight deletion continuations. The cap sits above the largest business limit (8 MB at the avatar upload boundary) on purpose — that one stays with the route. It applies to `pnpm start` only; `vite dev` does not go through this launcher.

## Logging and observability

The application uses the `ConsoleLogger` port (`packages/core/src/application/ports/logger.ts`) — every log line goes to stdout / stderr as JSON-ish objects. Notable lines:

- `mail.sent` — memory mail deliveries. Carries `actionUrl` (the verification link, raw token included) only when `MEMORY_MAIL_LOG_ACTION_URL=true`.
- `[outbox] quarantining event …` — the DLQ surface.
- `[outbox] pruned N processed event(s)` — one line per prune tick (boot, then daily).
- `[scope-tasks] no handler for …` — a continuation kind this deployment cannot resume. It repeats on the lease period (`SCOPE_TASK_LEASE_MS`), not every tick, so its frequency is no measure of the backlog; the `dueAt` it carries is, since that is when the row was meant to run.
- `[server.node] worker runner started` / `[server.node] retiring the previous boot` — the boot lifecycle described under *Worker runner*.

## Deployment conditions

**Behind a reverse proxy, replace the `clientKey` supplier.** `apps/web/app/presentation/clientKey.ts` returns the socket-derived request IP; `X-Forwarded-For` is deliberately not trusted because it is client-forgeable. Put a TLS terminator or load balancer in front of the process and every request then reports the proxy's address, so all clients collapse onto one `clientKey`. The login throttle is keyed `signIn:{email}:{clientKey}`, so it inverts from a defence into an attack: any visitor can fail ten sign-ins against a known e-mail and lock that account for 15 minutes, repeatably. A proxied deployment must supply the real client address there (a trusted-proxy hop setting is a follow-up issue; the Cloudflare slice replaces the module with `CF-Connecting-IP`).

## Known limitations

- **No durability.** Every restart starts blank. This is the intended shape of the walking skeleton, not an oversight.
- **No auth-state prune scheduling.** `pruneExpiredAuthState` runs only from tests; expired sessions / tokens are still rejected logically (absolute expiry + epoch checks), the physical rows just accumulate for the process lifetime. The one exception is `identity_removal_receipts`, which the prune tick sweeps directly because its 30-day window is a retention promise rather than bookkeeping; once Issue #15 gives `pruneExpiredAuthState` a driver, that table is swept by both and the runner's own sweep can go.
- **No built-in DLQ surface** beyond the quarantine log line.
