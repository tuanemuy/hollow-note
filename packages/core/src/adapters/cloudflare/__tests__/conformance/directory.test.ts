import { describeAccountDeletionManifestStoreContract } from "../../../conformance/accountDeletionManifestStore";
import { describeDistributedOperationStoreContract } from "../../../conformance/distributedOperationStore";
import { describeGlobalMaintenanceRunStoreContract } from "../../../conformance/globalMaintenanceRunStore";
import { describeIdentityUniqueDirectoryContract } from "../../../conformance/identityUniqueDirectory";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the D1 directory / operation ports (`../ports/directory.ts`).
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
