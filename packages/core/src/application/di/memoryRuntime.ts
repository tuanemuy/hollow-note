import { randomBytes } from "node:crypto";
import {
  createMemoryGlobalUnitOfWorkProvider,
  type MemoryUnitOfWorkOptions,
} from "@repo/core/adapters/memory/globalUnitOfWork";
import {
  createMemoryMailSender,
  type MemoryMailSender,
} from "@repo/core/adapters/memory/mailSender";
import { createMemoryObjectStorage } from "@repo/core/adapters/memory/objectStorage";
import { createScryptPasswordHasher } from "@repo/core/adapters/memory/passwordHasher";
import { createMemoryAccountDeletionManifestStore } from "@repo/core/adapters/memory/repositories/accountDeletionManifestStore";
import { createMemoryAuthTokenRepository } from "@repo/core/adapters/memory/repositories/authTokenRepository";
import { createMemoryDistributedOperationStore } from "@repo/core/adapters/memory/repositories/distributedOperationStore";
import { createMemoryGlobalMaintenanceRunStore } from "@repo/core/adapters/memory/repositories/globalMaintenanceRunStore";
import { createMemoryIdempotencyStore } from "@repo/core/adapters/memory/repositories/idempotencyStore";
import { createMemoryIdentityRemovalReceiptStore } from "@repo/core/adapters/memory/repositories/identityRemovalReceiptStore";
import { createMemoryIdentityRepository } from "@repo/core/adapters/memory/repositories/identityRepository";
import { createMemoryIdentityUniqueDirectory } from "@repo/core/adapters/memory/repositories/identityUniqueDirectory";
import { createMemoryInvitationRepository } from "@repo/core/adapters/memory/repositories/invitationRepository";
import { createMemoryInvitationRouteStore } from "@repo/core/adapters/memory/repositories/invitationRouteStore";
import { createMemoryLlmUsageRepository } from "@repo/core/adapters/memory/repositories/llmUsageRepository";
import { createMemoryLoginAttemptStore } from "@repo/core/adapters/memory/repositories/loginAttemptStore";
import { createMemoryMembershipDirectoryReservationStore } from "@repo/core/adapters/memory/repositories/membershipDirectoryReservationStore";
import { createMemoryMembershipRepository } from "@repo/core/adapters/memory/repositories/membershipRepository";
import { createMemoryPublicNoteProjectionWriter } from "@repo/core/adapters/memory/repositories/noteProjection";
import { createMemoryNoteRepository } from "@repo/core/adapters/memory/repositories/noteRepository";
import { createMemoryNoteRouteFanOutReader } from "@repo/core/adapters/memory/repositories/noteRouteFanOutReader";
import { createMemoryNoteRouteStore } from "@repo/core/adapters/memory/repositories/noteRouteStore";
import { createMemoryOAuthStateStore } from "@repo/core/adapters/memory/repositories/oauthStateStore";
import { createMemoryOutboxRepository } from "@repo/core/adapters/memory/repositories/outboxRepository";
import { createMemoryPublicWorkspaceDirectoryReader } from "@repo/core/adapters/memory/repositories/publicWorkspaceDirectoryReader";
import { createMemorySessionRepository } from "@repo/core/adapters/memory/repositories/sessionRepository";
import { createMemoryStorageQuotaRepository } from "@repo/core/adapters/memory/repositories/storageQuotaRepository";
import { createMemoryUserBatchReader } from "@repo/core/adapters/memory/repositories/userBatchReader";
import { createMemoryUserRepository } from "@repo/core/adapters/memory/repositories/userRepository";
import { createMemoryUserWorkspaceDirectory } from "@repo/core/adapters/memory/repositories/userWorkspaceDirectory";
import { createMemoryWorkspaceDirectoryBatchReader } from "@repo/core/adapters/memory/repositories/workspaceDirectoryBatchReader";
import { createMemoryWorkspaceDirectoryProjectionWriter } from "@repo/core/adapters/memory/repositories/workspaceDirectoryProjectionWriter";
import { createMemoryWorkspaceRepository } from "@repo/core/adapters/memory/repositories/workspaceRepository";
import { createMemoryWorkspaceSlugReservationStore } from "@repo/core/adapters/memory/repositories/workspaceSlugReservationStore";
import { createMemoryScopeRouter } from "@repo/core/adapters/memory/scopeRouter";
import { createMemoryScopeTaskQueue } from "@repo/core/adapters/memory/scopeTaskQueue";
import { createMemoryScopeUnitOfWorkProvider } from "@repo/core/adapters/memory/scopeUnitOfWork";
import { createNodeSecureTokenGenerator } from "@repo/core/adapters/memory/secureTokenGenerator";
import {
  createWebCryptoShareTokenProtector,
  type ShareTokenKeyRing,
} from "@repo/core/adapters/memory/shareTokenProtector";
import {
  MemoryBackend,
  type MemoryBackendOptions,
} from "@repo/core/adapters/memory/store";
import {
  createSignInOAuthClient,
  type OAuthRuntimeConfig,
} from "@repo/core/adapters/oauth/signInOAuthClient";
import {
  REQUIRED_FINALIZE_RECEIPTS,
  REQUIRED_PERSONAL_CLEANUP_COMPONENTS,
} from "../cleanup/participants";
import { ConsoleLogger } from "../ports/logger";
import type { RelayTrigger } from "../ports/relayTrigger";
import type { ScopeTaskTrigger } from "../ports/scopeTaskTrigger";
import type { ScopeKey } from "../scope";
import type {
  AppConfig,
  DeletionTicketKeyRing,
  NoteReader,
  RequestContainer,
  SharedDeps,
  UsageReader,
  WorkerContainer,
  WorkspaceReader,
} from "./types";

export type MemoryRuntimeOptions = MemoryBackendOptions &
  Readonly<{
    shareTokenKeyRing?: ShareTokenKeyRing;
    /**
     * Signing keys for the deletion status ticket. Left unset the
     * process mints its own, which is the right default for a
     * runtime whose data does not survive a restart either — but it does
     * mean a restart invalidates outstanding tickets.
     */
    deletionTicketKeyRing?: DeletionTicketKeyRing;
    routingGenerations?: readonly string[];
    /**
     * Which sign-in identity provider to talk to. Required and without a
     * default: the dev IdP signs in whoever asks, so "nobody
     * decided" must not resolve to it. The selection *rules* and their
     * startup guards still belong to the runtime env schema
     * (`di/serverNode.ts`) — every other caller states its choice.
     */
    oauth: OAuthRuntimeConfig;
  }>;

export type MemoryRuntime = Readonly<{
  backend: MemoryBackend;
  mailSender: MemoryMailSender;
  /**
   * Late-binds the relay trigger: the unit-of-work providers need a
   * trigger at construction while the worker runner that owns the real
   * one is built later from the worker container. Until bound, commits
   * simply wait for the runner's interval tick.
   */
  bindRelayTrigger: (trigger: RelayTrigger) => void;
  /** Same late binding for the scope-task runner's own trigger. */
  bindScopeTaskTrigger: (trigger: ScopeTaskTrigger) => void;
  createRequestContainer: (config: AppConfig) => RequestContainer;
  createWorkerContainer: () => WorkerContainer;
}>;

const ephemeralKeyRing = (): ShareTokenKeyRing => ({
  currentVersion: 1,
  keys: new Map([[1, new Uint8Array(randomBytes(32))]]),
});

/**
 * Composition root for the in-memory reference runtime (spec/adr/024): one
 * `MemoryBackend` shared by every adapter of the process, the same
 * wiring for `pnpm dev` and the usecase tests. Data lives for the
 * process lifetime only — a restart starts blank by design.
 */
export function createMemoryRuntime(
  options: MemoryRuntimeOptions,
): MemoryRuntime {
  const {
    shareTokenKeyRing,
    deletionTicketKeyRing,
    routingGenerations,
    oauth,
    ...backendOptions
  } = options;
  const backend = new MemoryBackend(backendOptions);

  // The key ring must share the backend's lifetime: minting it per
  // request would bind "version 1" to a fresh key on every request, so
  // a value protected in one request could never be revealed in another
  // (the 版→鍵 mapping of spec/presentation/index.md).
  const keyRing = shareTokenKeyRing ?? ephemeralKeyRing();
  // A separate ring, not a second use of the share-token one: the two
  // secrets protect different things and rotate independently.
  const ticketKeyRing: DeletionTicketKeyRing =
    deletionTicketKeyRing ?? ephemeralKeyRing();

  let boundTrigger: RelayTrigger | null = null;
  const relayTrigger: RelayTrigger = {
    kick(): void {
      boundTrigger?.kick();
    },
  };
  let boundScopeTaskTrigger: ScopeTaskTrigger | null = null;
  const scopeTaskTrigger: ScopeTaskTrigger = {
    kick(): void {
      boundScopeTaskTrigger?.kick();
    },
  };

  // The deployment's own cleanup declaration decides what a deletion
  // waits for; the stores never assume a participant exists.
  const unitOfWorkOptions: MemoryUnitOfWorkOptions = {
    relayTrigger,
    scopeTaskTrigger,
    requiredCleanupComponents: REQUIRED_PERSONAL_CLEANUP_COMPONENTS,
    requiredFinalizeReceipts: REQUIRED_FINALIZE_RECEIPTS,
  };

  // The logger records `mail.sent` for every delivery; the verification
  // link itself is only logged under `MEMORY_MAIL_LOG_ACTION_URL=true`,
  // since the action URL carries the raw one-shot token.
  const mailSender = createMemoryMailSender(ConsoleLogger);
  // One hasher per runtime, not per request: `signInWithPassword` memoizes
  // its timing-equalization dummy hash per hasher instance, so a fresh
  // instance on every request would re-derive that scrypt hash on every
  // unauthenticated attempt.
  const passwordHasher = createScryptPasswordHasher();
  const sessionRepository = createMemorySessionRepository(backend);
  const authTokenRepository = createMemoryAuthTokenRepository(backend);
  const loginAttemptStore = createMemoryLoginAttemptStore(backend);
  const oauthStateStore = createMemoryOAuthStateStore(backend);
  const distributedOperationStore =
    createMemoryDistributedOperationStore(backend);
  const identityRemovalReceiptStore =
    createMemoryIdentityRemovalReceiptStore(backend);
  const objectStorage = createMemoryObjectStorage(backend);

  const sharedDeps: SharedDeps = {
    clock: backend.clock,
    idGenerator: backend.idGenerator,
    // Logger is ambient console output in this runtime; tests override
    // via container spread when they need a recording logger.
    logger: ConsoleLogger,
  };

  const noteReaderFor = (scope: ScopeKey): NoteReader =>
    createMemoryNoteRepository(backend.scope(scope));

  const usageReaderFor = (scope: ScopeKey): UsageReader => {
    const scopeStore = backend.scope(scope);
    return {
      storageQuota: createMemoryStorageQuotaRepository(scopeStore),
      llmUsage: createMemoryLlmUsageRepository(scopeStore),
    };
  };

  const workspaceReaderFor = (scope: ScopeKey): WorkspaceReader => {
    const scopeStore = backend.scope(scope);
    return {
      workspace: createMemoryWorkspaceRepository(scopeStore),
      membership: createMemoryMembershipRepository(scopeStore),
      invitation: createMemoryInvitationRepository(scopeStore),
    };
  };

  return {
    backend,
    mailSender,
    bindRelayTrigger(trigger: RelayTrigger): void {
      boundTrigger = trigger;
    },
    bindScopeTaskTrigger(trigger: ScopeTaskTrigger): void {
      boundScopeTaskTrigger = trigger;
    },
    createRequestContainer(config: AppConfig): RequestContainer {
      return {
        ...sharedDeps,
        config,
        globalUnitOfWorkProvider: createMemoryGlobalUnitOfWorkProvider(
          backend,
          unitOfWorkOptions,
        ),
        scopeUnitOfWorkProvider: createMemoryScopeUnitOfWorkProvider(
          backend,
          unitOfWorkOptions,
        ),
        scopeRouter: createMemoryScopeRouter(backend),
        noteRouteStore: createMemoryNoteRouteStore(backend),
        identityUniqueDirectory: createMemoryIdentityUniqueDirectory(backend),
        loginAttemptStore,
        oauthStateStore,
        objectStorage,
        // Built per container because the dev IdP's consent screen lives
        // under the app's own origin, which only `config` knows.
        signInOAuthClient: createSignInOAuthClient(oauth, config.appUrl),
        oauthDevMode: oauth.mode === "dev",
        userReader: createMemoryUserRepository(backend),
        identityReader: createMemoryIdentityRepository(backend),
        sessionReader: sessionRepository,
        authTokenReader: authTokenRepository,
        deletionOperationReader: distributedOperationStore,
        noteReaderFor,
        usageReaderFor,
        workspaceReaderFor,
        userBatchReader: createMemoryUserBatchReader(backend),
        userWorkspaceDirectory: createMemoryUserWorkspaceDirectory(backend),
        workspaceDirectoryBatchReader:
          createMemoryWorkspaceDirectoryBatchReader(backend),
        publicWorkspaceDirectoryReader:
          createMemoryPublicWorkspaceDirectoryReader(backend),
        workspaceDirectoryProjectionWriter:
          createMemoryWorkspaceDirectoryProjectionWriter(backend),
        workspaceSlugReservationStore:
          createMemoryWorkspaceSlugReservationStore(backend),
        invitationRouteStore: createMemoryInvitationRouteStore(backend),
        membershipDirectoryReservationStore:
          createMemoryMembershipDirectoryReservationStore(backend),
        mailSender,
        passwordHasher,
        secureTokenGenerator: createNodeSecureTokenGenerator(),
        shareTokenProtector: createWebCryptoShareTokenProtector(keyRing),
        deletionTicketKeyRing: ticketKeyRing,
      };
    },
    createWorkerContainer(): WorkerContainer {
      return {
        ...sharedDeps,
        globalUnitOfWorkProvider: createMemoryGlobalUnitOfWorkProvider(
          backend,
          unitOfWorkOptions,
        ),
        scopeUnitOfWorkProvider: createMemoryScopeUnitOfWorkProvider(
          backend,
          unitOfWorkOptions,
        ),
        outboxRepository: createMemoryOutboxRepository(backend),
        idempotencyStore: createMemoryIdempotencyStore(backend),
        maintenanceRunStore: createMemoryGlobalMaintenanceRunStore(backend),
        identityUniqueDirectory: createMemoryIdentityUniqueDirectory(backend),
        identityRemovalReceiptStore,
        accountDeletionManifestStore: createMemoryAccountDeletionManifestStore(
          backend,
          {
            requiredFinalizeReceipts: REQUIRED_FINALIZE_RECEIPTS,
          },
        ),
        noteRouteFanOutReader: createMemoryNoteRouteFanOutReader(backend),
        noteRouteResolver: createMemoryNoteRouteStore(backend),
        publicNoteProjectionWriter:
          createMemoryPublicNoteProjectionWriter(backend),
        scopeTaskQueue: createMemoryScopeTaskQueue(backend),
        objectStorage,
        routingGenerations: routingGenerations ?? ["gen-1"],
        authStateSweeps: {
          sessions: sessionRepository,
          auth_tokens: authTokenRepository,
          login_attempts: loginAttemptStore,
          oauth_flow_states: oauthStateStore,
          identity_removal_receipts: identityRemovalReceiptStore,
        },
      };
    },
  };
}
