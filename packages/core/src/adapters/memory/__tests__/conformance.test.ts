import { describeAccountDeletionManifestStoreContract } from "../../conformance/accountDeletionManifestStore";
import { describeAppliedOperationStoreContract } from "../../conformance/appliedOperationStore";
import { describeAuthTokenRepositoryContract } from "../../conformance/authTokenRepository";
import { describeDistributedOperationStoreContract } from "../../conformance/distributedOperationStore";
import { describeGlobalMaintenanceRunStoreContract } from "../../conformance/globalMaintenanceRunStore";
import { describeIdempotencyStoreContract } from "../../conformance/idempotencyStore";
import { describeIdentityRemovalReceiptStoreContract } from "../../conformance/identityRemovalReceiptStore";
import { describeIdentityRepositoryContract } from "../../conformance/identityRepository";
import { describeIdentityUniqueDirectoryContract } from "../../conformance/identityUniqueDirectory";
import { describeInvitationRepositoryContract } from "../../conformance/invitationRepository";
import { describeInvitationRouteStoreContract } from "../../conformance/invitationRouteStore";
import { describeLlmUsageRepositoryContract } from "../../conformance/llmUsageRepository";
import { describeLocalNoteQueryServiceContract } from "../../conformance/localNoteQueryService";
import { describeLoginAttemptStoreContract } from "../../conformance/loginAttemptStore";
import { describeMembershipDirectoryReservationStoreContract } from "../../conformance/membershipDirectoryReservationStore";
import { describeMembershipRemovalPreparationStoreContract } from "../../conformance/membershipRemovalPreparationStore";
import { describeMembershipRepositoryContract } from "../../conformance/membershipRepository";
import { describeNoteProjectionContract } from "../../conformance/noteProjection";
import { describeNoteRepositoryContract } from "../../conformance/noteRepository";
import { describeNoteRevisionRepositoryContract } from "../../conformance/noteRevisionRepository";
import { describeNoteRouteFanOutReaderContract } from "../../conformance/noteRouteFanOutReader";
import { describeNoteRouteStoreContract } from "../../conformance/noteRouteStore";
import { describeOAuthStateStoreContract } from "../../conformance/oauthStateStore";
import { describeObjectStorageContract } from "../../conformance/objectStorage";
import { describeOutboxRepositoryContract } from "../../conformance/outboxRepository";
import { describePublicNoteQueryServiceContract } from "../../conformance/publicNoteQueryService";
import { describePublicWorkspaceDirectoryReaderContract } from "../../conformance/publicWorkspaceDirectoryReader";
import { describeScopeCleanupAdmissionStoreContract } from "../../conformance/scopeCleanupAdmissionStore";
import { describeScopeRouterContract } from "../../conformance/scopeRouter";
import { describeScopeTaskSchedulerContract } from "../../conformance/scopeTaskScheduler";
import { describeSessionRepositoryContract } from "../../conformance/sessionRepository";
import { describeStorageQuotaRepositoryContract } from "../../conformance/storageQuotaRepository";
import { describeStoredFileRepositoryContract } from "../../conformance/storedFileRepository";
import { describeUnitOfWorkContract } from "../../conformance/unitOfWork";
import { describeUserBatchReaderContract } from "../../conformance/userBatchReader";
import { describeUserRepositoryContract } from "../../conformance/userRepository";
import { describeUserWorkspaceDirectoryContract } from "../../conformance/userWorkspaceDirectory";
import { describeWorkspaceDeletionManifestStoreContract } from "../../conformance/workspaceDeletionManifestStore";
import { describeWorkspaceDirectoryBatchReaderContract } from "../../conformance/workspaceDirectoryBatchReader";
import { describeWorkspaceDirectoryProjectionWriterContract } from "../../conformance/workspaceDirectoryProjectionWriter";
import { describeWorkspaceOperationLockStoreContract } from "../../conformance/workspaceOperationLockStore";
import { describeWorkspaceRepositoryContract } from "../../conformance/workspaceRepository";
import { describeWorkspaceSlugReservationStoreContract } from "../../conformance/workspaceSlugReservationStore";
import { makeMemoryConformanceBackend } from "./conformanceBackend";

// The full shared port-conformance suite run against the in-memory
// backend. A D1/DO backend imports the same suites with its own factory.
const BACKEND = "memory";

describeUnitOfWorkContract(BACKEND, makeMemoryConformanceBackend);
describeUserRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeIdentityRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeSessionRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeAuthTokenRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeIdentityUniqueDirectoryContract(BACKEND, makeMemoryConformanceBackend);
describeIdentityRemovalReceiptStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeUserBatchReaderContract(BACKEND, makeMemoryConformanceBackend);
describeLoginAttemptStoreContract(BACKEND, makeMemoryConformanceBackend);
describeOAuthStateStoreContract(BACKEND, makeMemoryConformanceBackend);
describeIdempotencyStoreContract(BACKEND, makeMemoryConformanceBackend);
describeOutboxRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeNoteRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeNoteRevisionRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeNoteRouteStoreContract(BACKEND, makeMemoryConformanceBackend);
describeScopeRouterContract(BACKEND, makeMemoryConformanceBackend);
describeScopeTaskSchedulerContract(BACKEND, makeMemoryConformanceBackend);
describeAppliedOperationStoreContract(BACKEND, makeMemoryConformanceBackend);
describeDistributedOperationStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeStorageQuotaRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeLlmUsageRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeStoredFileRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeObjectStorageContract(BACKEND, makeMemoryConformanceBackend);
describeNoteRouteFanOutReaderContract(BACKEND, makeMemoryConformanceBackend);
describeNoteProjectionContract(BACKEND, makeMemoryConformanceBackend);
describeLocalNoteQueryServiceContract(BACKEND, makeMemoryConformanceBackend);
describePublicNoteQueryServiceContract(BACKEND, makeMemoryConformanceBackend);
describeScopeCleanupAdmissionStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeAccountDeletionManifestStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeGlobalMaintenanceRunStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeWorkspaceRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeMembershipRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeInvitationRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeUserWorkspaceDirectoryContract(BACKEND, makeMemoryConformanceBackend);
describeWorkspaceDirectoryBatchReaderContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describePublicWorkspaceDirectoryReaderContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeWorkspaceDirectoryProjectionWriterContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeInvitationRouteStoreContract(BACKEND, makeMemoryConformanceBackend);
describeMembershipDirectoryReservationStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeMembershipRemovalPreparationStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeWorkspaceOperationLockStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeWorkspaceDeletionManifestStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
describeWorkspaceSlugReservationStoreContract(
  BACKEND,
  makeMemoryConformanceBackend,
);
