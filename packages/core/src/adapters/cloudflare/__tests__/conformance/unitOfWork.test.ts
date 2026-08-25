import { describeUnitOfWorkContract } from "../../../conformance/unitOfWork";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Step 11 — the shared unit-of-work contract. The mechanism itself is
// step 2's and already has backend-local coverage in
// `../unitOfWork.test.ts`; this file observes it through the ports, so it
// depends on `UserRepository` (step 5), `OutboxRepository` (step 7) and
// `NoteRepository` (step 8) and belongs to no single bundle.
const BACKEND = "cloudflare";

describeUnitOfWorkContract(BACKEND, makeCloudflareConformanceBackend);
