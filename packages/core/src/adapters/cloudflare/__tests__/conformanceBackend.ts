import { applyD1Migrations, env } from "cloudflare:test";
import { DEFAULT_MAINTENANCE_TABLES } from "../../../application/di/cloudflareRuntime";
import type {
  GlobalUnitOfWorkProvider,
  ScopeUnitOfWorkProvider,
} from "../../../application/execution/unitOfWork";
import type { MaintenanceKind } from "../../../application/ports/globalMaintenanceRunStore";
import { UuidV7Generator } from "../../../application/ports/idGenerator";
import type { RelayTrigger } from "../../../application/ports/relayTrigger";
import type { ScopeKey } from "../../../application/scope";
import { type DomainEvent, EventId } from "../../../domain/common/event";
import type { UserId } from "../../../domain/identity/valueObject";
import type { WorkspaceId } from "../../../domain/workspace/valueObject";
import type {
  ConformanceBackend,
  ConformanceBackendOptions,
  MembershipEdgeSeedInput,
  ScopedConformancePorts,
  WorkspaceDirectorySeedInput,
} from "../../conformance/backend";
import { createTestClock } from "../../conformance/testClock";
import { GLOBAL_TABLES, GLOBAL_WIPE_STATEMENTS } from "../d1/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import {
  createGlobalUnitOfWorkProvider,
  type GlobalPlaneRepositories,
} from "../execution/globalUnitOfWork";
import {
  createScopeUnitOfWorkProvider,
  type ScopePlaneRepositories,
} from "../execution/scopeUnitOfWork";
import { createD1Executor } from "../sql/executor";
import { insertRowsFromJson, jsonRows } from "../sql/json";
import { createAutocommitSession, type SqlSession } from "../sql/session";
import { statement } from "../sql/statement";
import type { CloudflareBackendDeps } from "./ports/deps";
import { createDirectoryPorts } from "./ports/directory";
import { createIdentityPorts } from "./ports/identity";
import {
  createGlobalProjectionPorts,
  createScopeProjectionPorts,
} from "./ports/projection";
import { createRoutePorts } from "./ports/route";
import { createScopeBusinessPorts } from "./ports/scopeBusiness";
import { createScopeInfraPorts } from "./ports/scopeInfra";
import {
  createWorkspaceDirectoryPorts,
  createWorkspaceReservationPorts,
  createWorkspaceScopePorts,
} from "./ports/workspace";

/**
 * `MakeConformanceBackend` for the Cloudflare adapters, running against
 * the real D1, Durable Object and R2 bindings of `wrangler.test.jsonc`.
 *
 * ## Freshness
 *
 * The suites contract for a **fresh backend per test**
 * (`conformance/backend.ts`), while the workers pool isolates storage per
 * **file**. The gap is closed here, per plane:
 *
 * - **Durable Objects** — every factory call takes a new namespace, and
 *   the namespace is part of the object's name. A new name is a new
 *   object, so the scope plane is genuinely empty; no wipe can be
 *   forgotten.
 * - **D1** — one database, wiped at the head of every factory call. The
 *   tables are small, which makes this cheaper than re-migrating.
 * - **R2** — one bucket, keys prefixed with the namespace.
 *
 * Production passes the same two arguments as empty strings, so it takes
 * the identical code path.
 *
 * The port implementations are grouped into `./ports/{bundle}.ts`, one
 * bundle per conformance test file under `./conformance/`.
 */
export async function makeCloudflareConformanceBackend(
  options: ConformanceBackendOptions = {},
): Promise<ConformanceBackend> {
  await migrateOnce();

  namespaceSeq += 1;
  const namespace = `cfx-${namespaceSeq}`;
  const clock = createTestClock();
  const globalExecutor = createD1Executor(env.GLOBAL_DB);
  await globalExecutor.apply(
    GLOBAL_WIPE_STATEMENTS.map((sql) => statement(sql)),
  );

  let relayKicks = 0;
  const relayTrigger: RelayTrigger = {
    kick: () => {
      relayKicks += 1;
    },
  };

  const deps: CloudflareBackendDeps = {
    db: env.GLOBAL_DB,
    bucket: env.OBJECT_STORAGE,
    scopeObjects: env.SCOPE_OBJECT,
    namespace,
    objectKeyPrefix: `${namespace}/`,
    clock,
    idGenerator: UuidV7Generator,
    maintenanceShardIds: options.maintenanceShardIds ?? ["shard-0"],
    maintenanceTablesByKind: {
      ...DEFAULT_MAINTENANCE_TABLES,
      ...options.maintenanceTablesByKind,
    },
    workspaceDirectoryOutages: new Set<string>(),
    requiredCleanupComponents: options.requiredCleanupComponents,
    requiredFinalizeReceipts: options.requiredFinalizeReceipts,
  };

  const globalSession = createAutocommitSession(globalExecutor);
  const globalDeps = { ...deps, session: globalSession };
  const identity = createIdentityPorts(globalDeps);
  const directory = createDirectoryPorts(globalDeps);
  const route = createRoutePorts(globalDeps);
  const projection = createGlobalProjectionPorts(globalDeps);
  const workspaceDirectory = createWorkspaceDirectoryPorts(globalDeps);
  const workspaceReservations = createWorkspaceReservationPorts(globalDeps);

  const scopeExecutorFor = (scope: ScopeKey) =>
    createScopeStubExecutor(env.SCOPE_OBJECT, scope, namespace);

  const scopePortsOver = (
    session: SqlSession,
    scope: ScopeKey,
  ): ScopedConformancePorts => {
    const scopeDeps = { ...deps, session, scope };
    return {
      ...createScopeBusinessPorts(scopeDeps),
      ...createScopeInfraPorts(scopeDeps),
      ...createScopeProjectionPorts(scopeDeps),
      ...createWorkspaceScopePorts(scopeDeps),
    };
  };

  const mintEventId = (): EventId => EventId.create(deps.idGenerator.next());

  /**
   * Both planes stage the outbox flush through the same
   * `OutboxRepository`: the two `outbox_events` tables are identically
   * shaped, and the repository is built over whichever session it is
   * handed.
   */
  const stageOutbox = async (
    session: SqlSession,
    events: readonly DomainEvent[],
  ): Promise<void> => {
    await createRoutePorts({ ...deps, session }).outboxRepository.save(events);
  };

  const globalUnitOfWork: GlobalUnitOfWorkProvider =
    createGlobalUnitOfWorkProvider({
      executor: globalExecutor,
      mintEventId,
      buildRepositories: (session): GlobalPlaneRepositories => {
        const staged = { ...deps, session };
        const stagedIdentity = createIdentityPorts(staged);
        const stagedDirectory = createDirectoryPorts(staged);
        const stagedWorkspaceDirectory = createWorkspaceDirectoryPorts(staged);
        const stagedWorkspaceReservations =
          createWorkspaceReservationPorts(staged);
        return {
          userRepository: stagedIdentity.userRepository,
          identityRepository: stagedIdentity.identityRepository,
          sessionRepository: stagedIdentity.sessionRepository,
          authTokenRepository: stagedIdentity.authTokenRepository,
          identityRemovalReceiptStore:
            stagedIdentity.identityRemovalReceiptStore,
          identityUniqueDirectory: stagedDirectory.identityUniqueDirectory,
          distributedOperationStore: stagedDirectory.distributedOperationStore,
          accountDeletionManifestStore:
            stagedDirectory.accountDeletionManifestStore,
          settledMembershipReader:
            stagedWorkspaceDirectory.userWorkspaceDirectory,
          activatingMembershipReader:
            stagedWorkspaceReservations.membershipDirectoryReservationStore,
        };
      },
      stageOutbox,
      relayTrigger,
    });

  const scopeUnitOfWork: ScopeUnitOfWorkProvider =
    createScopeUnitOfWorkProvider({
      openScope: scopeExecutorFor,
      mintEventId,
      buildRepositories: (session, scope): ScopePlaneRepositories => {
        const scoped = scopePortsOver(session, scope);
        return {
          noteRepository: scoped.noteRepository,
          noteRevisionRepository: scoped.noteRevisionRepository,
          cleanupAdmission: scoped.scopeCleanupAdmissionStore,
          noteProjectionRevisionStore: scoped.noteProjectionRevisionStore,
          localNoteProjectionWriter: scoped.localNoteProjectionWriter,
          scopeTaskScheduler: scoped.scopeTaskScheduler,
          appliedOperationStore: scoped.appliedOperationStore,
          storageQuotaRepository: scoped.storageQuotaRepository,
          llmUsageRepository: scoped.llmUsageRepository,
          storedFileRepository: scoped.storedFileRepository,
          workspaceRepository: scoped.workspaceRepository,
          membershipRepository: scoped.membershipRepository,
          invitationRepository: scoped.invitationRepository,
          membershipRemovalPreparationStore:
            scoped.membershipRemovalPreparationStore,
          workspaceOperationLockStore: scoped.workspaceOperationLockStore,
          workspaceDeletionManifestStore: scoped.workspaceDeletionManifestStore,
        };
      },
      stageOutbox,
      relayTrigger,
    });

  return {
    clock,
    globalUnitOfWork,
    scopeUnitOfWork,
    relayKickCount: () => relayKicks,
    userRepository: identity.userRepository,
    identityRepository: identity.identityRepository,
    sessionRepository: identity.sessionRepository,
    authTokenRepository: identity.authTokenRepository,
    identityRemovalReceiptStore: identity.identityRemovalReceiptStore,
    userBatchReader: identity.userBatchReader,
    loginAttemptStore: identity.loginAttemptStore,
    oauthStateStore: identity.oauthStateStore,
    identityUniqueDirectory: directory.identityUniqueDirectory,
    distributedOperationStore: directory.distributedOperationStore,
    accountDeletionManifestStore: directory.accountDeletionManifestStore,
    globalMaintenanceRunStore: directory.globalMaintenanceRunStore,
    noteRouteStore: route.noteRouteStore,
    noteRouteFanOutReader: route.noteRouteFanOutReader,
    outboxRepository: route.outboxRepository,
    idempotencyStore: route.idempotencyStore,
    scopeRouter: route.scopeRouter,
    scopeTaskQueue: route.scopeTaskQueue,
    publicNoteProjectionWriter: projection.publicNoteProjectionWriter,
    publicNoteQueryService: projection.publicNoteQueryService,
    objectStorage: projection.objectStorage,
    userWorkspaceDirectory: workspaceDirectory.userWorkspaceDirectory,
    workspaceDirectoryBatchReader:
      workspaceDirectory.workspaceDirectoryBatchReader,
    publicWorkspaceDirectoryReader:
      workspaceDirectory.publicWorkspaceDirectoryReader,
    workspaceDirectoryProjectionWriter:
      workspaceDirectory.workspaceDirectoryProjectionWriter,
    invitationRouteStore: workspaceReservations.invitationRouteStore,
    membershipDirectoryReservationStore:
      workspaceReservations.membershipDirectoryReservationStore,
    workspaceSlugReservationStore:
      workspaceReservations.workspaceSlugReservationStore,
    forScope(scope: ScopeKey): ScopedConformancePorts {
      return scopePortsOver(
        createAutocommitSession(scopeExecutorFor(scope)),
        scope,
      );
    },
    /**
     * Writes `workspace_directory` rows directly, for the reason
     * `ConformanceBackend` gives: the readers' cases pin columns
     * `WorkspaceDirectoryProjectionWriter` derives, and combine states it
     * would never produce together. The table itself is real
     * (`d1/migrations/0002_workspace_directory.sql`) and the readers go
     * through it exactly as they will in production.
     */
    async seedWorkspaceDirectory(
      entries: readonly WorkspaceDirectorySeedInput[],
    ): Promise<void> {
      if (entries.length === 0) {
        return;
      }
      await globalExecutor.apply([
        statement(
          insertRowsFromJson({
            table: GLOBAL_TABLES.workspaceDirectory,
            columns: [
              "workspace_id",
              "name",
              "slug",
              "publication",
              "lifecycle",
              "deletion_operation_id",
              "avatar_url",
              "source_version",
              "updated_at",
            ],
            conflictKey: ["workspace_id"],
            conflict: [
              "name",
              "slug",
              "publication",
              "lifecycle",
              "deletion_operation_id",
              "avatar_url",
              "source_version",
              "updated_at",
            ],
          }),
          jsonRows(
            entries.map((entry) => ({
              workspace_id: entry.workspaceId,
              name: entry.name,
              slug: entry.slug,
              publication: entry.publication,
              lifecycle: entry.lifecycle,
              deletion_operation_id:
                entry.lifecycle === "deleting"
                  ? (entry.deletionOperationId ??
                    `deletion-${entry.workspaceId}`)
                  : null,
              avatar_url: entry.avatarUrl,
              source_version: entry.sourceVersion,
              updated_at: entry.updatedAt.getTime(),
            })),
          ),
        ),
      ]);
    },
    async makeWorkspaceDirectoryUnreadable(
      ids: readonly WorkspaceId[],
    ): Promise<void> {
      for (const id of ids) {
        deps.workspaceDirectoryOutages.add(id);
      }
    },
    /**
     * Writes `membership_directory` rows directly: the writer is
     * `MembershipDirectoryReservationStore`, which is not part of the two
     * contracts that read these rows, but the table is real
     * (`d1/migrations/0001_global_schema.sql`) and both
     * `AccountDeletionManifestStore.appendMembershipPage` and
     * `UserWorkspaceDirectory.listActiveByUser` read it exactly as they
     * will in production. The seed's `edgeKey` is the row's
     * `operation_id`, which is the key that page walks.
     */
    async seedMembershipEdges(
      userId: UserId,
      edges: readonly MembershipEdgeSeedInput[],
    ): Promise<void> {
      if (edges.length === 0) {
        return;
      }
      const now = clock.now().getTime();
      await globalExecutor.apply([
        statement(
          insertRowsFromJson({
            table: GLOBAL_TABLES.membershipDirectory,
            columns: [
              "operation_id",
              "user_id",
              "workspace_id",
              "membership_id",
              "role",
              "state",
              "reservation_expires_at",
              "created_at",
              "updated_at",
            ],
            conflictKey: ["operation_id"],
            conflict: "ignore",
          }),
          jsonRows(
            edges.map((edge) => ({
              operation_id: edge.edgeKey,
              user_id: userId,
              workspace_id: edge.workspaceId,
              membership_id: edge.membershipId,
              role: edge.role ?? "viewer",
              state: edge.edgeState,
              reservation_expires_at:
                edge.edgeState === "pending" || edge.edgeState === "activating"
                  ? now + HOUR_MS
                  : null,
              created_at: edge.createdAt?.getTime() ?? now,
              updated_at: now,
            })),
          ),
        ),
      ]);
    },
    async setMaintenanceTables(
      kind: MaintenanceKind,
      tables: readonly string[],
    ): Promise<void> {
      // Written in place, exactly as a mid-run deploy would: a run
      // snapshots the set when it is created, so only runs created after
      // this call see the change (ADR 061).
      deps.maintenanceTablesByKind[kind] = tables;
    },
  };
}

const HOUR_MS = 60 * 60 * 1000;

let namespaceSeq = 0;
let migration: Promise<void> | null = null;

/** Migrations apply once per test file; each file gets its own isolate. */
const migrateOnce = (): Promise<void> => {
  migration ??= applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  return migration;
};
