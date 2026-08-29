import { describeInvitationRepositoryContract } from "../../../conformance/invitationRepository";
import { describeInvitationRouteStoreContract } from "../../../conformance/invitationRouteStore";
import { describeMembershipDirectoryReservationStoreContract } from "../../../conformance/membershipDirectoryReservationStore";
import { describeMembershipRemovalPreparationStoreContract } from "../../../conformance/membershipRemovalPreparationStore";
import { describeMembershipRepositoryContract } from "../../../conformance/membershipRepository";
import { describePublicWorkspaceDirectoryReaderContract } from "../../../conformance/publicWorkspaceDirectoryReader";
import { describeUserWorkspaceDirectoryContract } from "../../../conformance/userWorkspaceDirectory";
import { describeWorkspaceDeletionManifestStoreContract } from "../../../conformance/workspaceDeletionManifestStore";
import { describeWorkspaceDirectoryBatchReaderContract } from "../../../conformance/workspaceDirectoryBatchReader";
import { describeWorkspaceDirectoryProjectionWriterContract } from "../../../conformance/workspaceDirectoryProjectionWriter";
import { describeWorkspaceOperationLockStoreContract } from "../../../conformance/workspaceOperationLockStore";
import { describeWorkspaceRepositoryContract } from "../../../conformance/workspaceRepository";
import { describeWorkspaceSlugReservationStoreContract } from "../../../conformance/workspaceSlugReservationStore";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the Workspace ports, over the same D1 / Durable Object
// implementations production wires.
const BACKEND = "cloudflare";

describeWorkspaceRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeMembershipRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeInvitationRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeUserWorkspaceDirectoryContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeWorkspaceDirectoryBatchReaderContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describePublicWorkspaceDirectoryReaderContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeWorkspaceDirectoryProjectionWriterContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeInvitationRouteStoreContract(BACKEND, makeCloudflareConformanceBackend);
describeMembershipDirectoryReservationStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeMembershipRemovalPreparationStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeWorkspaceOperationLockStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeWorkspaceDeletionManifestStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeWorkspaceSlugReservationStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
