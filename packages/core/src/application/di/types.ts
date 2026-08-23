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
import type { PublicNoteProjectionWriter } from "@repo/core/domain/note/ports/publicNoteProjectionWriter";
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
import type { NoteRouteFanOutReader } from "../ports/noteRouteFanOutReader";
import type { NoteRouteStore } from "../ports/noteRouteStore";
import type { OAuthStateStore } from "../ports/oauthStateStore";
import type { ObjectStorage } from "../ports/objectStorage";
import type { OutboxRepository } from "../ports/outboxRepository";
import type { ScopeRouter } from "../ports/scopeRouter";
import type { ScopeTaskQueue } from "../ports/scopeTaskQueue";
import type { ShareTokenProtector } from "../ports/shareTokenProtector";
import type { ScopeKey } from "../scope";

/**
 * SSR metadata for the document head, plus the deployment's public base
 * URL.
 *
 * The web app dehydrates this value into the SSR payload of *every*
 * page, including signed-out public ones, so the whole object reaches
 * any visitor's browser. Never add a signing key, cipher key, or any
 * other secret here — deployment secrets enter through the composition
 * root as their own key rings (see `DeletionTicketKeyRing`).
 */
export type AppConfig = Readonly<{
  appUrl: string;
  siteName: string;
  defaultTitle: string;
  defaultDescription: string;
  twitterHandle?: string;
  themeColor: string;
}>;

/**
 * Signing keys for the deletion status ticket.
 *
 * The ticket is a presentation concern — it carries a transport format
 * and an expiry — but its secret is a deployment concern, so the
 * composition root supplies the ring and the presentation layer only
 * uses it. That keeps every secret entering the process through one
 * path, the same one `shareTokenKeyRing` already takes; it is
 * deliberately not part of `AppConfig`, which is SSR metadata.
 *
 * Versioned so a key can be rotated by adding one and bumping
 * `currentVersion`: tickets already in flight keep verifying under the
 * version they were signed with.
 */
export type DeletionTicketKeyRing = Readonly<{
  currentVersion: number;
  /** 32-byte HMAC-SHA-256 keys by version. Never persisted. */
  keys: ReadonlyMap<number, Uint8Array>;
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
/**
 * Author-side fan-out over the note routing catalog. Account deletion
 * fixes its author-route targets from it, and it is a read of a store
 * the manifest's unit of work cannot enclose, so it stays a `Pick`
 * outside the transaction.
 */
export type NoteRouteFanOutReadView = Pick<
  NoteRouteFanOutReader,
  "listByCreatedBy"
>;
/**
 * Where a note currently lives. Author redaction fixed its targets by
 * NoteId, and a note may have moved (or been purged) since, so the plane
 * it writes to is re-resolved per target rather than assumed.
 */
export type NoteRouteResolver = Pick<NoteRouteStore, "resolve">;
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
 * `objectStorage` is here for the same reason: `storeAvatar` writes the
 * bytes *before* the transaction that records the file, and the delivery
 * route reads them back — both request-path work that no unit of work
 * may enclose.
 *
 * `oauthDevMode` is not a port but the one flag the composition root
 * publishes about its own OAuth wiring: the dev consent route reads it
 * instead of `process.env`, so no request-path code inspects the
 * environment directly.
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
    objectStorage: ObjectStorage;
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
    deletionTicketKeyRing: DeletionTicketKeyRing;
  }>;

/**
 * Sweep tables owned by `pruneExpiredAuthState`
 * (spec/usecases/identity.md). Every table with an `expiresAt` retention
 * window belongs here — this union is what makes a missing registration
 * a type error rather than a table that is never collected.
 */
export type AuthStateTable =
  | "sessions"
  | "auth_tokens"
  | "login_attempts"
  | "oauth_flow_states"
  | "identity_removal_receipts";

/**
 * Common shape of the expiry sweeps (`SessionRepository` /
 * `AuthTokenRepository` / `LoginAttemptStore` / `OAuthStateStore` /
 * `IdentityRemovalReceiptStore`): one bounded keyset page of rows with
 * `expiresAt <= now`.
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
 * the directory key, the deletion manifest collects global receipts and
 * hands its build continuations the header they resume from, and
 * `noteRouteFanOutReader` fixes the author routes of a deletion —
 * a routing-catalog read that the manifest's transaction may not
 * enclose, which is why deletion continuations are worker-plane
 * consumers rather than request-path calls. Author redaction adds the
 * other two halves of that same fan-out: the route resolver that says
 * where each fixed target lives now, and the public projection, which is
 * global and therefore belongs to no scope's unit of work.
 * `scopeTaskQueue` is the runner's only way to learn which scopes have
 * continuation work due — it reads, and the claim still happens inside
 * each scope's unit of work. `objectStorage` is here because reclaiming
 * an object is the subscriber's job, after the metadata row it belonged
 * to is already gone.
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
    noteRouteFanOutReader: NoteRouteFanOutReadView;
    noteRouteResolver: NoteRouteResolver;
    publicNoteProjectionWriter: PublicNoteProjectionWriter;
    scopeTaskQueue: ScopeTaskQueue;
    objectStorage: ObjectStorage;
    routingGenerations: readonly string[];
    authStateSweeps: Readonly<Record<AuthStateTable, ExpirySweep>>;
  }>;
