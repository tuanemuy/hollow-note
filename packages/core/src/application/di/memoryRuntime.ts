import { randomBytes } from "node:crypto";
import { createMemoryGlobalUnitOfWorkProvider } from "@repo/core/adapters/memory/globalUnitOfWork";
import {
  createMemoryMailSender,
  type MemoryMailSender,
} from "@repo/core/adapters/memory/mailSender";
import { createScryptPasswordHasher } from "@repo/core/adapters/memory/passwordHasher";
import { createMemoryAuthTokenRepository } from "@repo/core/adapters/memory/repositories/authTokenRepository";
import { createMemoryGlobalMaintenanceRunStore } from "@repo/core/adapters/memory/repositories/globalMaintenanceRunStore";
import { createMemoryIdempotencyStore } from "@repo/core/adapters/memory/repositories/idempotencyStore";
import { createMemoryIdentityRepository } from "@repo/core/adapters/memory/repositories/identityRepository";
import { createMemoryIdentityUniqueDirectory } from "@repo/core/adapters/memory/repositories/identityUniqueDirectory";
import { createMemoryLoginAttemptStore } from "@repo/core/adapters/memory/repositories/loginAttemptStore";
import { createMemoryNoteRepository } from "@repo/core/adapters/memory/repositories/noteRepository";
import { createMemoryNoteRouteStore } from "@repo/core/adapters/memory/repositories/noteRouteStore";
import { createMemoryOAuthStateStore } from "@repo/core/adapters/memory/repositories/oauthStateStore";
import { createMemoryOutboxRepository } from "@repo/core/adapters/memory/repositories/outboxRepository";
import { createMemorySessionRepository } from "@repo/core/adapters/memory/repositories/sessionRepository";
import { createMemoryUserRepository } from "@repo/core/adapters/memory/repositories/userRepository";
import { createMemoryScopeRouter } from "@repo/core/adapters/memory/scopeRouter";
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
import { ConsoleLogger } from "../ports/logger";
import type { RelayTrigger } from "../ports/relayTrigger";
import type { ScopeKey } from "../scope";
import type {
  AppConfig,
  NoteReader,
  RequestContainer,
  SharedDeps,
  WorkerContainer,
} from "./types";

export type MemoryRuntimeOptions = MemoryBackendOptions &
  Readonly<{
    shareTokenKeyRing?: ShareTokenKeyRing;
    routingGenerations?: readonly string[];
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
  createRequestContainer: (config: AppConfig) => RequestContainer;
  createWorkerContainer: () => WorkerContainer;
}>;

const ephemeralKeyRing = (): ShareTokenKeyRing => ({
  currentVersion: 1,
  keys: new Map([[1, new Uint8Array(randomBytes(32))]]),
});

/**
 * Composition root for the in-memory reference runtime (ADR 024): one
 * `MemoryBackend` shared by every adapter of the process, the same
 * wiring for `pnpm dev` and the usecase tests. Data lives for the
 * process lifetime only — a restart starts blank by design.
 */
export function createMemoryRuntime(
  options: MemoryRuntimeOptions = {},
): MemoryRuntime {
  const { shareTokenKeyRing, routingGenerations, ...backendOptions } = options;
  const backend = new MemoryBackend(backendOptions);

  // The key ring must share the backend's lifetime: minting it per
  // request would bind "version 1" to a fresh key on every request, so
  // a value protected in one request could never be revealed in another
  // (the 版→鍵 mapping of spec/presentation/index.md).
  const keyRing = shareTokenKeyRing ?? ephemeralKeyRing();

  let boundTrigger: RelayTrigger | null = null;
  const relayTrigger: RelayTrigger = {
    kick(): void {
      boundTrigger?.kick();
    },
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

  const sharedDeps: SharedDeps = {
    clock: backend.clock,
    idGenerator: backend.idGenerator,
    // Logger is ambient console output in this runtime; tests override
    // via container spread when they need a recording logger.
    logger: ConsoleLogger,
  };

  const noteReaderFor = (scope: ScopeKey): NoteReader =>
    createMemoryNoteRepository(backend.scope(scope));

  return {
    backend,
    mailSender,
    bindRelayTrigger(trigger: RelayTrigger): void {
      boundTrigger = trigger;
    },
    createRequestContainer(config: AppConfig): RequestContainer {
      return {
        ...sharedDeps,
        config,
        globalUnitOfWorkProvider: createMemoryGlobalUnitOfWorkProvider(
          backend,
          { relayTrigger },
        ),
        scopeUnitOfWorkProvider: createMemoryScopeUnitOfWorkProvider(backend, {
          relayTrigger,
        }),
        scopeRouter: createMemoryScopeRouter(backend),
        noteRouteStore: createMemoryNoteRouteStore(backend),
        identityUniqueDirectory: createMemoryIdentityUniqueDirectory(backend),
        loginAttemptStore,
        userReader: createMemoryUserRepository(backend),
        identityReader: createMemoryIdentityRepository(backend),
        sessionReader: sessionRepository,
        authTokenReader: authTokenRepository,
        noteReaderFor,
        mailSender,
        passwordHasher,
        secureTokenGenerator: createNodeSecureTokenGenerator(),
        shareTokenProtector: createWebCryptoShareTokenProtector(keyRing),
      };
    },
    createWorkerContainer(): WorkerContainer {
      return {
        ...sharedDeps,
        outboxRepository: createMemoryOutboxRepository(backend),
        idempotencyStore: createMemoryIdempotencyStore(backend),
        maintenanceRunStore: createMemoryGlobalMaintenanceRunStore(backend),
        routingGenerations: routingGenerations ?? ["gen-1"],
        authStateSweeps: {
          sessions: sessionRepository,
          auth_tokens: authTokenRepository,
          login_attempts: loginAttemptStore,
          oauth_flow_states: oauthStateStore,
        },
      };
    },
  };
}
