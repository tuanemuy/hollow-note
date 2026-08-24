# Testing

Tests are classified along two axes: **layer × purpose**. The whole suite currently runs at unit speed against the in-memory reference adapters (`packages/core/src/adapters/memory/`) — a regular adapter backend, not a test fake. The shared port-conformance suites double as the "integration" layer until a real backend (D1 / Durable Objects, Issue #11) arrives and imports the same suites under its own integration config.

## Test layer classification

### Unit (`pnpm test:unit` — currently the whole suite; `pnpm test` aliases it)

- **Targets**: domain-layer logic, application usecases wired through the in-memory adapters, and the port-conformance suites.
- **Dependencies**: the memory backend (`createMemoryRuntime` / `createTestHarness`) plus the two fakes under `packages/core/src/application/__tests__/fakes/`: `FakeIdGenerator` (a deterministic UUIDv7 stream) and `FakeLogger` (a recording Logger). Time is controlled through the shared `TestClock` (`adapters/conformance/testClock.ts`).
- **Aim**: invariants of the domain layer (value object / entity / events decoding), error-code branching, usecase orchestration over the real port contracts, and the port contracts themselves.
- **Speed**: a few to a dozen-or-so milliseconds per file.
- **Naming**: `**/__tests__/<target>.test.ts`. Usecase tests carry their spec TC ids (e.g. `TC-identity-213`) in the test name so coverage is mechanically traceable to `spec/testcases/`.

### Port conformance (`packages/core/src/adapters/conformance/`)

- **Targets**: every persistence-port contract — OCC, atomic counters (`recordFailure`), atomic take, reservation sagas, route sagas, lane/lease bookkeeping, keyset expiry sweeps.
- **Shape**: `describeXxxContract(name, makeBackend)` parameterized suites. The memory backend runs them from `adapters/memory/__tests__/`; a future D1/DO backend imports the same suites and must pass identically.
- **Aim**: the contract text of `spec/domains/*.md` as an executable form. This is what lets usecase tests trust the memory adapters.

## Fake policy

Kept fakes are limited to `FakeIdGenerator` and `FakeLogger` (see above).

- Repository / UoW / store fakes are intentionally absent. What replaced them is **not** ad-hoc in-memory mocks but the `adapters/memory/` reference adapters: they are wired by production DI (`pnpm dev` runs on them) and are held to the same conformance suites any real backend must pass. The original prohibition — "an in-memory imitation of transactions / OCC is no substitute for verification" — still stands; the conformance suites are that verification.
- What the memory backend cannot prove (driver-specific behavior: SQL constraints, parameter limits, transaction isolation of D1/DO) is deferred to the real-backend integration run of Issue #11, using the same suites. Do not read a green memory run as a production guarantee of those properties.
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

- `vitest.config.ts` pins `TZ=Asia/Tokyo` for the whole run. A UTC runner (which CI is) would make UTC-only assertions — `BillingPeriod`'s UTC calendar month — pass against a local-time implementation too, so the suite runs in a non-UTC zone to keep them discriminating. Everything else must stay TZ-independent.

## Timeout / flakiness

- `testTimeout` is raised to 10s for the scrypt(N=16384) password cases — the slowest tests in the suite (~300ms against single-digit ms elsewhere), which have overrun the 5s default under parallel load. Everything else uses Vitest's defaults and runs in-process with a controlled clock, so flakiness should be treated as a bug, not retried around.

## Commands

| Purpose | Command |
| --- | --- |
| All | `pnpm test` (alias of `test:unit`) |
| Unit only | `pnpm test:unit` |
| One area | `pnpm exec vitest run packages/core/src/application/identity` |

## Coverage

Coverage numbers are not enforced. Rules of thumb:

- **Domain**: aim for ~100%. Logic is local and easy to fully cover, and a missing test translates directly into a broken invariant.
- **Application**: per spec TC row — the implemented rows of `spec/testcases/` are the checklist, named in the tests.
- **Adapters**: per conformance-suite case; add a case to the shared suite (not a backend-local test) when a contract gap is found.
- **Frontend**: the bare minimum. The server function's wire-type boundary and UI logic are broadly covered by the framework primitives. The exception is the pure functions of `apps/web/app/presentation/` (status mapping, redaction, the open-redirect guard, and the error-message dictionary of `errorDisplay` together with the `extractSerializedError` paths that feed it): no framework is involved and they encode closed spec lists, so they carry unit tests under `apps/web/app/presentation/__tests__/`.
