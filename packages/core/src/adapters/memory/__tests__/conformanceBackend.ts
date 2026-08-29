import type { MaintenanceKind } from "../../../application/ports/globalMaintenanceRunStore";
import type { ScopeKey } from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import type { WorkspaceId } from "../../../domain/workspace/valueObject";
import type {
  ConformanceBackend,
  ConformanceBackendOptions,
  MembershipEdgeSeedInput,
  WorkspaceDirectorySeedInput,
} from "../../conformance/backend";
import { createTestClock } from "../../conformance/testClock";
import { createMemoryGlobalUnitOfWorkProvider } from "../globalUnitOfWork";
import { createMemoryObjectStorage } from "../objectStorage";
import { createMemoryAccountDeletionManifestStore } from "../repositories/accountDeletionManifestStore";
import { createMemoryAppliedOperationStore } from "../repositories/appliedOperationStore";
import { createMemoryAuthTokenRepository } from "../repositories/authTokenRepository";
import { createMemoryDistributedOperationStore } from "../repositories/distributedOperationStore";
import { createMemoryGlobalMaintenanceRunStore } from "../repositories/globalMaintenanceRunStore";
import { createMemoryIdempotencyStore } from "../repositories/idempotencyStore";
import { createMemoryIdentityRemovalReceiptStore } from "../repositories/identityRemovalReceiptStore";
import { createMemoryIdentityRepository } from "../repositories/identityRepository";
import { createMemoryIdentityUniqueDirectory } from "../repositories/identityUniqueDirectory";
import { createMemoryInvitationRepository } from "../repositories/invitationRepository";
import { createMemoryInvitationRouteStore } from "../repositories/invitationRouteStore";
import { createMemoryLlmUsageRepository } from "../repositories/llmUsageRepository";
import { createMemoryLocalNoteQueryService } from "../repositories/localNoteQueryService";
import { createMemoryLoginAttemptStore } from "../repositories/loginAttemptStore";
import { createMemoryMembershipDirectoryReservationStore } from "../repositories/membershipDirectoryReservationStore";
import { createMemoryMembershipRemovalPreparationStore } from "../repositories/membershipRemovalPreparationStore";
import { createMemoryMembershipRepository } from "../repositories/membershipRepository";
import {
  createMemoryLocalNoteProjectionWriter,
  createMemoryNoteProjectionRevisionStore,
  createMemoryNoteProjectionSnapshotReader,
  createMemoryPublicNoteProjectionWriter,
} from "../repositories/noteProjection";
import { createMemoryNoteRepository } from "../repositories/noteRepository";
import { createMemoryNoteRevisionRepository } from "../repositories/noteRevisionRepository";
import { createMemoryNoteRouteFanOutReader } from "../repositories/noteRouteFanOutReader";
import { createMemoryNoteRouteStore } from "../repositories/noteRouteStore";
import { createMemoryOAuthStateStore } from "../repositories/oauthStateStore";
import { createMemoryOutboxRepository } from "../repositories/outboxRepository";
import { createMemoryPublicNoteQueryService } from "../repositories/publicNoteQueryService";
import { createMemoryPublicWorkspaceDirectoryReader } from "../repositories/publicWorkspaceDirectoryReader";
import { createMemoryScopeCleanupAdmissionStore } from "../repositories/scopeCleanupAdmissionStore";
import { createMemoryScopeTaskScheduler } from "../repositories/scopeTaskScheduler";
import { createMemorySessionRepository } from "../repositories/sessionRepository";
import { createMemoryStorageQuotaRepository } from "../repositories/storageQuotaRepository";
import { createMemoryStoredFileRepository } from "../repositories/storedFileRepository";
import { createMemoryUserBatchReader } from "../repositories/userBatchReader";
import { createMemoryUserRepository } from "../repositories/userRepository";
import { createMemoryUserWorkspaceDirectory } from "../repositories/userWorkspaceDirectory";
import { createMemoryWorkspaceDeletionManifestStore } from "../repositories/workspaceDeletionManifestStore";
import { createMemoryWorkspaceDirectoryBatchReader } from "../repositories/workspaceDirectoryBatchReader";
import { createMemoryWorkspaceDirectoryProjectionWriter } from "../repositories/workspaceDirectoryProjectionWriter";
import { createMemoryWorkspaceOperationLockStore } from "../repositories/workspaceOperationLockStore";
import { createMemoryWorkspaceRepository } from "../repositories/workspaceRepository";
import { createMemoryWorkspaceSlugReservationStore } from "../repositories/workspaceSlugReservationStore";
import { createMemoryScopeRouter } from "../scopeRouter";
import { createMemoryScopeTaskQueue } from "../scopeTaskQueue";
import { createMemoryScopeUnitOfWorkProvider } from "../scopeUnitOfWork";
import { MemoryBackend } from "../store";

const HOUR_MS = 60 * 60 * 1000;

/** Conformance-backend factory over a fresh `MemoryBackend` per call. */
export function makeMemoryConformanceBackend(
  options: ConformanceBackendOptions = {},
): ConformanceBackend {
  const clock = createTestClock();
  const backend = new MemoryBackend({
    clock,
    ...(options.maintenanceShardIds !== undefined
      ? { maintenanceShardIds: options.maintenanceShardIds }
      : {}),
    ...(options.maintenanceTablesByKind !== undefined
      ? { maintenanceTablesByKind: options.maintenanceTablesByKind }
      : {}),
  });
  let relayKicks = 0;
  const relayTrigger = {
    kick: () => {
      relayKicks += 1;
    },
  };
  const cleanupOptions = {
    ...(options.requiredCleanupComponents !== undefined
      ? { requiredCleanupComponents: options.requiredCleanupComponents }
      : {}),
    ...(options.requiredFinalizeReceipts !== undefined
      ? { requiredFinalizeReceipts: options.requiredFinalizeReceipts }
      : {}),
  };
  const manifestOptions =
    options.requiredFinalizeReceipts !== undefined
      ? { requiredFinalizeReceipts: options.requiredFinalizeReceipts }
      : {};
  const admissionOptions =
    options.requiredCleanupComponents !== undefined
      ? { requiredComponents: options.requiredCleanupComponents }
      : {};
  return {
    clock,
    globalUnitOfWork: createMemoryGlobalUnitOfWorkProvider(backend, {
      relayTrigger,
      ...cleanupOptions,
    }),
    scopeUnitOfWork: createMemoryScopeUnitOfWorkProvider(backend, {
      relayTrigger,
      ...cleanupOptions,
    }),
    relayKickCount: () => relayKicks,
    userRepository: createMemoryUserRepository(backend),
    identityRepository: createMemoryIdentityRepository(backend),
    sessionRepository: createMemorySessionRepository(backend),
    authTokenRepository: createMemoryAuthTokenRepository(backend),
    identityUniqueDirectory: createMemoryIdentityUniqueDirectory(backend),
    identityRemovalReceiptStore:
      createMemoryIdentityRemovalReceiptStore(backend),
    distributedOperationStore: createMemoryDistributedOperationStore(backend),
    userBatchReader: createMemoryUserBatchReader(backend),
    loginAttemptStore: createMemoryLoginAttemptStore(backend),
    oauthStateStore: createMemoryOAuthStateStore(backend),
    idempotencyStore: createMemoryIdempotencyStore(backend),
    outboxRepository: createMemoryOutboxRepository(backend),
    noteRouteStore: createMemoryNoteRouteStore(backend),
    noteRouteFanOutReader: createMemoryNoteRouteFanOutReader(backend),
    scopeRouter: createMemoryScopeRouter(backend),
    scopeTaskQueue: createMemoryScopeTaskQueue(backend),
    objectStorage: createMemoryObjectStorage(backend),
    accountDeletionManifestStore: createMemoryAccountDeletionManifestStore(
      backend,
      manifestOptions,
    ),
    globalMaintenanceRunStore: createMemoryGlobalMaintenanceRunStore(backend),
    publicNoteProjectionWriter: createMemoryPublicNoteProjectionWriter(backend),
    publicNoteQueryService: createMemoryPublicNoteQueryService(backend),
    userWorkspaceDirectory: createMemoryUserWorkspaceDirectory(backend),
    workspaceDirectoryBatchReader:
      createMemoryWorkspaceDirectoryBatchReader(backend),
    publicWorkspaceDirectoryReader:
      createMemoryPublicWorkspaceDirectoryReader(backend),
    workspaceDirectoryProjectionWriter:
      createMemoryWorkspaceDirectoryProjectionWriter(backend),
    invitationRouteStore: createMemoryInvitationRouteStore(backend),
    membershipDirectoryReservationStore:
      createMemoryMembershipDirectoryReservationStore(backend),
    workspaceSlugReservationStore:
      createMemoryWorkspaceSlugReservationStore(backend),
    forScope(scope: ScopeKey) {
      const scopeStore = backend.scope(scope);
      return {
        workspaceRepository: createMemoryWorkspaceRepository(scopeStore),
        membershipRepository: createMemoryMembershipRepository(scopeStore),
        invitationRepository: createMemoryInvitationRepository(scopeStore),
        membershipRemovalPreparationStore:
          createMemoryMembershipRemovalPreparationStore(scopeStore),
        workspaceOperationLockStore: createMemoryWorkspaceOperationLockStore(
          backend,
          scopeStore,
        ),
        workspaceDeletionManifestStore:
          createMemoryWorkspaceDeletionManifestStore(scopeStore, () =>
            clock.now(),
          ),
        noteRepository: createMemoryNoteRepository(scopeStore),
        noteRevisionRepository: createMemoryNoteRevisionRepository(scopeStore),
        scopeCleanupAdmissionStore: createMemoryScopeCleanupAdmissionStore(
          scopeStore,
          admissionOptions,
        ),
        localNoteProjectionWriter:
          createMemoryLocalNoteProjectionWriter(scopeStore),
        noteProjectionSnapshotReader:
          createMemoryNoteProjectionSnapshotReader(scopeStore),
        noteProjectionRevisionStore:
          createMemoryNoteProjectionRevisionStore(scopeStore),
        localNoteQueryService: createMemoryLocalNoteQueryService(scopeStore),
        scopeTaskScheduler: createMemoryScopeTaskScheduler(scopeStore),
        appliedOperationStore: createMemoryAppliedOperationStore(scopeStore),
        storageQuotaRepository: createMemoryStorageQuotaRepository(scopeStore),
        llmUsageRepository: createMemoryLlmUsageRepository(scopeStore),
        storedFileRepository: createMemoryStoredFileRepository(scopeStore),
      };
    },
    async seedMembershipEdges(
      userId: UserId,
      edges: readonly MembershipEdgeSeedInput[],
    ): Promise<void> {
      for (const edge of edges) {
        backend.membershipEdges.set(`${userId} ${edge.edgeKey}`, {
          userId,
          edgeKey: edge.edgeKey,
          workspaceId: edge.workspaceId,
          edgeState: edge.edgeState,
          membershipId: edge.membershipId,
          role: edge.role ?? "viewer",
          deletionPrepareOperationId: null,
          deletionPrepareExpiresAt: null,
          reservationExpiresAt:
            edge.edgeState === "pending" || edge.edgeState === "activating"
              ? new Date(clock.now().getTime() + HOUR_MS)
              : null,
          createdAt: edge.createdAt ?? clock.now(),
        });
      }
    },
    async seedWorkspaceDirectory(
      entries: readonly WorkspaceDirectorySeedInput[],
    ): Promise<void> {
      for (const entry of entries) {
        backend.workspaceDirectory.set(entry.workspaceId, {
          ...entry,
          deletionOperationId:
            entry.lifecycle === "deleting"
              ? (entry.deletionOperationId ?? `deletion-${entry.workspaceId}`)
              : null,
        });
      }
    },
    async makeWorkspaceDirectoryUnreadable(
      ids: readonly WorkspaceId[],
    ): Promise<void> {
      for (const id of ids) {
        backend.workspaceDirectoryOutages.add(id);
      }
    },
    async setMaintenanceTables(
      kind: MaintenanceKind,
      tables: readonly string[],
    ): Promise<void> {
      // Writing the record value in place is what a mid-run deploy does to
      // this backend: `beginOrResumeKind` snapshots the set onto the run
      // row, so only runs created *after* this call see it. Keeping the
      // value slot writable is therefore load-bearing — declaring the
      // field `Readonly<Record<...>>` would leave contract 1 with no
      // executable form.
      backend.maintenanceTablesByKind[kind] = tables;
    },
  };
}
