# Testing

Tests are classified along two axes: **layer × purpose**. One vitest run spans two projects, and which project a file belongs to is decided by its path:

| Project | Files | Runs in | Backend |
| --- | --- | --- | --- |
| `node` | everything outside `packages/core/src/adapters/cloudflare/` | Node, `TZ=Asia/Tokyo` | the in-memory reference adapters |
| `workers` | everything under `packages/core/src/adapters/cloudflare/` | workerd (`@cloudflare/vitest-plugin`) | real D1 / Durable Object / R2 bindings |

The boundary is one string in `vitest.shared.ts`, used by both configs: what `node` excludes is exactly what `workers` includes. The two sets are therefore disjoint *and* their union is every test file, so `pnpm test` runs each file exactly once and no path can fall through both. The `workers` project cannot set `TZ` at all — zone-sensitive tests stay in `node` (see Determinism).

## Test layer classification

### Unit (`pnpm test:unit`; `pnpm test` aliases it)

- **Targets**: domain-layer logic, application usecases wired through the in-memory adapters, and the port-conformance suites.
- **Dependencies**: the memory backend (`createMemoryRuntime` / `createTestHarness`) plus the two fakes under `packages/core/src/application/__tests__/fakes/`: `FakeIdGenerator` (a deterministic UUIDv7 stream) and `FakeLogger` (a recording Logger). Time is controlled through the shared `TestClock` (`adapters/conformance/testClock.ts`).
- **Aim**: invariants of the domain layer (value object / entity / events decoding), error-code branching, usecase orchestration over the real port contracts, and the port contracts themselves.
- **Speed**: a few to a dozen-or-so milliseconds per file.
- **Naming**: `**/__tests__/<target>.test.ts`. Usecase tests carry their spec TC ids (e.g. `TC-identity-213`) in the test name so coverage is mechanically traceable to `spec/testcases/`.

### Port conformance (`packages/core/src/adapters/conformance/`)

- **Targets**: every persistence-port contract — OCC, atomic counters (`recordFailure`), atomic take, reservation sagas, route sagas, lane/lease bookkeeping, keyset expiry sweeps.
- **Shape**: `describeXxxContract(name, makeBackend)` parameterized suites. The memory backend runs them from `adapters/memory/__tests__/` in the `node` project; the Cloudflare backend runs the *same* suites from `adapters/cloudflare/__tests__/conformance/` in the `workers` project, against real bindings. Neither backend gets its own copy — a case exists once, and both must pass it identically.
- **Aim**: the contract text of `spec/domains/*.md` as an executable form. This is what lets usecase tests trust the memory adapters.
- **No escape hatch**: `ConformanceBackend` declares no optional member, and no persistence suite opts a case out of its backend's run. `adapters/__tests__/conformanceCoverage.test.ts` enforces both, across every vitest API that removes a case from the run — `only` included, since a single `only` inside a shared suite drops every *other* suite the entry file pulled in. An optional harness member is the same hole in slower motion: a backend that skips implementing it turns the contract clauses that need it into silent skips, which is exactly the divergence "both must pass it identically" exists to catch. Seed and fault-injection hooks are therefore required members (`seedMembershipEdges`, `seedWorkspaceDirectory`, `makeWorkspaceDirectoryUnreadable`, `setMaintenanceTables`) — they exist only to give a contract branch an executable form. The one exemption is a suite no persistence backend calls, and it is derived from the call-site set rather than an allowlist; both backends' files are selected by one rule, because an asymmetric pair of filters makes the set comparison lie in both directions.
- **Freshness**: the suites contract for a fresh backend per test, while the workers pool isolates storage per *file*. The Cloudflare factory closes that gap itself by namespacing each backend it hands out (`__tests__/conformanceBackend.ts`), so nothing in the suites depends on which pool they run in.

### Backend-local (`adapters/{backend}/__tests__/`, outside the shared suites)

- **Targets**: what a shared suite must not assert because it is not backend-agnostic — the memory backend's run serialization, and on the Cloudflare side the write-set apply order, D1 batch atomicity, `transactionSync` rollback, Durable Object alarm re-entry, the due-index publish, and the DI composition root.
- **Rule**: a contract gap found here belongs in the shared suite instead. Only properties that are genuinely one backend's own stay local.

## Fake policy

Kept fakes are limited to `FakeIdGenerator` and `FakeLogger` (see above).

- Repository / UoW / store fakes are intentionally absent. What replaced them is **not** ad-hoc in-memory mocks but the `adapters/memory/` reference adapters: they are wired by production DI (`pnpm dev` runs on them) and are held to the same conformance suites any real backend must pass. The original prohibition — "an in-memory imitation of transactions / OCC is no substitute for verification" — still stands; the conformance suites are that verification.
- The same policy governs the `workers` project, and there it is stricter still: **no port a conformance suite exercises is stubbed**. The Cloudflare suites run against the D1, Durable Object and R2 bindings of `packages/core/wrangler.test.jsonc`, which is the reason for paying the pool's startup cost rather than reading the adapters against a mock. Backend-local tests may still pass a stand-in for a port that is out of their scope — one that throws when touched, so reaching it fails the test rather than passing silently — and the composition-root test supplies a `MailSender`, since the Cloudflare group has no adapter for that port.
- What the memory backend cannot prove (driver-specific behavior: SQL constraints, parameter limits, D1 batch atomicity, Durable Object transaction isolation) is proven by the `workers` project, using the same suites plus the backend-local tests above. Do not read a green memory run as a production guarantee of those properties — run `pnpm test`, which covers both.
- `Clock` is passed as the `TestClock` port through the harness; freestanding `new Date(0)` constants remain fine for pure domain tests.

## Writing usecase tests

- `createTestHarness()` (`packages/core/src/application/__tests__/helpers.ts`) builds request + worker containers over one fresh memory backend per test, with `clock` / `idGenerator` / `logger` swapped for the deterministic test doubles. `requestOverrides` / `workerOverrides` replace individual ports for fault injection (failing mail sender, lost activate responses, throwing sweeps).
- Concurrency tests fire the usecase twice with `Promise.all` and assert one winner (the UoW mutex + conditional updates make the outcome deterministic in-process).
- Seed unusual persisted states (deleted users, stale epochs, expired rows) by writing rows directly to `harness.backend` tables via the domain `reconstruct` factories.

## Injecting into a concurrency window

- Verifying what happens when another actor lands at a particular moment does not warrant a repository / UoW / store fake. Spread the container `createTestHarness()` returned and replace one port with a thin wrapper that delegates to the real adapter (or the real provider) and interferes once at a fixed position — before or after the wrapped call.
- Where the interference sits is the value of the test. Interfering right after the deciding UoW's `run` resolves fails an implementation that observes state in the wrong order; wrapping the write call that implementation eventually makes puts the interference after the observation, where the wrong order passes too.
- To reproduce an interrupted saga, fail exactly one wrapped call and let everything else run against the real adapter, instead of adding a branch to the implementation. Say in the test name which window is being opened.

## Determinism

- `vitest.config.ts` pins `TZ=Asia/Tokyo` for the **`node` project**. A UTC runner (which CI is) would make UTC-only assertions — `BillingPeriod`'s UTC calendar month — pass against a local-time implementation too, so those tests run in a non-UTC zone to keep them discriminating. Everything else must stay TZ-independent.
- The `workers` project cannot set `TZ`: workerd reports no `process.env.TZ` and a zero UTC offset. Do not move a zone-sensitive test (`domain/usage/__tests__/`) there — it would stop discriminating without failing.
- The Cloudflare conformance factory drives the same `TestClock` the memory backend uses, so a suite's time is controlled in both projects. Alarm-driven paths are the exception: workerd delivers an alarm on the real clock, which is why the backend-local alarm tests arm it explicitly instead of relying on a scheduled row.

## Timeout / flakiness

- `testTimeout` is raised to 10s in the `node` project for the scrypt(N=16384) password cases — the slowest tests in the suite (~300ms against single-digit ms elsewhere), which have overrun the 5s default under parallel load. The `workers` project uses 30s across the board — every read is an RPC into workerd and the pool starts an isolate per file. Everything else uses Vitest's defaults and runs with a controlled clock, so flakiness should be treated as a bug, not retried around.

## Commands

| Purpose | Command |
| --- | --- |
| All (both projects) | `pnpm test` (alias of `test:unit`) |
| Node project only | `pnpm test:node` (= `vitest run --project node`) |
| Cloudflare project only | `pnpm test:workers` (= `vitest run --project workers`) |
| One area | `pnpm exec vitest run packages/core/src/application/identity` |
| One Cloudflare file | `pnpm exec vitest run --project workers packages/core/src/adapters/cloudflare/__tests__/conformance/identity.test.ts` |

`--project` is what a path alone cannot decide: a bare `vitest run <path>` filters files inside *both* projects, so naming the project is how a Cloudflare file gets the workerd pool and its bindings. Use `--project node` to check that a change left the reference runtime alone.

## Coverage

Coverage numbers are not enforced. Rules of thumb:

- **Domain**: aim for ~100%. Logic is local and easy to fully cover, and a missing test translates directly into a broken invariant.
- **Application**: per spec TC row — the implemented rows of `spec/testcases/` are the checklist, named in the tests.
- **Adapters**: per conformance-suite case; add a case to the shared suite (not a backend-local test) when a contract gap is found. The rule binds every backend — a case added for the Cloudflare adapters must also pass on the memory backend, and if it cannot, the divergence is resolved by deciding where the behaviour's canon lives ([ADR 046](../spec/adr/046-port-contract-divergence.md)) before either side is changed.
- **Frontend**: the bare minimum. The server function's wire-type boundary and UI logic are broadly covered by the framework primitives. The exception is the pure functions of `apps/web/app/presentation/` (status mapping, redaction, the open-redirect guard, and the error-message dictionary of `errorDisplay` together with the `extractSerializedError` paths that feed it): no framework is involved and they encode closed spec lists, so they carry unit tests under `apps/web/app/presentation/__tests__/`. A pure function lifted out of an island — a fold over list state, a transport schema — carries its tests in a `__tests__/` directory next to the component instead, since the component is what defines it. A route that owns `server.handlers` (`routes/storage.$.tsx`) has its delivery rules exercised in `apps/web/app/routes/__tests__/`, calling the handler over the memory backend. A test that watches a repository-wide convention by scanning sources (`serverFunctionRegistration`, the ADR-number resolution of `adrReference`) belongs to no layer and lives in `apps/web/app/__tests__/`.

## Convention scans

Some conventions bind code that no type and no lint rule can reach. They are held by tests that parse the sources and compute the forbidden set, and they live where the convention binds: repository-wide scans in `apps/web/app/__tests__/`, a scan over one file next to that file.

Three of them run today.

- `apps/web/app/__tests__/serverFunctionRegistration.test.ts` — every server function a `"use client"` island reaches has its provider module imported from `routes/__root.tsx`, so it lands in the RSC manifest. The requirement is derived from the island / `action.ts` pairs found in the sources, not listed.
- `apps/web/app/__tests__/adrReference.test.ts` — two scans over different roots. Number resolution reads `apps/web/app/` and `packages/core/src/`: every `ADR <number>` cited there resolves to a file under `spec/adr/`. The work-log prohibition reads those two roots plus `spec/` and `docs/`: none of the four cites the work-log directory.
- `apps/web/app/components/note/NoteEditor/__tests__/liveReads.test.ts` — no function in the note editor island that crosses a roundtrip reads a value the render captured. It walks `editor.tsx` with the TypeScript AST and computes both sides. The captured values are the island's parameters and every binding directly under it, minus the ones initialized with a function literal and minus a closed table of hooks whose result keeps its identity across renders (`useRef` / `useRouter` / `useId` / `useServerFn`); a hook outside that table counts as captured. The crossing functions are those owning an `await` plus the closure of local functions named in value position, so a callback handed to `setTimeout` or `then` is included. A name is a read unless it sits in callee position, a type, a property name, or a scope that rebinds it — the function's own parameters included. Injected fixtures fix both directions: nine shapes that must be reported, and a parameter sharing a name with a captured value that must not be.

Write the forbidden set as a computation over the sources, never as a list of identifiers. A list only covers the names someone remembered to add, so the case that slips past it is exactly the case the convention exists to catch — and adding a state or a function silently widens the gap. State the domain the computation ranges over, then say it plainly: inside that domain, adding a state, a function or a prop lands in the check with no edit to the test.
