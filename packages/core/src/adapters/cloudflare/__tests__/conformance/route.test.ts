import { describeIdempotencyStoreContract } from "../../../conformance/idempotencyStore";
import { describeNoteRouteFanOutReaderContract } from "../../../conformance/noteRouteFanOutReader";
import { describeNoteRouteStoreContract } from "../../../conformance/noteRouteStore";
import { describeOutboxRepositoryContract } from "../../../conformance/outboxRepository";
import { describeScopeRouterContract } from "../../../conformance/scopeRouter";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Step 7 — D1 route / infrastructure / cross-plane. Ports wired in
// `../ports/route.ts`. `ScopeTaskQueue.listDue` is exercised by the
// `scopeTaskScheduler` suite, which lives in `scopeInfra.test.ts` — the
// two bundles meet there and both owners should watch that file.
const BACKEND = "cloudflare";

describeNoteRouteStoreContract(BACKEND, makeCloudflareConformanceBackend);
describeNoteRouteFanOutReaderContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeOutboxRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeIdempotencyStoreContract(BACKEND, makeCloudflareConformanceBackend);
describeScopeRouterContract(BACKEND, makeCloudflareConformanceBackend);
