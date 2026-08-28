import { describeAppliedOperationStoreContract } from "../../../conformance/appliedOperationStore";
import { describeLlmUsageRepositoryContract } from "../../../conformance/llmUsageRepository";
import { describeNoteRepositoryContract } from "../../../conformance/noteRepository";
import { describeNoteRevisionRepositoryContract } from "../../../conformance/noteRevisionRepository";
import { describeStorageQuotaRepositoryContract } from "../../../conformance/storageQuotaRepository";
import { describeStoredFileRepositoryContract } from "../../../conformance/storedFileRepository";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the scope Durable Object business ports
// (`../ports/scopeBusiness.ts`).
const BACKEND = "cloudflare";

describeStoredFileRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeNoteRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeStorageQuotaRepositoryContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeNoteRevisionRepositoryContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeLlmUsageRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeAppliedOperationStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
