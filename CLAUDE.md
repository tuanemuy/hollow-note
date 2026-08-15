# Repository guidelines

Guidance for coding agents working in this repository.

## Principles

- Prioritize type safety; lean on TypeScript's type system fully.
- Prefer stateless, pure functional code in domain / application layers. Adapter classes are fine when they encapsulate a single external resource and keep mutable state internal.
- Make illegal states unrepresentable at the type level before falling back to runtime checks.
- Default to no comments. Add one only when the WHY is non-obvious — a hidden constraint, an invariant, a workaround. Library-level JSDoc on exported APIs is welcome.
- Validate at the boundaries (transport in, value-object construction); trust the static type in between.
- Keep cross-cutting concerns (clock, id generation, logging) behind ports so domain and application code stays deterministic and testable.

## Design canon

`spec/` is the canon for the requirements and design currently in force. Read it before changing behaviour, and revise it when a decision changes — it holds no progress logs or superseded judgements, so what is written there is meant to be true of the code.

- `spec/index.md` — the entry point: scenarios, pages, design tokens, domains, usecases, DB / platform / presentation design, test cases, manual tests.
- `spec/adr/index.md` — the index of non-obvious design decisions still in force, plus the premise-dependency map between them. Anything surprising in the code usually has an ADR behind it.

`docs/` holds the implementation-side companions: `docs/backend_implementation_example.md` and `docs/frontend_implementation_example.md` (worked patterns), `docs/runtime_node.md` (operating the runtime), `docs/test.md` (test layering, naming, and the fake policy).

## Workspace layout

pnpm monorepo. `pnpm-workspace.yaml` declares exactly two package globs — `apps/*` and `packages/*`. One lockfile at the root; packages resolve each other via package `exports` pointing straight at `.ts` sources (no build step for internal packages). `@repo/core` exposes a single flat rule — `"./*": "./src/*.ts"` — so every subpath maps 1:1 to a file and there is no barrel to import from.

- `packages/core` (`@repo/core`) — domain / application / adapters, plus the shared `lib/` primitives and `config.ts`. Framework-free; imported everywhere as `@repo/core/*`.
- `apps/web` (`@repo/web`) — the TanStack Start app: routes, components, the presentation layer, the server entry and worker runner, `scripts/`, and the build config (`vite.config.node.ts`).
- Root — shared tooling only: Biome, the vitest config, delegating scripts. `@types/*` are publicly hoisted (see `pnpm-workspace.yaml`) so `.d.ts` files inside the pnpm store can resolve `react` / `vitest` types.

A future app (MCP server, CLI, …) is a new `apps/*` package that declares `"@repo/core": "workspace:*"` and owns its DI wiring or reuses one from `packages/core/src/application/di/`. No tsconfig `paths` mirror is needed.

## Development Commands

Run from the repo root — root scripts delegate to `@repo/web` where relevant:

- `pnpm dev` / `pnpm build` / `pnpm start` — aliases of `pnpm dev:node` / `pnpm build:node` / `pnpm start:node`, which are also callable directly
- `pnpm lint` / `pnpm lint:fix` / `pnpm format` / `pnpm format:check` (Biome, whole repo)
- `pnpm typecheck` (root `tsgo` for the vitest config + `pnpm -r typecheck` across packages)
- `pnpm test` / `pnpm test:unit` (one vitest run at the root, spanning `apps/web` and `packages/core`; `test` aliases `test:unit`)
- Web-only scripts not delegated at the root: `pnpm --filter @repo/web <script>` (or run inside `apps/web`)

Persistence is in-memory, so there is no database to provision and no migration script. Copy `apps/web/.env.example` to `apps/web/.env` before the first `pnpm dev` — that file documents every variable, including which sign-in identity provider to configure.

After changes: `pnpm typecheck && pnpm lint:fix && pnpm format`.

## Architecture

Hexagonal architecture with DDD. Dependencies point inward: presentation → application → domain, with adapters implementing ports defined inward of them.

### Layers

- **Domain** (`packages/core/src/domain/`) — Pure business logic: entities, value objects, domain services, port interfaces, domain events. No I/O, no framework, no ambient time / id generation. Throws `BusinessRuleError` (`domain/error.ts`) for invariant violations. Eight folders: `common` (events / pagination / time / version primitives shared by the rest), `conversion`, `identity`, `job`, `note`, `storage`, `usage`, `workspace`.
- **Application** (`packages/core/src/application/`) — Use cases that orchestrate the domain, one folder per domain (`identity/`, `note/`, `storage/`, `usage/`) with DTO projection in each `view.ts`. Alongside them: `ports/` (clock, id generation, logging, and the persistence / infrastructure ports), `execution/` (the two-plane unit of work and deterministic event ids), `scope.ts` (scope keys), `workers/` (relay, outbox prune, scope-task runner, subscriber wiring), `cleanup/` (account-deletion participants), `events/`, `di/` (container wiring), and `errors.ts`.
- **Adapters** (`packages/core/src/adapters/`) — Concrete implementations of ports per provider. `memory/` is the reference persistence backend (a real backend, not a fake — [ADR 024](spec/adr/024-in-memory-adapter-as-first-class-backend.md)); `node/` holds the in-process queue dispatcher and relay trigger; `oauth/` holds the Google client and the loopback dev identity provider; `conformance/` holds the shared port-conformance suites. Adapters translate driver-specific errors into the shared error contracts.
- **Presentation** (`apps/web/app/presentation/`) — Framework-specific cross-cutting utilities for TanStack Start. The load-bearing files are `serverAction.ts` (`loadServerDeps` / `serverData` — the DI entry for server-side code), `errorResponseMiddleware.ts` (the redaction + HTTP-status boundary for server functions), `serverFragment.tsx` (the same boundary for RSC fragments that reject mid-stream), `validator.ts` (`validateInput`, the transport-boundary schema check), and `session.ts` (session-cookie transport). The full `SerializedError` union is assembled here from each layer's variants. `apps/web/app/start.ts` re-registers the framework's CSRF middleware, which creating a `createStart` instance would otherwise drop.

### Not a layer

- `packages/core/src/lib/error.ts` — Shared structural primitives (the `CodedError` base, structural pieces of the serialized-error contract) that every layer may extend. Living outside the layered tree is what lets all four layers depend on it without violating the inward-only direction.
- `packages/core/src/config.ts` — Static site content (name, default title / description, theme colour) folded into the app config at DI time. Same reasoning: no layer owns it.

### Frontend

TanStack Start with React 19 / RSC, TanStack Router (file-based routes), Tailwind v4. Components live under `apps/web/app/components/`, routes under `apps/web/app/routes/`. Default to async server components for data fetching and usecase invocation; use server functions for mutations and loader bridges; drive client mutations through React 19 primitives directly rather than custom wrappers. Server functions are declared inline where they are used — route-adjacent `-action.tsx` (e.g. `apps/web/app/routes/settings/-action.tsx`) or component-adjacent `action.ts` — because the compiler rewrites the `createServerFn(...)` chain at its call site.

Mutations are a three-layer concern: server component fetches → `"use client"` island for interaction → React 19 primitives (`useActionState` / `useTransition` / `useOptimistic`) for instant feedback. The third layer is mandatory — a server function wired straight to a `<form>` with no optimistic/pending UI is the default failure mode that yields a sluggish, round-trip-only app.

Ownership follows the kind of change. **In-item mutations** (a field toggle, an inline rename) don't change list membership and the leaf survives them, so the leaf owns its server function, its item-local `useOptimistic`, and its error UI — `apps/web/app/components/settings/ProfileForm/editor.tsx` is the reference (the avatar swap shows the picked image optimistically while the two-step store-then-update runs). **List-membership changes** (add/remove) can't use an item-local `useOptimistic` — they're a parent-state change — so move list ownership to a client island seeded by the server component and have the owner run the server function for them; `apps/web/app/components/settings/IdentityList/board.tsx` is the reference. Delete in particular must run in the owner: the optimistic removal unmounts the leaf before the request settles, so a leaf-owned delete would discard its own error UI. Every mutation reconciles with `router.invalidate()`; the optimistic list re-bases onto the refetched data. When the mutation navigates away instead of changing a list in place (`apps/web/app/components/note/CreateNoteButton/`), the pending state of `useTransition` is the third layer and no optimistic insert is needed.

Loading fallbacks come in two kinds, by scope. **Per-fragment streaming** is for content tied 1:1 to a URL (lists, details): a `GET` server function returns the `renderServerFragment(...)` promise **unresolved**, and the loader forwards it without awaiting the fragment, so navigation settles instantly and the fragment streams in under `<Suspense fallback={<Skeleton/>}>` (resolved client-side by `Deferred`/`use()`). `apps/web/app/routes/notes/index.tsx` with `apps/web/app/routes/notes/-action.tsx` is the reference; skeletons live under `apps/web/app/components/ui/Skeleton` (generic) and next to each fragment (`components/note/NoteListSkeleton`, `components/settings/IdentityListSkeleton`, …), shaped to the real DOM so they swap in without layout shift. **Route-level pending** (`router.tsx`'s `defaultPendingComponent` + `defaultPendingMs`/`defaultPendingMinMs`) is the navigation fallback for any route whose loader genuinely *blocks*; a route that streams settles its loader immediately and never triggers it. Keep the two roles distinct: skeletons cover the initial/streaming load, the optimistic primitives above cover post-mount mutations.

## Key concepts

Each of these is enforced in code and documented in library-level JSDoc at the relevant module — read there for the details.

- **Unit of Work** — two planes, kept apart by type ([ADR 023](spec/adr/023-two-plane-unit-of-work.md)): `GlobalUnitOfWorkProvider.run(fn)` for the global control plane and public projections, `ScopeUnitOfWorkProvider.run(scope, fn)` for one scope's business data. Each context exposes only the repositories that plane's callback may touch and the only path to enqueue domain events. **Nesting `run` is forbidden** in either direction. Writes the design deliberately places outside a UoW (the uniqueness reservation saga, the note route saga, the login-attempt counter, best-effort expiry sweeps) go through their own atomic store ports instead.
- **Outbox / domain events** — events collected during a UoW are persisted transactionally and dispatched out-of-band by the relay worker. Delivery is at-least-once with no ordering guarantee; consumers must be idempotent. The relay worker claims rows under a lease so multiple workers cannot dispatch the same row, and a crashed worker's claim is reclaimable once the lease lapses. A row that exceeds `maxAttempts` is quarantined (`failed_at` stamped) so a poison event stops retrying. The same outbox also carries the continuation requests that drive multi-turn work ([ADR 040](spec/adr/040-continuation-transport.md) / [ADR 041](spec/adr/041-deterministic-continuation-event-id.md)).
- **Retry strategy** — driver-level transient errors are retried inside the adapter; application code never sees them. There is intentionally no application-level OCC retry decorator. A usecase may still retry one specific call when losing the response would strand a saga — `application/note/createBlankNote.ts` retries `activateCreate` once, converging on the same operation id.
- **Port contracts and conformance** — the canon of a persistence-port contract is the port definition and its JSDoc; `packages/core/src/adapters/conformance/` is that contract's executable form, written as `describeXxxContract(name, makeBackend)` suites ([ADR 026](spec/adr/026-port-contract-and-conformance.md)). The memory backend runs them from `adapters/memory/__tests__/`; any future backend imports the same suites and must pass them identically. Adding a contractual behaviour means touching both the port JSDoc and the suite.
- **Input validation** — validated at exactly two points: the transport boundary (shape / DoS) and value-object construction (business invariants). Usecases trust the static type in between. On the frontend the transport boundary is the route's `validateSearch` (URL params) or a server function's `.validator(validateInput(schema))` (client-posted payloads), declared inline on the `createServerFn(...).middleware([errorResponseMiddleware]).validator(...)` chain. `serverData` (from `presentation/serverAction.ts`) is **internal-only** and intentionally schemaless — never feed unvalidated external input through it.

## Error handling

- Errors are class hierarchies that each carry their own `kind`-tagged serialized form (`toSerialized()`). The presentation layer serializes structurally — no `instanceof` enumeration of concrete classes.
- HTTP status mapping is presentation-only, driven by the serialized `kind`. Errors themselves do not carry transport concerns.
- Avoid broad `try / catch` in ordinary application logic. Use it only at explicit boundaries (server-function serialization, per-row tolerance in workers).

### Cross-layer catch policy

- **adapter → application**: adapters catch driver-specific errors and translate them into the shared error contracts. Application code never sees provider-native errors.
- **domain → application**: domain errors flow through usecases unchanged. Do not re-translate at the usecase boundary — invariant violations and transport-shape violations are intentionally distinct kinds.
- **application → presentation**: the server-function boundary catches and serializes any thrown error structurally via its `kind`-tagged form. Usecases themselves do not serialize.
- **worker → root**: workers wrap per-row processing in `try / catch` for partial-failure tolerance. This is the only place a broad `catch` is expected in application-layer code.

## Reference runtime

There is exactly one runtime wiring: **Node.js + the in-memory adapters** ([ADR 025](spec/adr/025-single-reference-runtime.md)). No database, no container, no cloud account — the HTTP server and the whole outbox lifecycle (relay, scope tasks, prune) run in a single process, and all data resets on restart.

- `apps/web/app/server.node.ts` — fetch handler plus the `boot()` that builds the runtime.
- `apps/web/app/worker/node/runner.ts` — single-process orchestrator of the background roles (relay tick, scope-task tick, prune tick) and the in-process triggers that kick them out of band.
- `apps/web/scripts/listen.node.ts` — production launcher: loads the built bundle, serves `dist/client` static files, registers the fetch handler with `@hono/node-server`, and owns the shutdown sequence.
- `packages/core/src/application/di/memoryRuntime.ts` — assembles the adapter graph; `di/serverNode.ts` reads and validates the environment and builds the request / worker containers; `di/containerStore.ts` is what presentation code calls.
- `apps/web/vite.config.node.ts` — the only build config.

Operational guidance lives in `docs/runtime_node.md`.

The final execution platform is Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues (`spec/platform/index.md`, [ADR 021](spec/adr/021-scope-sharded-data-plane.md)). Reaching it means adding an adapter group under `packages/core/src/adapters/{provider}/` plus a paired entry point and DI wiring — the inward layers stay put, and the new backend is held to the same conformance suites the memory backend passes today.

## Examples

具体的な実装パターンは `docs/backend_implementation_example.md` / `docs/frontend_implementation_example.md` を参照。テストの層と命名は `docs/test.md` を参照。
