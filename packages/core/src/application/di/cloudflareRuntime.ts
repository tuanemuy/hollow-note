import { createD1AccountDeletionManifestStore } from "../../adapters/cloudflare/d1/repositories/accountDeletionManifestStore";
import { createD1AuthTokenRepository } from "../../adapters/cloudflare/d1/repositories/authTokenRepository";
import { createD1DistributedOperationStore } from "../../adapters/cloudflare/d1/repositories/distributedOperationStore";
import { createD1GlobalMaintenanceRunStore } from "../../adapters/cloudflare/d1/repositories/globalMaintenanceRunStore";
import { createD1IdempotencyStore } from "../../adapters/cloudflare/d1/repositories/idempotencyStore";
import { createD1IdentityRemovalReceiptStore } from "../../adapters/cloudflare/d1/repositories/identityRemovalReceiptStore";
import { createD1IdentityRepository } from "../../adapters/cloudflare/d1/repositories/identityRepository";
import { createD1IdentityUniqueDirectory } from "../../adapters/cloudflare/d1/repositories/identityUniqueDirectory";
import { createD1LoginAttemptStore } from "../../adapters/cloudflare/d1/repositories/loginAttemptStore";
import { createD1NoteRouteFanOutReader } from "../../adapters/cloudflare/d1/repositories/noteRouteFanOutReader";
import { createD1NoteRouteStore } from "../../adapters/cloudflare/d1/repositories/noteRouteStore";
import { createD1OAuthStateStore } from "../../adapters/cloudflare/d1/repositories/oauthStateStore";
import { createD1OutboxRepository } from "../../adapters/cloudflare/d1/repositories/outboxRepository";
import { createD1PublicNoteProjectionWriter } from "../../adapters/cloudflare/d1/repositories/publicNoteProjection";
import { createD1SessionRepository } from "../../adapters/cloudflare/d1/repositories/sessionRepository";
import { createD1UserRepository } from "../../adapters/cloudflare/d1/repositories/userRepository";
import { createCloudflareAppliedOperationStore } from "../../adapters/cloudflare/do/repositories/appliedOperationStore";
import { createCloudflareLlmUsageRepository } from "../../adapters/cloudflare/do/repositories/llmUsageRepository";
import {
  createScopeLocalNoteProjectionWriter,
  createScopeNoteProjectionRevisionStore,
} from "../../adapters/cloudflare/do/repositories/noteProjection";
import { createCloudflareNoteRepository } from "../../adapters/cloudflare/do/repositories/noteRepository";
import { createCloudflareNoteRevisionRepository } from "../../adapters/cloudflare/do/repositories/noteRevisionRepository";
import { createCloudflareScopeCleanupAdmissionStore } from "../../adapters/cloudflare/do/repositories/scopeCleanupAdmissionStore";
import { createCloudflareScopeTaskScheduler } from "../../adapters/cloudflare/do/repositories/scopeTaskScheduler";
import { createCloudflareStorageQuotaRepository } from "../../adapters/cloudflare/do/repositories/storageQuotaRepository";
import { createCloudflareStoredFileRepository } from "../../adapters/cloudflare/do/repositories/storedFileRepository";
import type { ScopeObjectNamespace } from "../../adapters/cloudflare/do/scopeStub";
import { createScopeStubExecutor } from "../../adapters/cloudflare/do/scopeStub";
import {
  createGlobalUnitOfWorkProvider,
  type GlobalPlaneRepositories,
} from "../../adapters/cloudflare/execution/globalUnitOfWork";
import {
  createScopeUnitOfWorkProvider,
  type ScopePlaneRepositories,
} from "../../adapters/cloudflare/execution/scopeUnitOfWork";
import { createR2ObjectStorage } from "../../adapters/cloudflare/r2/objectStorage";
import { createCloudflareScopeRouter } from "../../adapters/cloudflare/scopeRouter";
import { createCloudflareScopeTaskQueue } from "../../adapters/cloudflare/scopeTaskQueue";
import { createD1Executor } from "../../adapters/cloudflare/sql/executor";
import {
  createAutocommitSession,
  type SqlSession,
} from "../../adapters/cloudflare/sql/session";
import { createScryptPasswordHasher } from "../../adapters/memory/passwordHasher";
import { createNodeSecureTokenGenerator } from "../../adapters/memory/secureTokenGenerator";
import {
  createWebCryptoShareTokenProtector,
  type ShareTokenKeyRing,
} from "../../adapters/memory/shareTokenProtector";
import {
  createSignInOAuthClient,
  type OAuthRuntimeConfig,
} from "../../adapters/oauth/signInOAuthClient";
import type { DomainEvent } from "../../domain/common/event";
import { EventId } from "../../domain/common/event";
import {
  REQUIRED_FINALIZE_RECEIPTS,
  REQUIRED_PERSONAL_CLEANUP_COMPONENTS,
} from "../cleanup/participants";
import type { Clock } from "../ports/clock";
import { SystemClock } from "../ports/clock";
import type { MaintenanceKind } from "../ports/globalMaintenanceRunStore";
import type { IdGenerator } from "../ports/idGenerator";
import { UuidV7Generator } from "../ports/idGenerator";
import type { Logger } from "../ports/logger";
import { ConsoleLogger } from "../ports/logger";
import type { MailSender } from "../ports/mailSender";
import type { RelayTrigger } from "../ports/relayTrigger";
import type { ScopeTaskTrigger } from "../ports/scopeTaskTrigger";
import type { ScopeKey } from "../scope";
import type { AppRuntime } from "./runtime";
import type {
  AppConfig,
  DeletionTicketKeyRing,
  NoteReader,
  RequestContainer,
  SharedDeps,
  UsageReader,
  WorkerContainer,
} from "./types";

/** The three bindings the adapter group needs from `wrangler.jsonc`. */
export type CloudflareBindings = Readonly<{
  GLOBAL_DB: D1Database;
  SCOPE_OBJECT: ScopeObjectNamespace;
  OBJECT_STORAGE: R2Bucket;
}>;

export type CloudflareRuntimeOptions = Readonly<{
  bindings: CloudflareBindings;
  /**
   * Which sign-in identity provider to talk to. Required and without a
   * default, for the same reason as the memory runtime: the dev IdP
   * signs in whoever asks, so "nobody decided" must not resolve to it.
   */
  oauth: OAuthRuntimeConfig;
  /**
   * Required, because there is no Cloudflare `MailSender` adapter in
   * this slice. Stating it as an option rather than defaulting to a
   * logging stand-in keeps the gap visible at the composition root
   * instead of turning verification mail into a silent no-op.
   */
  mailSender: MailSender;
  /** Public domain the object bucket is served from, no trailing slash. */
  objectStoragePublicBaseUrl: string;
  shareTokenKeyRing?: ShareTokenKeyRing;
  deletionTicketKeyRing?: DeletionTicketKeyRing;
  routingGenerations?: readonly string[];
  /** Logical shard ids the global maintenance lanes fan out over. */
  maintenanceShardIds?: readonly string[];
  /** Ordered sweep tables per maintenance kind. */
  maintenanceTablesByKind?: Partial<Record<MaintenanceKind, readonly string[]>>;
  clock?: Clock;
  idGenerator?: IdGenerator;
  logger?: Logger;
  /**
   * Durable Object name prefix and R2 key prefix. Both are `""` in
   * production and set only where one deployment's storage has to be
   * kept apart from another's inside the same bindings
   * ([ADR 004](../../../../.thread/11/adr.md)).
   */
  objectNamespace?: string;
  objectKeyPrefix?: string;
}>;

export type CloudflareRuntime = AppRuntime;

const DEFAULT_MAINTENANCE_TABLES: Record<MaintenanceKind, readonly string[]> = {
  authStatePrune: [
    "auth_tokens",
    "sessions",
    "login_attempts",
    "oauth_flow_states",
    "identity_removal_receipts",
  ],
  jobTombstonePrune: ["job_tombstones"],
  accountManifestPrune: ["account_deletion_manifests"],
};

const ephemeralKeyRing = (): ShareTokenKeyRing => ({
  currentVersion: 1,
  keys: new Map([[1, crypto.getRandomValues(new Uint8Array(32))]]),
});

/**
 * Composition root for the Cloudflare backend: global D1, one SQLite
 * Durable Object per scope, and R2 for the bytes.
 *
 * Unlike the memory runtime there is no process-wide store to hold — the
 * bindings *are* the state — so this returns the same four methods over
 * whatever `env` the entry point was handed. Both container factories
 * build their global-plane ports over a fresh autocommit session, which
 * is what keeps a request's reads out of another request's write-set.
 *
 * The relay and scope-task triggers are late-bound exactly as in the
 * Node runtime. A Cloudflare deployment binds them to Queue producers;
 * until it does, a commit that flushed events leaves the row for the
 * next scheduled relay tick rather than kicking one.
 */
export function createCloudflareRuntime(
  options: CloudflareRuntimeOptions,
): CloudflareRuntime {
  const { bindings, oauth } = options;
  const clock = options.clock ?? SystemClock;
  const idGenerator = options.idGenerator ?? UuidV7Generator;
  const logger = options.logger ?? ConsoleLogger;
  const objectNamespace = options.objectNamespace ?? "";
  const keyPrefix = options.objectKeyPrefix ?? "";
  const maintenanceShardIds = options.maintenanceShardIds ?? ["shard-0"];
  const maintenanceTablesByKind: Record<MaintenanceKind, readonly string[]> = {
    ...DEFAULT_MAINTENANCE_TABLES,
    ...options.maintenanceTablesByKind,
  };

  // Both rings must outlive a single request for the same reason as in
  // the memory runtime: version 1 has to mean the same key on the
  // request that reveals a value as on the one that protected it.
  const shareTokenKeyRing = options.shareTokenKeyRing ?? ephemeralKeyRing();
  const deletionTicketKeyRing =
    options.deletionTicketKeyRing ?? ephemeralKeyRing();

  let boundRelayTrigger: RelayTrigger | null = null;
  const relayTrigger: RelayTrigger = {
    kick(): void {
      boundRelayTrigger?.kick();
    },
  };
  let boundScopeTaskTrigger: ScopeTaskTrigger | null = null;
  const scopeTaskTrigger: ScopeTaskTrigger = {
    kick(): void {
      boundScopeTaskTrigger?.kick();
    },
  };

  const globalExecutor = createD1Executor(bindings.GLOBAL_DB);
  const globalSession = (): SqlSession =>
    createAutocommitSession(globalExecutor);
  const scopeExecutorFor = (scope: ScopeKey) =>
    createScopeStubExecutor(bindings.SCOPE_OBJECT, scope, objectNamespace);
  const scopeSessionFor = (scope: ScopeKey): SqlSession =>
    createAutocommitSession(scopeExecutorFor(scope));

  const objectStorage = createR2ObjectStorage({
    bucket: bindings.OBJECT_STORAGE,
    publicBaseUrl: options.objectStoragePublicBaseUrl,
    keyPrefix,
  });

  const passwordHasher = createScryptPasswordHasher();
  const secureTokenGenerator = createNodeSecureTokenGenerator();
  const shareTokenProtector =
    createWebCryptoShareTokenProtector(shareTokenKeyRing);

  const sharedDeps: SharedDeps = { clock, idGenerator, logger };

  const mintEventId = (): EventId => EventId.create(idGenerator.next());

  /**
   * Both planes stage their flush through the same `OutboxRepository`:
   * the two `outbox_events` tables are identically shaped and the
   * repository is built over whichever session it is handed.
   */
  const stageOutbox = async (
    session: SqlSession,
    events: readonly DomainEvent[],
  ): Promise<void> => {
    await createD1OutboxRepository({ session, clock }).save(events);
  };

  const globalUnitOfWorkProvider = () =>
    createGlobalUnitOfWorkProvider({
      executor: globalExecutor,
      mintEventId,
      buildRepositories: (session): GlobalPlaneRepositories => ({
        userRepository: createD1UserRepository({ session }),
        identityRepository: createD1IdentityRepository({ session }),
        sessionRepository: createD1SessionRepository({ session }),
        authTokenRepository: createD1AuthTokenRepository({ session }),
        identityRemovalReceiptStore: createD1IdentityRemovalReceiptStore({
          session,
        }),
        identityUniqueDirectory: createD1IdentityUniqueDirectory({
          session,
          clock,
          idGenerator,
        }),
        distributedOperationStore: createD1DistributedOperationStore({
          session,
          clock,
          idGenerator,
        }),
        accountDeletionManifestStore: createD1AccountDeletionManifestStore({
          session,
          clock,
          requiredFinalizeReceipts: REQUIRED_FINALIZE_RECEIPTS,
        }),
      }),
      stageOutbox,
      relayTrigger,
    });

  const scopeUnitOfWorkProvider = () =>
    createScopeUnitOfWorkProvider({
      openScope: scopeExecutorFor,
      mintEventId,
      buildRepositories: (session, scope): ScopePlaneRepositories => ({
        noteRepository: createCloudflareNoteRepository({ session, scope }),
        noteRevisionRepository: createCloudflareNoteRevisionRepository({
          session,
        }),
        cleanupAdmission: createCloudflareScopeCleanupAdmissionStore({
          session,
          clock,
          requiredComponents: REQUIRED_PERSONAL_CLEANUP_COMPONENTS,
        }),
        noteProjectionRevisionStore:
          createScopeNoteProjectionRevisionStore(session),
        localNoteProjectionWriter:
          createScopeLocalNoteProjectionWriter(session),
        scopeTaskScheduler: createCloudflareScopeTaskScheduler({
          session,
          scope,
          db: bindings.GLOBAL_DB,
        }),
        appliedOperationStore: createCloudflareAppliedOperationStore({
          session,
          clock,
        }),
        storageQuotaRepository: createCloudflareStorageQuotaRepository({
          session,
        }),
        llmUsageRepository: createCloudflareLlmUsageRepository({ session }),
        storedFileRepository: createCloudflareStoredFileRepository({ session }),
      }),
      stageOutbox,
      relayTrigger,
      scopeTaskTrigger,
    });

  const noteReaderFor = (scope: ScopeKey): NoteReader =>
    createCloudflareNoteRepository({ session: scopeSessionFor(scope), scope });

  const usageReaderFor = (scope: ScopeKey): UsageReader => {
    const session = scopeSessionFor(scope);
    return {
      storageQuota: createCloudflareStorageQuotaRepository({ session }),
      llmUsage: createCloudflareLlmUsageRepository({ session }),
    };
  };

  return {
    bindRelayTrigger(trigger: RelayTrigger): void {
      boundRelayTrigger = trigger;
    },
    bindScopeTaskTrigger(trigger: ScopeTaskTrigger): void {
      boundScopeTaskTrigger = trigger;
    },

    createRequestContainer(config: AppConfig): RequestContainer {
      const session = globalSession();
      return {
        ...sharedDeps,
        config,
        globalUnitOfWorkProvider: globalUnitOfWorkProvider(),
        scopeUnitOfWorkProvider: scopeUnitOfWorkProvider(),
        scopeRouter: createCloudflareScopeRouter({
          session,
          clock,
          scopeObjects: bindings.SCOPE_OBJECT,
          namespace: objectNamespace,
        }),
        noteRouteStore: createD1NoteRouteStore({ session, clock }),
        identityUniqueDirectory: createD1IdentityUniqueDirectory({
          session,
          clock,
          idGenerator,
        }),
        loginAttemptStore: createD1LoginAttemptStore({ session, clock }),
        oauthStateStore: createD1OAuthStateStore({ session, clock }),
        objectStorage,
        signInOAuthClient: createSignInOAuthClient(oauth, config.appUrl),
        oauthDevMode: oauth.mode === "dev",
        userReader: createD1UserRepository({ session }),
        identityReader: createD1IdentityRepository({ session }),
        sessionReader: createD1SessionRepository({ session }),
        authTokenReader: createD1AuthTokenRepository({ session }),
        deletionOperationReader: createD1DistributedOperationStore({
          session,
          clock,
          idGenerator,
        }),
        noteReaderFor,
        usageReaderFor,
        mailSender: options.mailSender,
        passwordHasher,
        secureTokenGenerator,
        shareTokenProtector,
        deletionTicketKeyRing,
      };
    },

    createWorkerContainer(): WorkerContainer {
      const session = globalSession();
      const sessions = createD1SessionRepository({ session });
      const authTokens = createD1AuthTokenRepository({ session });
      const loginAttempts = createD1LoginAttemptStore({ session, clock });
      const oauthStates = createD1OAuthStateStore({ session, clock });
      const removalReceipts = createD1IdentityRemovalReceiptStore({ session });
      return {
        ...sharedDeps,
        globalUnitOfWorkProvider: globalUnitOfWorkProvider(),
        scopeUnitOfWorkProvider: scopeUnitOfWorkProvider(),
        outboxRepository: createD1OutboxRepository({ session, clock }),
        idempotencyStore: createD1IdempotencyStore({ session, clock }),
        maintenanceRunStore: createD1GlobalMaintenanceRunStore({
          session,
          clock,
          maintenanceShardIds,
          maintenanceTablesByKind,
        }),
        identityUniqueDirectory: createD1IdentityUniqueDirectory({
          session,
          clock,
          idGenerator,
        }),
        identityRemovalReceiptStore: removalReceipts,
        accountDeletionManifestStore: createD1AccountDeletionManifestStore({
          session,
          clock,
          requiredFinalizeReceipts: REQUIRED_FINALIZE_RECEIPTS,
        }),
        noteRouteFanOutReader: createD1NoteRouteFanOutReader({ session }),
        noteRouteResolver: createD1NoteRouteStore({ session, clock }),
        publicNoteProjectionWriter: createD1PublicNoteProjectionWriter(session),
        scopeTaskQueue: createCloudflareScopeTaskQueue({ session }),
        objectStorage,
        routingGenerations: options.routingGenerations ?? ["gen-1"],
        authStateSweeps: {
          sessions,
          auth_tokens: authTokens,
          login_attempts: loginAttempts,
          oauth_flow_states: oauthStates,
          identity_removal_receipts: removalReceipts,
        },
      };
    },
  };
}
