import { describeScopeCleanupAdmissionStoreContract } from "../../../conformance/scopeCleanupAdmissionStore";
import { describeScopeTaskSchedulerContract } from "../../../conformance/scopeTaskScheduler";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Step 9 — scope DO infrastructure. Ports wired in `../ports/scopeInfra.ts`.
// The `scopeTaskScheduler` suite also observes `ScopeTaskQueue.listDue`
// (step 7), so this file goes green only once both are wired.
const BACKEND = "cloudflare";

describeScopeTaskSchedulerContract(BACKEND, makeCloudflareConformanceBackend);
describeScopeCleanupAdmissionStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
