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
import type { BackupRecordRepository } from "../../domain/integration/ports/backupRecordRepository";
import type { LocalNoteProjectionWriter } from "../../domain/note/ports/localNoteProjectionWriter";
import type { LocalNoteQueryService } from "../../domain/note/ports/localNoteQueryService";
import type { NoteProjectionRevisionStore } from "../../domain/note/ports/noteProjectionRevisionStore";
import type { NoteProjectionSnapshotReader } from "../../domain/note/ports/noteProjectionSnapshotReader";
import type { NoteRepository } from "../../domain/note/ports/noteRepository";
import type { NoteRevisionRepository } from "../../domain/note/ports/noteRevisionRepository";
import type { PublicNoteProjectionWriter } from "../../domain/note/ports/publicNoteProjectionWriter";
import type { PublicNoteQueryService } from "../../domain/note/ports/publicNoteQueryService";
import type { StoredFileRepository } from "../../domain/storage/ports/storedFileRepository";
import type { TagAssignmentRepository } from "../../domain/tag/ports/tagAssignmentRepository";
import type { LlmUsageRepository } from "../../domain/usage/ports/llmUsageRepository";
import type { StorageQuotaRepository } from "../../domain/usage/ports/storageQuotaRepository";
import type { InvitationRepository } from "../../domain/workspace/ports/invitationRepository";
import type { InvitationRouteStore } from "../../domain/workspace/ports/invitationRouteStore";
import type { MembershipDirectoryReservationStore } from "../../domain/workspace/ports/membershipDirectoryReservationStore";
import type { MembershipRemovalPreparationStore } from "../../domain/workspace/ports/membershipRemovalPreparationStore";
import type { MembershipRepository } from "../../domain/workspace/ports/membershipRepository";
import type { PublicWorkspaceDirectoryReader } from "../../domain/workspace/ports/publicWorkspaceDirectoryReader";
import type { UserWorkspaceDirectory } from "../../domain/workspace/ports/userWorkspaceDirectory";
import type { WorkspaceDeletionManifestStore } from "../../domain/workspace/ports/workspaceDeletionManifestStore";
import type { WorkspaceDirectoryBatchReader } from "../../domain/workspace/ports/workspaceDirectoryBatchReader";
import type { WorkspaceDirectoryProjectionWriter } from "../../domain/workspace/ports/workspaceDirectoryProjectionWriter";
import type { WorkspaceOperationLockStore } from "../../domain/workspace/ports/workspaceOperationLockStore";
import type { WorkspaceRepository } from "../../domain/workspace/ports/workspaceRepository";
import type { WorkspaceSlugReservationStore } from "../../domain/workspace/ports/workspaceSlugReservationStore";
import type {
  WorkspaceId,
  WorkspaceName,
  WorkspaceRole,
  WorkspaceSlug,
} from "../../domain/workspace/valueObject";
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
  workspaceRepository: WorkspaceRepository;
  membershipRepository: MembershipRepository;
  invitationRepository: InvitationRepository;
  membershipRemovalPreparationStore: MembershipRemovalPreparationStore;
  workspaceOperationLockStore: WorkspaceOperationLockStore;
  workspaceDeletionManifestStore: WorkspaceDeletionManifestStore;
  scopeTaskScheduler: ScopeTaskScheduler;
  appliedOperationStore: AppliedOperationStore;
  storageQuotaRepository: StorageQuotaRepository;
  llmUsageRepository: LlmUsageRepository;
  storedFileRepository: StoredFileRepository;
  tagAssignmentRepository: TagAssignmentRepository;
  backupRecordRepository: BackupRecordRepository;
}>;

export type MembershipEdgeSeedInput = Readonly<{
  edgeKey: string;
  workspaceId: WorkspaceId;
  edgeState: "active" | "removing" | "pending" | "activating";
  membershipId: string | null;
  /** Projected role. Defaults to `viewer` when the seed omits it. */
  role?: WorkspaceRole;
  /**
   * Keyset position of the edge in `listActiveByUser`. Defaults to the
   * backend clock's current instant, which leaves the id tiebreak as the
   * only order — seed it explicitly to pin the primary key.
   */
  createdAt?: Date;
}>;

/**
 * One `workspace_directory` projection row, written straight into the
 * table rather than through `WorkspaceDirectoryProjectionWriter`.
 *
 * The readers' cases pin `sourceVersion` and `updatedAt` per row and
 * combine states the writer would never produce together — a `deleting`
 * row that still carries a slug is what pins the public enumeration's
 * lifecycle predicate — so the seed writes the row as given.
 */
export type WorkspaceDirectorySeedInput = Readonly<{
  workspaceId: WorkspaceId;
  name: WorkspaceName;
  slug: WorkspaceSlug | null;
  avatarUrl: string | null;
  publication: "private" | "published";
  /** A tombstoned workspace stays `deleting`. */
  lifecycle: "active" | "deleting";
  /**
   * Deletion that owns a tombstone. Backends derive one from the
   * workspace id when a `deleting` seed omits it, since the column is
   * required on such a row and no reader discriminates on its value.
   */
  deletionOperationId?: string;
  sourceVersion: number;
  updatedAt: Date;
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
  userWorkspaceDirectory: UserWorkspaceDirectory;
  workspaceDirectoryBatchReader: WorkspaceDirectoryBatchReader;
  publicWorkspaceDirectoryReader: PublicWorkspaceDirectoryReader;
  workspaceDirectoryProjectionWriter: WorkspaceDirectoryProjectionWriter;
  invitationRouteStore: InvitationRouteStore;
  membershipDirectoryReservationStore: MembershipDirectoryReservationStore;
  workspaceSlugReservationStore: WorkspaceSlugReservationStore;
  forScope(scope: ScopeKey): ScopedConformancePorts;
  /** Seeds `workspace_directory` rows for the two directory readers. */
  seedWorkspaceDirectory(
    entries: readonly WorkspaceDirectorySeedInput[],
  ): Promise<void>;
  /**
   * Puts the directory shards holding `ids` out of reach, standing in for
   * a shard a fan-out read cannot open. Both halves of the contract hang
   * on it: `WorkspaceDirectoryBatchReader.resolveMany` must degrade only
   * the affected ids to `unavailable`, while
   * `PublicWorkspaceDirectoryReader.listPublished` must fail rather than
   * return a page short of the dead shard's rows.
   *
   * It must really take effect — the suites assert on reads issued after
   * the call, so a stub that swallows its argument fails them.
   */
  makeWorkspaceDirectoryUnreadable(ids: readonly WorkspaceId[]): Promise<void>;
  /**
   * Seeds workspace membership edges straight into the directory table.
   *
   * Required, because the states it reaches are ones no port method
   * leaves behind: `reserveAndClaimActivation` inserts and claims in one
   * transaction, so a `pending` edge — the account deletion half's only
   * subject — and an edge naming no membership exist for a suite only if
   * the backend can write one. A backend that could not would take the
   * prepare / commit / release lock clauses, the removal state machine's
   * refusals and both directory counts out of its run and stay green.
   */
  seedMembershipEdges(
    userId: UserId,
    edges: readonly MembershipEdgeSeedInput[],
  ): Promise<void>;
  /**
   * Replaces the deployment's sweep-table set for one kind after the
   * backend was built, standing in for a deploy that changes the table
   * configuration while a run is in flight. It is how the suite pins the
   * run's snapshot — rather than the deployment's configuration — as the
   * walk-order authority.
   *
   * It must really take effect: the suite starts a run *after* the call
   * and asserts that run walks the new set, so a stub that swallows its
   * arguments fails the suite.
   */
  setMaintenanceTables(
    kind: MaintenanceKind,
    tables: readonly string[],
  ): Promise<void>;
}>;

export type MakeConformanceBackend = (
  options?: ConformanceBackendOptions,
) => ConformanceBackend | Promise<ConformanceBackend>;
