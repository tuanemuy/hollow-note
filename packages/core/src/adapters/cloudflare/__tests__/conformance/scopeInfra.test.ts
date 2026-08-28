import { describeScopeCleanupAdmissionStoreContract } from "../../../conformance/scopeCleanupAdmissionStore";
import { describeScopeTaskSchedulerContract } from "../../../conformance/scopeTaskScheduler";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the scope Durable Object infrastructure ports
// (`../ports/scopeInfra.ts`). The `scopeTaskScheduler` suite also
// observes `ScopeTaskQueue.listDue`, which belongs to `../ports/route.ts`.
const BACKEND = "cloudflare";

describeScopeTaskSchedulerContract(BACKEND, makeCloudflareConformanceBackend);
describeScopeCleanupAdmissionStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
