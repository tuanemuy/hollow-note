import { describeIdempotencyStoreContract } from "../../../conformance/idempotencyStore";
import { describeNoteRouteFanOutReaderContract } from "../../../conformance/noteRouteFanOutReader";
import { describeNoteRouteStoreContract } from "../../../conformance/noteRouteStore";
import { describeOutboxRepositoryContract } from "../../../conformance/outboxRepository";
import { describeScopeRouterContract } from "../../../conformance/scopeRouter";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the D1 route / infrastructure / cross-plane ports
// (`../ports/route.ts`). `ScopeTaskQueue.listDue` is not among them: it
// is exercised by the `scopeTaskScheduler` suite in `scopeInfra.test.ts`.
const BACKEND = "cloudflare";

describeNoteRouteStoreContract(BACKEND, makeCloudflareConformanceBackend);
describeNoteRouteFanOutReaderContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeOutboxRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeIdempotencyStoreContract(BACKEND, makeCloudflareConformanceBackend);
describeScopeRouterContract(BACKEND, makeCloudflareConformanceBackend);
