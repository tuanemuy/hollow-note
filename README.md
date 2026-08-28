# tanstack-start-template

A reference template for building applications with **TanStack Start + React 19 (RSC)** on a **DDD / Hexagonal architecture** foundation.

The goal is to give you a worked example of:

- file-based routing and server components as the default data-fetching path,
- a strict inward dependency flow (`domain → application → adapters → presentation`),
- side effects pushed to the boundary via port / adapter separation,
- structured, layer-tagged error serialization across the stack.

## Features

- **TanStack Start + React 19 / RSC** — File-based routing (TanStack Router), server components as the default for data fetching, mutations driven through server functions.
- **Interactive by default** — Server functions are only the transport; `useActionState` / `useTransition` / `useOptimistic` sit on top for instant feedback. `/notes` and `/settings/auth` are the worked examples (streamed fragments with skeletons, optimistic list add/remove, optimistic avatar swap). Skipping this layer is what produces a round-trip-only, sluggish UI.
- **Hexagonal architecture + DDD** — Enforces a one-way dependency flow `domain → application → adapters → presentation`. Side effects are confined to the boundary via port / adapter separation.
- **In-memory reference adapters** — `packages/core/src/adapters/memory/` is a regular backend, not a test fake: it backs `pnpm dev` and is held to the shared port-conformance suites (`adapters/conformance/`) that any future backend must pass identically.
- **Outbox pattern** — Domain events are persisted in the same transaction as aggregate writes, then a relay publishes them to consumers. At-least-once delivery, no ordering guarantees, idempotency is the subscriber's responsibility.
- **TypeScript / Biome / Vitest** — Type checking with `tsgo`, lint and format via Biome, and one Vitest run split into two projects: `node` for domain, usecases, and port conformance over the in-memory adapters, `workers` for the Cloudflare adapters against real bindings inside workerd.
- **Structured error serialization** — Each layer carries its own `kind`-tagged serialized form; presentation composes the union structurally. HTTP status mapping lives only in presentation.

## Directory layout

```
packages/
└─ core/              # @repo/core — framework-free, imported as @repo/core/*
   └─ src/
      ├─ domain/      # entities, value objects, port interfaces, domain events
      ├─ application/ # use cases, UoW, cross-cutting ports (clock / id / logger), DTO projection, DI
      ├─ adapters/    # memory (reference backend), cloudflare (D1 / DO / R2), node, oauth, conformance (shared port suites)
      └─ lib/         # structural primitives shared by every layer (e.g. CodedError)
apps/
└─ web/               # @repo/web — the TanStack Start app + its build config
   ├─ app/
   │  ├─ presentation/ # server-function DI entry, error responses, input validation, session
   │  ├─ routes/       # TanStack Router (file-based)
   │  ├─ components/
   │  ├─ styles/
   │  ├─ worker/       # background-worker runner (relay / scope tasks / prune)
   │  └─ server.node.ts # server fetch entry
   └─ scripts/         # production launcher
docs/                 # implementation pattern examples, runtime guide, test policy
spec/                 # the canon for the requirements and design in force (see spec/index.md)
```

The workspace has exactly two package globs, `apps/*` and `packages/*`.

For the deeper rationale, see [`CLAUDE.md`](CLAUDE.md), [`docs/backend_implementation_example.md`](docs/backend_implementation_example.md), and [`docs/frontend_implementation_example.md`](docs/frontend_implementation_example.md).

## Reference runtime

There is **one** runtime wiring — **Node.js + the in-memory adapters** ([ADR 025](spec/adr/025-single-reference-runtime.md)). No database, no Docker, no cloud account: the HTTP server and the full outbox lifecycle (relay, scope tasks, prune) run in a single process, and all data resets on restart. This is what `pnpm dev` / `pnpm build` / `pnpm start` run.

The final execution platform is Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues ([`spec/platform/index.md`](spec/platform/index.md)). Its adapter group (`packages/core/src/adapters/cloudflare/`) and DI wiring are in place and pass the same port-conformance suites the memory backend passes; what remains is the paired entry point and the deployment configuration. The inward layers stay put either way.

Operational guidance: [`docs/runtime_node.md`](docs/runtime_node.md). Test layering and fake policy: [`docs/test.md`](docs/test.md).

## Requirements

- Node.js (the `flake.nix` / `.envrc` direnv environment is recommended)
- pnpm

## Quick Start

```bash
pnpm install
cp apps/web/.env.example apps/web/.env   # set APP_URL and pick a sign-in identity provider
pnpm dev                                 # vite dev server on http://localhost:3000
```

`apps/web/.env.example` documents every variable. Exactly one identity provider must be configured — the loopback dev consent screen (`OAUTH_DEV_MODE=true`, development only) or real Google credentials — or boot refuses to start.

For a production build:

```bash
pnpm build
pnpm start
```

## Development commands

```bash
pnpm dev                         # alias of pnpm dev:node
pnpm dev:node                    # vite dev (Node)

pnpm build                       # alias of pnpm build:node
pnpm build:node

pnpm start                       # alias of pnpm start:node
pnpm start:node                  # node HTTP listener (apps/web/scripts/listen.node.ts)

pnpm typecheck                   # tsgo (@typescript/native-preview)
pnpm lint                        # Biome lint
pnpm lint:fix                    # Biome check --write
pnpm format                      # Biome format --write
pnpm format:check

pnpm test                        # alias of pnpm test:unit
pnpm test:unit                   # Vitest, both projects (node + workers)
pnpm test:node                   # node project only (unit + the shared port-conformance suites)
pnpm test:workers                # workers project only (Cloudflare adapters inside workerd)
```

Recommended routine after changes:

```bash
pnpm typecheck && pnpm lint:fix && pnpm format
```

Persistence is in-memory, so there is no schema to generate and no migration command.

## License

Undecided (private).
