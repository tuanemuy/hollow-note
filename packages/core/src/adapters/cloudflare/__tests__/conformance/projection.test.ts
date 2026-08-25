import { describeLocalNoteQueryServiceContract } from "../../../conformance/localNoteQueryService";
import { describeNoteProjectionContract } from "../../../conformance/noteProjection";
import { describeObjectStorageContract } from "../../../conformance/objectStorage";
import { describePublicNoteQueryServiceContract } from "../../../conformance/publicNoteQueryService";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the projection / full-text / R2 ports
// (`../ports/projection.ts`). The memory backend passes these with naive
// substring matching and no FTS at all, so a case that FTS5 + bigram
// fails here is a genuine question about where the contract's authority
// lies — resolve it by ADR 046, and if the suite changes, the memory
// backend has to keep passing it too.
const BACKEND = "cloudflare";

describeNoteProjectionContract(BACKEND, makeCloudflareConformanceBackend);
describeLocalNoteQueryServiceContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describePublicNoteQueryServiceContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeObjectStorageContract(BACKEND, makeCloudflareConformanceBackend);
