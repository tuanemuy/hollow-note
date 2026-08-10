import type { PrunePage } from "@repo/core/domain/common/pagination";
import type { AuthTokenRepository } from "@repo/core/domain/identity/ports/authTokenRepository";
import type { IdentityRepository } from "@repo/core/domain/identity/ports/identityRepository";
import type { IdentityUniqueDirectory } from "@repo/core/domain/identity/ports/identityUniqueDirectory";
import type { LoginAttemptStore } from "@repo/core/domain/identity/ports/loginAttemptStore";
import type { PasswordHasher } from "@repo/core/domain/identity/ports/passwordHasher";
import type { SecureTokenGenerator } from "@repo/core/domain/identity/ports/secureTokenGenerator";
import type { SessionRepository } from "@repo/core/domain/identity/ports/sessionRepository";
import type { SignInOAuthClient } from "@repo/core/domain/identity/ports/signInOAuthClient";
import type { UserRepository } from "@repo/core/domain/identity/ports/userRepository";
import type { NoteRepository } from "@repo/core/domain/note/ports/noteRepository";
import type { LlmUsageRepository } from "@repo/core/domain/usage/ports/llmUsageRepository";
import type { StorageQuotaRepository } from "@repo/core/domain/usage/ports/storageQuotaRepository";
import type {
  GlobalUnitOfWorkProvider,
  ScopeUnitOfWorkProvider,
} from "../execution/unitOfWork";
import type { AccountDeletionManifestStore } from "../ports/accountDeletionManifestStore";
import type { Clock } from "../ports/clock";
import type { DistributedOperationStore } from "../ports/distributedOperationStore";
import type { GlobalMaintenanceRunStore } from "../ports/globalMaintenanceRunStore";
import type { IdempotencyStore } from "../ports/idempotencyStore";
import type { IdentityRemovalReceiptStore } from "../ports/identityRemovalReceiptStore";
import type { IdGenerator } from "../ports/idGenerator";
import type { Logger } from "../ports/logger";
import type { MailSender } from "../ports/mailSender";
import type { NoteRouteStore } from "../ports/noteRouteStore";
import type { OAuthStateStore } from "../ports/oauthStateStore";
import type { ObjectStorage } from "../ports/objectStorage";
import type { OutboxRepository } from "../ports/outboxRepository";
import type { ScopeRouter } from "../ports/scopeRouter";
import type { ScopeTaskQueue } from "../ports/scopeTaskQueue";
import type { ShareTokenProtector } from "../ports/shareTokenProtector";
import type { ScopeKey } from "../scope";

export type AppConfig = Readonly<{
  appUrl: string;
  siteName: string;
  defaultTitle: string;
  defaultDescription: string;
  twitterHandle?: string;
  themeColor: string;
}>;

/**
 * Cross-cutting deterministic deps shared between request and worker
 * containers. Held as ports so domain / application code stays free of
 * ambient time, id generation, and IO sinks.
 */
export type SharedDeps = Readonly<{
  clock: Clock;
  idGenerator: IdGenerator;
  logger: Logger;
}>;

/**
 * Read-side (non-transactional) views over the global-plane aggregates.
 *
 * These are the only repository surfaces exposed outside a unit of work:
 * the `Pick`s deliberately drop every OCC write method, so a usecase that
 * wants to mutate is forced through `globalUnitOfWorkProvider.run`.
 */
export type UserReader = Pick<UserRepository, "findById">;
export type IdentityReader = Pick<IdentityRepository, "listByUserId">;
/**
 * `deleteById` is included because expired-session cleanup during
 * `authenticateSession` is spec'd as a best-effort delete outside any
 * unit of work (the row is create/delete-only and carries no OCC).
 */
export type SessionReader = Pick<
  SessionRepository,
  "findByTokenHash" | "deleteById"
>;
export type AuthTokenReader = Pick<AuthTokenRepository, "findByTokenHash">;
/**
 * Read view over the deletion control plane. Progress polling runs after
 * the session is gone, so it must not travel through a write unit of
 * work; the `Pick` is what keeps it a read.
 */
export type DeletionOperationReader = Pick<
  DistributedOperationStore,
  "findByOperationId"
>;
/** Scope-bound read view over notes for detail / minimal-list reads. */
export type NoteReader = Pick<
  NoteRepository,
  "findById" | "listByOwner" | "countByOwner"
>;
/**
 * Scope-bound read view over the usage aggregates for the usage screen.
 * `find` yields a version token, which is why the write methods are
 * dropped: displaying usage must not become a path to writing it.
 */
export type UsageReader = Readonly<{
  storageQuota: Pick<StorageQuotaRepository, "find" | "listBySubjects">;
  llmUsage: Pick<LlmUsageRepository, "find">;
}>;

/**
 * Request-path container. Provided to usecases (mutations must run
 * inside one of the unit-of-work providers) and to the presentation
 * layer for SSR head/meta via `config`.
 *
 * Ports that live here *outside* the UoW contexts are exactly the ones
 * the spec places outside the transaction: the uniqueness-reservation
 * saga (`identityUniqueDirectory`), the note-route saga
 * (`noteRouteStore`), the atomic login-attempt counter
 * (`loginAttemptStore`), the OAuth flow state whose `take` is its own
 * atomic step (`oauthStateStore`), and the pure read views above.
 *
 * `oauthDevMode` is not a port but the one flag the composition root
 * publishes about its own OAuth wiring (ADR-021): the dev consent route
 * reads it instead of `process.env`, so no request-path code inspects
 * the environment directly.
 *
 * Intentionally does NOT carry `outboxRepository` or `idempotencyStore`:
 * those are worker concerns. A request that needs to enqueue a domain
 * event uses the UoW's `collectEvents`.
 */
export type RequestContainer = SharedDeps &
  Readonly<{
    config: AppConfig;
    globalUnitOfWorkProvider: GlobalUnitOfWorkProvider;
    scopeUnitOfWorkProvider: ScopeUnitOfWorkProvider;
    scopeRouter: ScopeRouter;
    noteRouteStore: NoteRouteStore;
    identityUniqueDirectory: IdentityUniqueDirectory;
    loginAttemptStore: LoginAttemptStore;
    oauthStateStore: OAuthStateStore;
    signInOAuthClient: SignInOAuthClient;
    oauthDevMode: boolean;
    userReader: UserReader;
    identityReader: IdentityReader;
    sessionReader: SessionReader;
    authTokenReader: AuthTokenReader;
    deletionOperationReader: DeletionOperationReader;
    noteReaderFor: (scope: ScopeKey) => NoteReader;
    usageReaderFor: (scope: ScopeKey) => UsageReader;
    mailSender: MailSender;
    passwordHasher: PasswordHasher;
    secureTokenGenerator: SecureTokenGenerator;
    shareTokenProtector: ShareTokenProtector;
  }>;

/** Sweep tables owned by `pruneExpiredAuthState` (spec/usecases/identity.md). */
export type AuthStateTable =
  | "sessions"
  | "auth_tokens"
  | "login_attempts"
  | "oauth_flow_states";

/**
 * Common shape of the four expiry sweeps (`SessionRepository` /
 * `AuthTokenRepository` / `LoginAttemptStore` / `OAuthStateStore`):
 * one bounded keyset page of rows with `expiresAt <= now`.
 */
export type ExpirySweep = Readonly<{
  deleteExpired(
    now: Date,
    cursor: string | null,
    limit: number,
  ): Promise<PrunePage>;
}>;

/**
 * Worker-path container. Used by the relay (`processOutboxEvents`),
 * pruner (`pruneOutbox` and `pruneExpiredAuthState`), queue consumer,
 * and DLQ handler.
 *
 * `routingGenerations` names the current UserId-routing generations for
 * maintenance-run lane construction; the in-memory runtime is a single
 * logical generation.
 *
 * Intentionally does NOT carry `config` or the unit-of-work providers:
 * `config` is SSR-only metadata, and worker code that reads/writes the
 * outbox or sweeps expiry tables does so through the ports directly
 * without a unit of work (spec: the per-table deletes must not share a
 * cross-cutting transaction).
 *
 * Both unit-of-work providers are here because the subscriber registry
 * (`application/workers/subscribers.ts`) runs real consumers whose
 * effects are transactional. `idempotencyStore` is reachable through
 * them: its contract requires `markProcessed` to share a unit of work
 * with the subscriber's main effect
 * (`application/ports/idempotencyStore.ts`) — never call it outside one.
 * Subscribers whose effect is intrinsically idempotent (delete /
 * overwrite) skip the store and document that basis instead.
 *
 * The remaining ports are the ones today's subscribers touch outside a
 * unit of work: reservation release reads the removal receipt and frees
 * the directory key, and the deletion manifest collects global receipts.
 * `scopeTaskQueue` is the runner's only way to learn which scopes have
 * continuation work due (ADR-005) — it reads, and the claim still
 * happens inside each scope's unit of work. `objectStorage` is here
 * because reclaiming an object is the subscriber's job, after the
 * metadata row it belonged to is already gone.
 */
export type WorkerContainer = SharedDeps &
  Readonly<{
    globalUnitOfWorkProvider: GlobalUnitOfWorkProvider;
    scopeUnitOfWorkProvider: ScopeUnitOfWorkProvider;
    outboxRepository: OutboxRepository;
    idempotencyStore: IdempotencyStore;
    maintenanceRunStore: GlobalMaintenanceRunStore;
    identityUniqueDirectory: IdentityUniqueDirectory;
    identityRemovalReceiptStore: IdentityRemovalReceiptStore;
    accountDeletionManifestStore: AccountDeletionManifestStore;
    scopeTaskQueue: ScopeTaskQueue;
    objectStorage: ObjectStorage;
    routingGenerations: readonly string[];
    authStateSweeps: Readonly<Record<AuthStateTable, ExpirySweep>>;
  }>;
