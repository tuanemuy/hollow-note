import { describeAccountDeletionManifestStoreContract } from "../../conformance/accountDeletionManifestStore";
import { describeAuthTokenRepositoryContract } from "../../conformance/authTokenRepository";
import { describeGlobalMaintenanceRunStoreContract } from "../../conformance/globalMaintenanceRunStore";
import { describeIdempotencyStoreContract } from "../../conformance/idempotencyStore";
import { describeIdentityRepositoryContract } from "../../conformance/identityRepository";
import { describeIdentityUniqueDirectoryContract } from "../../conformance/identityUniqueDirectory";
import { describeLocalNoteQueryServiceContract } from "../../conformance/localNoteQueryService";
import { describeLoginAttemptStoreContract } from "../../conformance/loginAttemptStore";
import { describeNoteProjectionContract } from "../../conformance/noteProjection";
import { describeNoteRepositoryContract } from "../../conformance/noteRepository";
import { describeNoteRevisionRepositoryContract } from "../../conformance/noteRevisionRepository";
import { describeNoteRouteFanOutReaderContract } from "../../conformance/noteRouteFanOutReader";
import { describeNoteRouteStoreContract } from "../../conformance/noteRouteStore";
import { describeOAuthStateStoreContract } from "../../conformance/oauthStateStore";
import { describeOutboxRepositoryContract } from "../../conformance/outboxRepository";
import { describePublicNoteQueryServiceContract } from "../../conformance/publicNoteQueryService";
import { describeScopeCleanupAdmissionStoreContract } from "../../conformance/scopeCleanupAdmissionStore";
import { describeScopeRouterContract } from "../../conformance/scopeRouter";
import { describeSessionRepositoryContract } from "../../conformance/sessionRepository";
import { describeUserBatchReaderContract } from "../../conformance/userBatchReader";
import { describeUserRepositoryContract } from "../../conformance/userRepository";
import { makeMemoryConformanceBackend } from "./conformanceBackend";

// The full shared port-conformance suite run against the in-memory
// backend. Issue #11's D1/DO backend imports the same suites with its
// own factory.
const BACKEND = "memory";

describeUserRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeIdentityRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeSessionRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeAuthTokenRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeIdentityUniqueDirectoryContract(BACKEND, makeMemoryConformanceBackend);
describeUserBatchReaderContract(BACKEND, makeMemoryConformanceBackend);
describeLoginAttemptStoreContract(BACKEND, makeMemoryConformanceBackend);
describeOAuthStateStoreContract(BACKEND, makeMemoryConformanceBackend);
describeIdempotencyStoreContract(BACKEND, makeMemoryConformanceBackend);
describeOutboxRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeNoteRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeNoteRevisionRepositoryContract(BACKEND, makeMemoryConformanceBackend);
describeNoteRouteStoreContract(BACKEND, makeMemoryConformanceBackend);
describeScopeRouterContract(BACKEND, makeMemoryConformanceBackend);
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
