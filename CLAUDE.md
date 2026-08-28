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

Design and inventories live there, not here. This file holds principles and pointers only — anything a single feature could falsify belongs in `spec/` or `docs/`.

`.thread/{number}/` holds the work log of one issue and is not canon. Never cite it from code, `spec/`, or `docs/`: its ADR numbering collides with `spec/adr/`, and the link dies when the issue closes. Write the reason itself where it applies, and promote it to `spec/` only when it outlives the change.

## Workspace layout

pnpm monorepo. `pnpm-workspace.yaml` declares exactly two package globs — `apps/*` and `packages/*`. One lockfile at the root; packages resolve each other via package `exports` pointing straight at `.ts` sources (no build step for internal packages). `@repo/core` exposes a single flat rule — `"./*": "./src/*.ts"` — so every subpath maps 1:1 to a file and there is no barrel to import from.

- `packages/core` (`@repo/core`) — domain / application / adapters, plus the shared `lib/` primitives and `config.ts`. Framework-free; imported everywhere as `@repo/core/*`.
- `apps/web` (`@repo/web`) — the TanStack Start app: routes, components, the presentation layer, the server entry and worker runner, `scripts/`, and the build config.
- Root — shared tooling only: Biome, the vitest config, delegating scripts. `@types/*` are publicly hoisted (see `pnpm-workspace.yaml`) so `.d.ts` files inside the pnpm store can resolve `react` / `vitest` types.

A future app (MCP server, CLI, …) is a new `apps/*` package that declares `"@repo/core": "workspace:*"` and owns its DI wiring or reuses one from `packages/core/src/application/di/`. A composition root is expressed as `AppRuntime` (`application/di/runtime.ts`), so a new one is type-checked against the same four methods rather than drifting into its own shape. No tsconfig `paths` mirror is needed.

## Development Commands

Run from the repo root — root scripts delegate to `@repo/web` where relevant:

- `pnpm dev` / `pnpm build` / `pnpm start` — aliases of `pnpm dev:node` / `pnpm build:node` / `pnpm start:node`, which are also callable directly
- `pnpm lint` / `pnpm lint:fix` / `pnpm format` / `pnpm format:check` (Biome, whole repo)
- `pnpm typecheck` (root `tsgo` for the vitest config + `pnpm -r typecheck` across packages)
- `pnpm test` / `pnpm test:unit` (every vitest project at the root; `test` aliases `test:unit`) — `pnpm test:node` / `pnpm test:workers` run one project each, since the two use different pools
- Web-only scripts not delegated at the root: `pnpm --filter @repo/web <script>` (or run inside `apps/web`)

The reference runtime persists in memory, so there is no database to provision and nothing to migrate before `pnpm dev`. Copy `apps/web/.env.example` to `apps/web/.env` first — that file documents every variable, including which sign-in identity provider to configure.

After changes: `pnpm typecheck && pnpm lint:fix && pnpm format`.

## Architecture

Hexagonal architecture with DDD. Dependencies point inward: presentation → application → domain, with adapters implementing ports defined inward of them.

### Layers

- **Domain** (`packages/core/src/domain/`) — Pure business logic: entities, value objects, domain services, port interfaces, domain events. No I/O, no framework, no ambient time / id generation. Throws `BusinessRuleError` (`domain/error.ts`) for invariant violations. One folder per domain, plus `common/` for the primitives the rest share; the decomposition itself is canon in `spec/domains/index.md`.
- **Application** (`packages/core/src/application/`) — Use cases that orchestrate the domain, with DTO projection in each `view.ts`. Alongside them: the ports for cross-cutting concerns and persistence, the two-plane unit of work, scope keys, the background workers, the DI wiring, and application-level errors.
- **Adapters** (`packages/core/src/adapters/`) — Concrete implementations of ports per provider. `memory/` is the reference persistence backend (a real backend, not a fake — [ADR 024](spec/adr/024-in-memory-adapter-as-first-class-backend.md)); `conformance/` holds the shared port-conformance suites. Adapters translate driver-specific errors into the shared error contracts.
- **Presentation** (`apps/web/app/presentation/`) — Framework-specific cross-cutting utilities for TanStack Start: the DI entry for server-side code, the redaction + HTTP-status boundary for server functions and for RSC fragments that reject mid-stream, transport-boundary input validation, session-cookie transport, and error display helpers. The full `SerializedError` union is assembled here from each layer's variants.

Creating a `createStart` instance drops the framework's CSRF middleware; `apps/web/app/start.ts` re-registers it.

### Not a layer

- `packages/core/src/lib/error.ts` — Shared structural primitives (the `CodedError` base, structural pieces of the serialized-error contract) that every layer may extend. Living outside the layered tree is what lets all four layers depend on it without violating the inward-only direction.
- `packages/core/src/config.ts` — Static site content folded into the app config at DI time. Same reasoning: no layer owns it.

### Frontend

TanStack Start with React 19 / RSC, TanStack Router (file-based routes), Tailwind v4. Components live under `apps/web/app/components/`, routes under `apps/web/app/routes/`. Default to async server components for data fetching and usecase invocation; use server functions for mutations and loader bridges; drive client mutations through React 19 primitives directly rather than custom wrappers. Server functions are declared inline where they are used — route-adjacent `-action.tsx` or component-adjacent `action.ts` — because the compiler rewrites the `createServerFn(...)` chain at its call site.

Mutations are a three-layer concern: server component fetches → `"use client"` island for interaction → React 19 primitives (`useActionState` / `useTransition` / `useOptimistic`) for instant feedback. The third layer is mandatory — a server function wired straight to a `<form>` with no optimistic/pending UI is the default failure mode that yields a sluggish, round-trip-only app.

Ownership follows the kind of change. In-item mutations stay in the leaf, which owns its server function, its item-local `useOptimistic`, and its error UI. List-membership changes are parent state, so an item-local `useOptimistic` cannot reach them — move list ownership to a client island seeded by the server component and have the owner run the server function. Delete in particular must run in the owner, since the optimistic removal unmounts the leaf before the request settles. Every mutation reconciles with `router.invalidate()`.

Loading fallbacks come in two kinds, by scope. Per-fragment skeletons under `<Suspense>` cover a fragment streaming in; route-level pending (`defaultPendingComponent` + `defaultPendingMs` / `defaultPendingMinMs`) covers a loader that blocks. They are serial legs of one navigation, not alternatives — and neither replaces the optimistic primitives above, which cover post-mount mutations.

## Key concepts

Each of these is enforced in code and documented in library-level JSDoc at the relevant module — read there for the details.

- **Unit of Work** — two planes, kept apart by type ([ADR 023](spec/adr/023-two-plane-unit-of-work.md)): one for the global control plane and public projections, one for a single scope's business data. Each context exposes only the repositories that plane's callback may touch and the only path to enqueue domain events. **Nesting `run` is forbidden** in either direction. Writes the design deliberately places outside a UoW go through their own atomic store ports instead.
- **Outbox / domain events** — events collected during a UoW are persisted transactionally and dispatched out-of-band by the relay worker. Delivery is at-least-once with no ordering guarantee; consumers must be idempotent. The relay worker claims rows under a lease so multiple workers cannot dispatch the same row, and a crashed worker's claim is reclaimable once the lease lapses. A row that exceeds `maxAttempts` is quarantined so a poison event stops retrying. The same outbox also carries the continuation requests that drive multi-turn work ([ADR 040](spec/adr/040-continuation-transport.md) / [ADR 041](spec/adr/041-deterministic-continuation-event-id.md)).
- **Retry strategy** — driver-level transient errors are retried inside the adapter; application code never sees them. There is intentionally no application-level OCC retry decorator. A usecase retries a call itself only where losing the response would strand a saga.
- **Port contracts and conformance** — the canon of a persistence-port contract is the port definition and its JSDoc; `packages/core/src/adapters/conformance/` is that contract's executable form ([ADR 026](spec/adr/026-port-contract-and-conformance.md)). Every backend imports the same suites and must pass them identically. Adding a contractual behaviour means touching both the port JSDoc and the suite.
- **Input validation** — validated at exactly two points: the transport boundary (shape / DoS) and value-object construction (business invariants). Usecases trust the static type in between. On the frontend the transport boundary is the route's `validateSearch` (URL params) or a server function's `.validator(validateInput(schema))` (client-posted payloads). `serverData` is **internal-only** and intentionally schemaless — never feed unvalidated external input through it.

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

Entry points: `apps/web/app/server.node.ts` (fetch handler + boot), `apps/web/app/worker/node/runner.ts` (single-process orchestrator of the background roles), `apps/web/scripts/listen.node.ts` (production launcher), `packages/core/src/application/di/` (the adapter graph, the environment validation, and the request / worker containers), `apps/web/vite.config.node.ts` (the only build config). Operational guidance lives in `docs/runtime_node.md`.

The final execution platform is Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues (`spec/platform/index.md`, [ADR 021](spec/adr/021-scope-sharded-data-plane.md)). Reaching it means adding an adapter group under `packages/core/src/adapters/{provider}/` plus a paired entry point and DI wiring — the inward layers stay put, and the new backend is held to the same conformance suites the memory backend passes today.

## Examples

具体的な実装パターンは `docs/backend_implementation_example.md` / `docs/frontend_implementation_example.md` を参照。テストの層と命名は `docs/test.md` を参照。
