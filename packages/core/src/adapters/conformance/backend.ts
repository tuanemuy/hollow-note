import type {
  GlobalUnitOfWorkProvider,
  ScopeUnitOfWorkProvider,
} from "../../application/execution/unitOfWork";
import type {
  AccountDeletionManifestStore,
  AccountDeletionReceipt,
} from "../../application/ports/accountDeletionManifestStore";
import type { AppliedOperationStore } from "../../application/ports/appliedOperationStore";
import type { DistributedOperationStore } from "../../application/ports/distributedOperationStore";
import type {
  GlobalMaintenanceRunStore,
  MaintenanceKind,
} from "../../application/ports/globalMaintenanceRunStore";
import type { IdempotencyStore } from "../../application/ports/idempotencyStore";
import type { IdentityRemovalReceiptStore } from "../../application/ports/identityRemovalReceiptStore";
import type { NoteRouteFanOutReader } from "../../application/ports/noteRouteFanOutReader";
import type { NoteRouteStore } from "../../application/ports/noteRouteStore";
import type { OAuthStateStore } from "../../application/ports/oauthStateStore";
import type { ObjectStorage } from "../../application/ports/objectStorage";
import type { OutboxRepository } from "../../application/ports/outboxRepository";
import type {
  PersonalCleanupComponent,
  ScopeCleanupAdmissionStore,
} from "../../application/ports/scopeCleanupAdmissionStore";
import type { ScopeRouter } from "../../application/ports/scopeRouter";
import type { ScopeTaskQueue } from "../../application/ports/scopeTaskQueue";
import type { ScopeTaskScheduler } from "../../application/ports/scopeTaskScheduler";
import type { ScopeKey } from "../../application/scope";
import type { AuthTokenRepository } from "../../domain/identity/ports/authTokenRepository";
import type { IdentityRepository } from "../../domain/identity/ports/identityRepository";
import type { IdentityUniqueDirectory } from "../../domain/identity/ports/identityUniqueDirectory";
import type { LoginAttemptStore } from "../../domain/identity/ports/loginAttemptStore";
import type { SessionRepository } from "../../domain/identity/ports/sessionRepository";
import type { UserBatchReader } from "../../domain/identity/ports/userBatchReader";
import type { UserRepository } from "../../domain/identity/ports/userRepository";
import type { UserId } from "../../domain/identity/valueObject";
import type { LocalNoteProjectionWriter } from "../../domain/note/ports/localNoteProjectionWriter";
import type { LocalNoteQueryService } from "../../domain/note/ports/localNoteQueryService";
import type { NoteProjectionRevisionStore } from "../../domain/note/ports/noteProjectionRevisionStore";
import type { NoteProjectionSnapshotReader } from "../../domain/note/ports/noteProjectionSnapshotReader";
import type { NoteRepository } from "../../domain/note/ports/noteRepository";
import type { NoteRevisionRepository } from "../../domain/note/ports/noteRevisionRepository";
import type { PublicNoteProjectionWriter } from "../../domain/note/ports/publicNoteProjectionWriter";
import type { PublicNoteQueryService } from "../../domain/note/ports/publicNoteQueryService";
import type { StoredFileRepository } from "../../domain/storage/ports/storedFileRepository";
import type { LlmUsageRepository } from "../../domain/usage/ports/llmUsageRepository";
import type { StorageQuotaRepository } from "../../domain/usage/ports/storageQuotaRepository";
import type { WorkspaceId } from "../../domain/workspace/valueObject";
import type { TestClock } from "./testClock";

export type ConformanceBackendOptions = Readonly<{
  maintenanceShardIds?: readonly string[];
  maintenanceTablesByKind?: Partial<Record<MaintenanceKind, readonly string[]>>;
  /**
   * Cleanup participants the backend under test declares. The suites
   * drive completion from the same sets, so the contract is "everything
   * declared, nothing else" rather than a fixed enum a deployment may
   * not be able to satisfy.
   */
  requiredCleanupComponents?: readonly PersonalCleanupComponent[];
  requiredFinalizeReceipts?: readonly AccountDeletionReceipt[];
}>;

/** Scope-plane ports bound to one `ScopeKey`. */
export type ScopedConformancePorts = Readonly<{
  noteRepository: NoteRepository;
  noteRevisionRepository: NoteRevisionRepository;
  scopeCleanupAdmissionStore: ScopeCleanupAdmissionStore;
  localNoteProjectionWriter: LocalNoteProjectionWriter;
  noteProjectionSnapshotReader: NoteProjectionSnapshotReader;
  noteProjectionRevisionStore: NoteProjectionRevisionStore;
  localNoteQueryService: LocalNoteQueryService;
  scopeTaskScheduler: ScopeTaskScheduler;
  appliedOperationStore: AppliedOperationStore;
  storageQuotaRepository: StorageQuotaRepository;
  llmUsageRepository: LlmUsageRepository;
  storedFileRepository: StoredFileRepository;
}>;

export type MembershipEdgeSeedInput = Readonly<{
  edgeKey: string;
  workspaceId: WorkspaceId;
  edgeState: "active" | "removing" | "pending";
  membershipId: string | null;
}>;

/**
 * Everything a backend must provide to run the shared port-conformance
 * suites. `adapters/memory` is the reference implementation; a D1/DO
 * backend implements the same factory and imports the same suites.
 *
 * Suites always obtain a **fresh** backend per test via the factory, so
 * implementations must not share state across factory calls.
 */
export type ConformanceBackend = Readonly<{
  clock: TestClock;
  globalUnitOfWork: GlobalUnitOfWorkProvider;
  scopeUnitOfWork: ScopeUnitOfWorkProvider;
  /**
   * Relay kicks observed since backend creation. The factory wires a
   * counting `RelayTrigger` into both unit-of-work providers so the
   * shared UoW suite can assert "kick after commit only".
   */
  relayKickCount(): number;
  userRepository: UserRepository;
  identityRepository: IdentityRepository;
  sessionRepository: SessionRepository;
  authTokenRepository: AuthTokenRepository;
  identityUniqueDirectory: IdentityUniqueDirectory;
  identityRemovalReceiptStore: IdentityRemovalReceiptStore;
  distributedOperationStore: DistributedOperationStore;
  userBatchReader: UserBatchReader;
  loginAttemptStore: LoginAttemptStore;
  oauthStateStore: OAuthStateStore;
  idempotencyStore: IdempotencyStore;
  outboxRepository: OutboxRepository;
  noteRouteStore: NoteRouteStore;
  noteRouteFanOutReader: NoteRouteFanOutReader;
  scopeRouter: ScopeRouter;
  scopeTaskQueue: ScopeTaskQueue;
  objectStorage: ObjectStorage;
  accountDeletionManifestStore: AccountDeletionManifestStore;
  globalMaintenanceRunStore: GlobalMaintenanceRunStore;
  publicNoteProjectionWriter: PublicNoteProjectionWriter;
  publicNoteQueryService: PublicNoteQueryService;
  forScope(scope: ScopeKey): ScopedConformancePorts;
  /**
   * Seeds workspace membership edges for `appendMembershipPage` until the
   * Workspace domain exists. Optional — suites skip the page-content
   * cases when a backend cannot seed.
   */
  seedMembershipEdges?(
    userId: UserId,
    edges: readonly MembershipEdgeSeedInput[],
  ): Promise<void>;
  /**
   * Replaces the deployment's sweep-table set for one kind after the
   * backend was built, standing in for a deploy that changes the table
   * configuration while a run is in flight. Required: it is the only way
   * the suite can pin the run's snapshot — rather than the deployment's
   * configuration — as the walk-order authority, so a backend without it
   * would report "conformant" having never verified contract 1.
   */
  setMaintenanceTables(
    kind: MaintenanceKind,
    tables: readonly string[],
  ): Promise<void>;
}>;

export type MakeConformanceBackend = (
  options?: ConformanceBackendOptions,
) => ConformanceBackend | Promise<ConformanceBackend>;
