import type { ScopeCleanupAdmissionStore } from "../../../../application/ports/scopeCleanupAdmissionStore";
import type { ScopeTaskScheduler } from "../../../../application/ports/scopeTaskScheduler";
import { createCloudflareScopeCleanupAdmissionStore } from "../../do/repositories/scopeCleanupAdmissionStore";
import { createCloudflareScopeTaskScheduler } from "../../do/repositories/scopeTaskScheduler";
import { port } from "../pendingPorts";
import type { ScopePortDeps } from "./deps";

/**
 * Step 9 — the scope Durable Object infrastructure bundle.
 *
 * `ScopeTaskScheduler` must be built out of the statement builders in
 * `../../do/scheduledTasks.ts`, not hand-rolled: the object's `alarm()`
 * turn walks the same rows by the same selection rule, and two spellings
 * of that rule would drift.
 *
 * `ScopeCleanupAdmissionStore` reads its required component set from
 * `deps.requiredCleanupComponents` — a deployment that declares nothing
 * must stall rather than complete (ADR 039).
 *
 * Suites: `conformance/scopeInfra.test.ts`.
 */
export type ScopeInfraPorts = Readonly<{
  scopeTaskScheduler: ScopeTaskScheduler;
  scopeCleanupAdmissionStore: ScopeCleanupAdmissionStore;
}>;

export function createScopeInfraPorts(deps: ScopePortDeps): ScopeInfraPorts {
  return {
    scopeTaskScheduler: port<ScopeTaskScheduler>("ScopeTaskScheduler", () =>
      createCloudflareScopeTaskScheduler({
        session: deps.session,
        scope: deps.scope,
        db: deps.db,
      }),
    ),
    scopeCleanupAdmissionStore: port<ScopeCleanupAdmissionStore>(
      "ScopeCleanupAdmissionStore",
      () =>
        createCloudflareScopeCleanupAdmissionStore({
          session: deps.session,
          clock: deps.clock,
          requiredComponents: deps.requiredCleanupComponents,
        }),
    ),
  };
}
