import type { ScopeKey } from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import type {
  ConformanceBackend,
  ConformanceBackendOptions,
  MembershipEdgeSeedInput,
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
import { createMemoryLlmUsageRepository } from "../repositories/llmUsageRepository";
import { createMemoryLocalNoteQueryService } from "../repositories/localNoteQueryService";
import { createMemoryLoginAttemptStore } from "../repositories/loginAttemptStore";
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
import { createMemoryScopeCleanupAdmissionStore } from "../repositories/scopeCleanupAdmissionStore";
import { createMemoryScopeTaskScheduler } from "../repositories/scopeTaskScheduler";
import { createMemorySessionRepository } from "../repositories/sessionRepository";
import { createMemoryStorageQuotaRepository } from "../repositories/storageQuotaRepository";
import { createMemoryStoredFileRepository } from "../repositories/storedFileRepository";
import { createMemoryUserBatchReader } from "../repositories/userBatchReader";
import { createMemoryUserRepository } from "../repositories/userRepository";
import { createMemoryScopeRouter } from "../scopeRouter";
import { createMemoryScopeTaskQueue } from "../scopeTaskQueue";
import { createMemoryScopeUnitOfWorkProvider } from "../scopeUnitOfWork";
import { MemoryBackend } from "../store";

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
  return {
    clock,
    globalUnitOfWork: createMemoryGlobalUnitOfWorkProvider(backend, {
      relayTrigger,
    }),
    scopeUnitOfWork: createMemoryScopeUnitOfWorkProvider(backend, {
      relayTrigger,
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
    accountDeletionManifestStore:
      createMemoryAccountDeletionManifestStore(backend),
    globalMaintenanceRunStore: createMemoryGlobalMaintenanceRunStore(backend),
    publicNoteProjectionWriter: createMemoryPublicNoteProjectionWriter(backend),
    publicNoteQueryService: createMemoryPublicNoteQueryService(backend),
    forScope(scope: ScopeKey) {
      const scopeStore = backend.scope(scope);
      return {
        noteRepository: createMemoryNoteRepository(scopeStore),
        noteRevisionRepository: createMemoryNoteRevisionRepository(scopeStore),
        scopeCleanupAdmissionStore:
          createMemoryScopeCleanupAdmissionStore(scopeStore),
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
        });
      }
    },
  };
}
