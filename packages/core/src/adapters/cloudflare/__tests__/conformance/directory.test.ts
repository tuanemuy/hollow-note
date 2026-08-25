import { describeAccountDeletionManifestStoreContract } from "../../../conformance/accountDeletionManifestStore";
import { describeDistributedOperationStoreContract } from "../../../conformance/distributedOperationStore";
import { describeGlobalMaintenanceRunStoreContract } from "../../../conformance/globalMaintenanceRunStore";
import { describeIdentityUniqueDirectoryContract } from "../../../conformance/identityUniqueDirectory";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Step 6 — D1 directory / operation. Ports wired in `../ports/directory.ts`.
const BACKEND = "cloudflare";

describeIdentityUniqueDirectoryContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeDistributedOperationStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeAccountDeletionManifestStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeGlobalMaintenanceRunStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
