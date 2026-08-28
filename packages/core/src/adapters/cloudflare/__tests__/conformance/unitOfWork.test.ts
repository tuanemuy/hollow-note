import { describeUnitOfWorkContract } from "../../../conformance/unitOfWork";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// The shared unit-of-work contract, observed through the ports rather
// than through the mechanism — that has its own backend-local coverage in
// `../unitOfWork.test.ts`. It spans several port bundles, so it belongs
// to no single one.
const BACKEND = "cloudflare";

describeUnitOfWorkContract(BACKEND, makeCloudflareConformanceBackend);
