import { describeInvitationRepositoryContract } from "../../../conformance/invitationRepository";
import { describeMembershipRepositoryContract } from "../../../conformance/membershipRepository";
import { describePublicWorkspaceDirectoryReaderContract } from "../../../conformance/publicWorkspaceDirectoryReader";
import { describeUserWorkspaceDirectoryContract } from "../../../conformance/userWorkspaceDirectory";
import { describeWorkspaceDirectoryBatchReaderContract } from "../../../conformance/workspaceDirectoryBatchReader";
import { describeWorkspaceRepositoryContract } from "../../../conformance/workspaceRepository";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the Workspace ports. The D1 / Durable Object
// implementations do not exist yet — the harness declares them as
// throwing stubs, so these suites are red until they land.
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
