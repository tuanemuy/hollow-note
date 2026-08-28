import type { ScopeCleanupAdmissionStore } from "../../../../application/ports/scopeCleanupAdmissionStore";
import type { ScopeTaskScheduler } from "../../../../application/ports/scopeTaskScheduler";
import { createCloudflareScopeCleanupAdmissionStore } from "../../do/repositories/scopeCleanupAdmissionStore";
import { createCloudflareScopeTaskScheduler } from "../../do/repositories/scopeTaskScheduler";
import type { ScopePortDeps } from "./deps";

/**
 * The scope Durable Object infrastructure bundle.
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
    scopeTaskScheduler: createCloudflareScopeTaskScheduler({
      session: deps.session,
      scope: deps.scope,
      db: deps.db,
    }),
    scopeCleanupAdmissionStore: createCloudflareScopeCleanupAdmissionStore({
      session: deps.session,
      clock: deps.clock,
      requiredComponents: deps.requiredCleanupComponents,
    }),
  };
}
