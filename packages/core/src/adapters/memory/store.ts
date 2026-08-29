import { AsyncLocalStorage } from "node:async_hooks";
import { EventId } from "@repo/core/domain/common/event";
import type { AuthToken } from "@repo/core/domain/identity/authToken";
import type { Identity } from "@repo/core/domain/identity/identity";
import type { Session } from "@repo/core/domain/identity/session";
import type { User } from "@repo/core/domain/identity/user";
import type { TokenHash, UserId } from "@repo/core/domain/identity/valueObject";
import type { Note } from "@repo/core/domain/note/note";
import type { NoteRevision } from "@repo/core/domain/note/noteRevision";
import type {
  NoteProjectionEntry,
  ProjectedTagName,
} from "@repo/core/domain/note/ports/localNoteProjectionWriter";
import type { StoredFile } from "@repo/core/domain/storage/storedFile";
import type { LlmUsage } from "@repo/core/domain/usage/llmUsage";
import type { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import type { Invitation } from "@repo/core/domain/workspace/invitation";
import type { Membership } from "@repo/core/domain/workspace/membership";
import type {
  InvitationId,
  MembershipId,
  WorkspaceId,
  WorkspaceName,
  WorkspaceRole,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import type { Workspace } from "@repo/core/domain/workspace/workspace";
import type { AccountDeletionReceipt } from "../../application/ports/accountDeletionManifestStore";
import { type Clock, SystemClock } from "../../application/ports/clock";
import type { DistributedOperation } from "../../application/ports/distributedOperationStore";
import type { MaintenanceKind } from "../../application/ports/globalMaintenanceRunStore";
import type { IdentityRemovalReceipt } from "../../application/ports/identityRemovalReceiptStore";
import {
  type IdGenerator,
  UuidV7Generator,
} from "../../application/ports/idGenerator";
import type { OAuthFlowState } from "../../application/ports/oauthStateStore";
import type { ObjectMeta } from "../../application/ports/objectStorage";
import type { PersonalCleanupComponent } from "../../application/ports/scopeCleanupAdmissionStore";
import type {
  ScopeTaskPayload,
  ScopeTaskPriority,
} from "../../application/ports/scopeTaskScheduler";
import {
  type ScopeKey,
  ScopeKey as ScopeKeyOps,
} from "../../application/scope";
import type { IdentityUniqueKind } from "../../domain/identity/ports/identityUniqueDirectory";

type Undo = () => void;

class MemoryTransaction {
  readonly undoLog: Undo[] = [];
}

/**
 * Transaction plumbing shared by every table of one `MemoryBackend`.
 *
 * A unit of work runs its callback inside an `AsyncLocalStorage` context
 * holding the transaction; every table mutation issued from that async
 * context records an undo entry, so a failed commit rolls back exactly
 * the transaction's own writes. Mutations from other async contexts
 * (ports called outside any UoW, e.g. `LoginAttemptStore`) apply
 * directly and survive a concurrent rollback. Transactions are
 * serialized through a promise-chain mutex, approximating the
 * single-writer isolation of the real backends.
 */
export class MemoryTransactionController {
  private readonly storage = new AsyncLocalStorage<MemoryTransaction>();
  private queue: Promise<unknown> = Promise.resolve();

  current(): MemoryTransaction | null {
    return this.storage.getStore() ?? null;
  }

  inTransaction(): boolean {
    return this.current() !== null;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction()) {
      return Promise.reject(
        new Error(
          "Unit-of-work nesting is forbidden: run was called inside an open unit of work",
        ),
      );
    }
    const execute = async (): Promise<T> => {
      const tx = new MemoryTransaction();
      try {
        return await this.storage.run(tx, fn);
      } catch (error) {
        for (let i = tx.undoLog.length - 1; i >= 0; i -= 1) {
          tx.undoLog[i]?.();
        }
        throw error;
      }
    };
    const result = this.queue.then(execute, execute);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

/**
 * Map wrapper that undo-logs mutations issued inside a transaction.
 * Rows are treated as immutable snapshots — writers always `set` a new
 * object rather than mutating in place, which is what makes the undo
 * entries (previous reference) sufficient for rollback.
 */
export class MemTable<V> {
  private readonly rows = new Map<string, V>();

  constructor(private readonly tx: MemoryTransactionController) {}

  get(key: string): V | undefined {
    return this.rows.get(key);
  }

  has(key: string): boolean {
    return this.rows.has(key);
  }

  set(key: string, value: V): void {
    const transaction = this.tx.current();
    if (transaction !== null) {
      const had = this.rows.has(key);
      const previous = this.rows.get(key);
      transaction.undoLog.push(() => {
        if (had) {
          this.rows.set(key, previous as V);
        } else {
          this.rows.delete(key);
        }
      });
    }
    this.rows.set(key, value);
  }

  delete(key: string): boolean {
    const transaction = this.tx.current();
    if (transaction !== null && this.rows.has(key)) {
      const previous = this.rows.get(key);
      transaction.undoLog.push(() => {
        this.rows.set(key, previous as V);
      });
    }
    return this.rows.delete(key);
  }

  keys(): readonly string[] {
    return [...this.rows.keys()];
  }

  values(): readonly V[] {
    return [...this.rows.values()];
  }

  entries(): readonly (readonly [string, V])[] {
    return [...this.rows.entries()];
  }

  get size(): number {
    return this.rows.size;
  }
}

export type DirectoryRow = Readonly<{
  kind: IdentityUniqueKind;
  normalizedKey: string;
  userId: UserId;
  state: "reserved" | "active" | "releasing";
  operationId: string;
  expiresAt: Date | null;
  userVersion: number | null;
  /**
   * Identity of this one claim, minted when the row is first written.
   * Minting at `reserve` rather than at `activate` is what makes "an
   * `active` row always carries a token" a property of the type instead
   * of a runtime branch.
   */
  claimToken: string;
}>;

export type StoredObjectRow = Readonly<{
  bytes: Uint8Array;
  meta: ObjectMeta;
}>;

export type LoginAttemptRow = Readonly<{
  key: string;
  failureCount: number;
  lastFailedAt: Date;
  expiresAt: Date;
}>;

export type OAuthStateRow = Readonly<{
  state: string;
  value: OAuthFlowState;
  expiresAt: Date;
}>;

export type OutboxRow = Readonly<{
  id: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
  aggregateId: string;
  createdAt: Date;
  attempts: number;
  processedAt: Date | null;
  failedAt: Date | null;
  nextAttemptAt: Date | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  lastError: string | null;
}>;

export type NoteRouteRow = Readonly<{
  noteId: string;
  scope: ScopeKey;
  createdBy: UserId;
  routeVersion: number;
  state: "reserved" | "active" | "moving" | "purging" | "tombstone";
  target: ScopeKey | null;
  migrationId: string | null;
  /**
   * Migration whose `switchMove` last bumped `routeVersion`. `migrationId`
   * is cleared by the switch, so this is what lets a lost-response retry
   * be told apart from a stale request of a different migration that
   * happens to quote the same `expectedRouteVersion`.
   */
  lastMigrationId: string | null;
  operationId: string | null;
  expiresAt: Date | null;
}>;

export type CleanupReceiptRow = Readonly<{
  operationId: string;
  userId: UserId;
  status: "running" | "completed";
  acknowledged: readonly PersonalCleanupComponent[];
  retainUntil: Date | null;
}>;

export type ManifestHeaderRow = Readonly<{
  operationId: string;
  userId: UserId;
  status: "building" | "built" | "rollingBack" | "completed" | "rejected";
  membershipCursor: string | null;
  authorRouteCursor: string | null;
  receipts: readonly AccountDeletionReceipt[];
  terminalAt: Date | null;
  retainUntil: Date | null;
}>;

export type ManifestMembershipItemRow = Readonly<{
  operationId: string;
  key: string;
  kind: "membership";
  workspaceId: WorkspaceId;
  edgeState: "active" | "removing" | "pending";
  membershipId: string | null;
  prepareCommandKey: string | null;
  prepareDispatchedAt: Date | null;
  prepareAckedAt: Date | null;
  releaseCommandKey: string | null;
  releaseDispatchedAt: Date | null;
  releaseAckedAt: Date | null;
  cleanupAckedAt: Date | null;
}>;

export type ManifestAuthorRouteItemRow = Readonly<{
  operationId: string;
  key: string;
  kind: "authorRoute";
  noteId: string;
  routeVersion: number;
  localRedactionAckedAt: Date | null;
  publicRedactionAckedAt: Date | null;
}>;

export type ManifestItemRow =
  | ManifestMembershipItemRow
  | ManifestAuthorRouteItemRow;

/**
 * One row of the global `membership_directory`: which workspaces a user
 * belongs to, and in which projected role.
 *
 * `edgeKey` is the row's own operation id, the key
 * `AccountDeletionManifestStore.appendMembershipPage` walks in ascending
 * order. The table key is opaque — the page scan filters on the `userId`
 * field and orders by `edgeKey`, so a writer may key rows however it
 * likes as long as keys stay unique.
 *
 * `activating` is the join saga's claim, held between
 * `reserveAndClaimActivation` and the workspace-local commit. Account
 * deletion drains those to zero before it fixes its manifest, which is
 * why the manifest's own item type knows only the three settled states.
 */
export type MembershipDirectoryRow = Readonly<{
  userId: UserId;
  edgeKey: string;
  workspaceId: WorkspaceId;
  edgeState: "pending" | "activating" | "active" | "removing";
  membershipId: string | null;
  role: WorkspaceRole;
  /** Account-deletion prepare lock owner of a `pending` edge. */
  deletionPrepareOperationId: string | null;
  deletionPrepareExpiresAt: Date | null;
  /** Set while the edge is `pending` / `activating`; null once settled. */
  reservationExpiresAt: Date | null;
  createdAt: Date;
}>;

/**
 * One row of the global `invitation_routes`. The token hash is the row's
 * primary key, so the table doubles as the token's uniqueness
 * reservation; `revoked` is the single terminal state both `revoke` and
 * `consume` reach.
 */
export type InvitationRouteRow = Readonly<{
  tokenHash: TokenHash;
  workspaceId: WorkspaceId;
  invitationId: InvitationId;
  operationId: string;
  state: "reserved" | "active" | "revoked";
  expiresAt: Date;
}>;

/**
 * One row of the global `workspace_slug_reservations`. Only a `reserved`
 * row carries an expiry — an `active` claim is freed by its owner, never
 * by the clock.
 */
export type SlugReservationRow = Readonly<{
  slug: WorkspaceSlug;
  workspaceId: WorkspaceId;
  operationId: string;
  state: "reserved" | "active";
  expiresAt: Date | null;
}>;

/**
 * One row of a workspace scope's `membership_removal_locks`. A
 * `committed` lock carries no expiry: it is past the point of no return
 * and only `release` removes it.
 */
export type MembershipRemovalLockRow = Readonly<{
  operationId: string;
  userId: UserId;
  membershipId: MembershipId;
  expectedMembershipVersion: number;
  state: "prepared" | "committed";
  expiresAt: Date | null;
}>;

/**
 * One row of a scope's `move_authorization_locks`. The row's existence
 * *is* the lock — there is no `activated` state and no expiry, so a move
 * that died mid-flight keeps blocking until it is settled.
 */
export type MoveAuthorizationLockRow = Readonly<{
  migrationId: string;
  actorUserId: UserId;
}>;

/**
 * Header of a workspace scope's `workspace_deletion_manifests`.
 *
 * Only three of the spec's header states are reachable through
 * `WorkspaceDeletionManifestStore`, because those are the only
 * transitions it exposes: `beginDeletion` creates `building`, `markReady`
 * moves to `ready`, and `markCompleted` stamps the tombstone. The phases
 * in between are told apart by the items' two acknowledgement columns,
 * not by the header.
 */
export type WorkspaceDeletionManifestHeaderRow = Readonly<{
  operationId: string;
  workspaceId: WorkspaceId;
  state: "building" | "ready" | "completed";
  membershipCursor: MembershipId | null;
  invitationCursor: InvitationId | null;
}>;

export type WorkspaceDeletionManifestMembershipItemRow = Readonly<{
  operationId: string;
  key: string;
  kind: "membership";
  userId: UserId;
  membershipId: MembershipId;
  localDeletedAt: Date | null;
  globalAckedAt: Date | null;
}>;

export type WorkspaceDeletionManifestInvitationItemRow = Readonly<{
  operationId: string;
  key: string;
  kind: "invitation";
  tokenHash: TokenHash;
  invitationId: InvitationId;
  localDeletedAt: Date | null;
  globalAckedAt: Date | null;
}>;

export type WorkspaceDeletionManifestItemRow =
  | WorkspaceDeletionManifestMembershipItemRow
  | WorkspaceDeletionManifestInvitationItemRow;

/**
 * One row of the global `workspace_directory` projection. `avatarUrl`
 * stays a raw string for the reason `WorkspaceDirectoryEntry` gives: it
 * was validated on write and rehydrating it would need the app origin.
 *
 * A deletion tombstone keeps `lifecycle: "deleting"` with its display
 * fields redacted, which is what makes "gone" a durable verdict the
 * batch reader can report as `deleted` after the row's workspace scope
 * is unreachable (spec/database/index.md `workspace_directory`).
 */
export type WorkspaceDirectoryRow = Readonly<{
  workspaceId: WorkspaceId;
  name: WorkspaceName;
  slug: WorkspaceSlug | null;
  avatarUrl: string | null;
  publication: "private" | "published";
  lifecycle: "active" | "deleting";
  /** Owner of the tombstone; null while the row is `active`. */
  deletionOperationId: string | null;
  sourceVersion: number;
  updatedAt: Date;
}>;

export type MaintenanceLaneRow = Readonly<{
  generation: string;
  shardId: string;
  status: "pending" | "claimed" | "done";
  tableIndex: number;
  cursor: string | null;
  commandKey: string;
}>;

export type MaintenanceRunRow = Readonly<{
  runId: string;
  kind: MaintenanceKind;
  status: "running" | "completed";
  asOf: Date;
  leaseOwner: string;
  leaseUntil: Date;
  tables: readonly string[];
  lanes: readonly MaintenanceLaneRow[];
  expiresAt: Date | null;
}>;

export type PublicProjectionRow = Readonly<{
  noteId: string;
  entry: NoteProjectionEntry;
  tags: readonly ProjectedTagName[];
  routeVersion: number;
  projectionRevision: number;
  authorVersion: number;
  workspaceVersion: number;
}>;

export type LocalProjectionRow = Readonly<{
  noteId: string;
  entry: NoteProjectionEntry;
  tags: readonly ProjectedTagName[];
  projectionRevision: number;
  authorVersion: number;
  workspaceVersion: number;
}>;

type ScheduledTaskBase = Readonly<{
  kind: string;
  operationId: string;
  payload: ScopeTaskPayload;
  priority: ScopeTaskPriority;
  attempt: number;
}>;

/**
 * A scheduled task carries only the times its state gives a meaning to:
 * a lease belongs to a claim, and a `failed` row has no run to be due
 * for. `dueAt` means "when this is meant to run" in both states that
 * have one, which is what keeps a reclaimed row in its original place.
 */
export type ScheduledTaskRow =
  | (ScheduledTaskBase & Readonly<{ state: "pending"; dueAt: Date }>)
  | (ScheduledTaskBase &
      Readonly<{ state: "running"; dueAt: Date; leaseExpiresAt: Date }>)
  | (ScheduledTaskBase & Readonly<{ state: "failed" }>);

export type ScopeStore = Readonly<{
  key: string;
  scope: ScopeKey;
  workspaces: MemTable<Workspace>;
  memberships: MemTable<Membership>;
  invitations: MemTable<Invitation>;
  notes: MemTable<Note>;
  noteRevisions: MemTable<NoteRevision>;
  cleanupReceipts: MemTable<CleanupReceiptRow>;
  membershipRemovalLocks: MemTable<MembershipRemovalLockRow>;
  moveAuthorizationLocks: MemTable<MoveAuthorizationLockRow>;
  deletionManifestHeaders: MemTable<WorkspaceDeletionManifestHeaderRow>;
  deletionManifestItems: MemTable<WorkspaceDeletionManifestItemRow>;
  actorLocks: MemTable<true>;
  localProjection: MemTable<LocalProjectionRow>;
  projectionRevisions: MemTable<number>;
  scheduledTasks: MemTable<ScheduledTaskRow>;
  appliedOperations: MemTable<true>;
  storageQuotas: MemTable<StorageQuota>;
  llmUsages: MemTable<LlmUsage>;
  storedFiles: MemTable<StoredFile>;
}>;

export type MemoryBackendOptions = Readonly<{
  clock?: Clock;
  idGenerator?: IdGenerator;
  /** Logical shard ids for the global maintenance lanes (default: one). */
  maintenanceShardIds?: readonly string[];
  /** Sweep-table sequence per maintenance kind. */
  maintenanceTablesByKind?: Partial<Record<MaintenanceKind, readonly string[]>>;
}>;

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

/**
 * Process-wide state shared by every memory adapter of one deployment.
 *
 * The backend models the two persistence planes of the spec: the global
 * tables (identity aggregates, routing, outbox, maintenance bookkeeping)
 * and one `ScopeStore` per `ScopeKey`. It is a regular adapter backend —
 * not a test fake — and is exercised by the shared port-conformance
 * suites in `adapters/conformance/`.
 */
export class MemoryBackend {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly transactions = new MemoryTransactionController();
  readonly maintenanceShardIds: readonly string[];
  readonly maintenanceTablesByKind: Record<MaintenanceKind, readonly string[]>;

  readonly users = this.table<User>();
  readonly identities = this.table<Identity>();
  readonly sessions = this.table<Session>();
  readonly authTokens = this.table<AuthToken>();
  readonly uniqueDirectory = this.table<DirectoryRow>();
  readonly identityRemovalReceipts = this.table<IdentityRemovalReceipt>();
  readonly distributedOperations = this.table<DistributedOperation>();
  readonly objects = this.table<StoredObjectRow>();
  readonly loginAttempts = this.table<LoginAttemptRow>();
  readonly oauthStates = this.table<OAuthStateRow>();
  readonly outbox = this.table<OutboxRow>();
  readonly idempotency = this.table<true>();
  readonly noteRoutes = this.table<NoteRouteRow>();
  readonly manifestHeaders = this.table<ManifestHeaderRow>();
  readonly manifestItems = this.table<ManifestItemRow>();
  readonly membershipEdges = this.table<MembershipDirectoryRow>();
  readonly invitationRoutes = this.table<InvitationRouteRow>();
  readonly slugReservations = this.table<SlugReservationRow>();
  readonly workspaceDirectory = this.table<WorkspaceDirectoryRow>();
  /**
   * WorkspaceIds whose directory shard is currently unreadable. This
   * backend keeps one process-local shard that cannot fail on its own,
   * so the partial-failure halves of the directory contracts — one dead
   * shard degrades a single row for `WorkspaceDirectoryBatchReader` but
   * fails the whole page for `PublicWorkspaceDirectoryReader` — have no
   * executable form unless an outage can be induced.
   */
  readonly workspaceDirectoryOutages = new Set<string>();
  readonly maintenanceRuns = this.table<MaintenanceRunRow>();
  readonly publicProjection = this.table<PublicProjectionRow>();
  readonly publicPurgeAcks = this.table<true>();

  private readonly scopes = new Map<string, ScopeStore>();
  private claimTokenSeq = 0;

  constructor(options: MemoryBackendOptions = {}) {
    this.clock = options.clock ?? SystemClock;
    this.idGenerator = options.idGenerator ?? UuidV7Generator;
    this.maintenanceShardIds = options.maintenanceShardIds ?? ["shard-0"];
    this.maintenanceTablesByKind = {
      ...DEFAULT_MAINTENANCE_TABLES,
      ...options.maintenanceTablesByKind,
    };
  }

  scope(scope: ScopeKey): ScopeStore {
    const key = ScopeKeyOps.serialize(scope);
    const existing = this.scopes.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: ScopeStore = {
      key,
      scope,
      workspaces: this.table<Workspace>(),
      memberships: this.table<Membership>(),
      invitations: this.table<Invitation>(),
      notes: this.table<Note>(),
      noteRevisions: this.table<NoteRevision>(),
      cleanupReceipts: this.table<CleanupReceiptRow>(),
      membershipRemovalLocks: this.table<MembershipRemovalLockRow>(),
      moveAuthorizationLocks: this.table<MoveAuthorizationLockRow>(),
      deletionManifestHeaders: this.table<WorkspaceDeletionManifestHeaderRow>(),
      deletionManifestItems: this.table<WorkspaceDeletionManifestItemRow>(),
      actorLocks: this.table<true>(),
      localProjection: this.table<LocalProjectionRow>(),
      projectionRevisions: this.table<number>(),
      scheduledTasks: this.table<ScheduledTaskRow>(),
      appliedOperations: this.table<true>(),
      storageQuotas: this.table<StorageQuota>(),
      llmUsages: this.table<LlmUsage>(),
      storedFiles: this.table<StoredFile>(),
    };
    this.scopes.set(key, created);
    return created;
  }

  scopeEntries(): readonly (readonly [string, ScopeStore])[] {
    return [...this.scopes.entries()];
  }

  mintEventId(): EventId {
    return EventId.create(this.idGenerator.next());
  }

  /**
   * Distinct opaque token per directory row write. It lives on the
   * backend rather than in the directory factory because that factory
   * runs once per request / worker container and again on every global
   * UoW `run`, all over the same tables, so a factory-local counter
   * would hand the same token out twice. It is deliberately not the
   * `idGenerator` — the deterministic id stream tests assert on must not
   * shift.
   */
  nextClaimToken(): string {
    this.claimTokenSeq += 1;
    return `claim-${this.claimTokenSeq}`;
  }

  private table<V>(): MemTable<V> {
    return new MemTable<V>(this.transactions);
  }
}
