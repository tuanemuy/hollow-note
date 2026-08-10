import { AsyncLocalStorage } from "node:async_hooks";
import { EventId } from "@repo/core/domain/common/event";
import type { AuthToken } from "@repo/core/domain/identity/authToken";
import type { Identity } from "@repo/core/domain/identity/identity";
import type { Session } from "@repo/core/domain/identity/session";
import type { User } from "@repo/core/domain/identity/user";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { Note } from "@repo/core/domain/note/note";
import type { NoteRevision } from "@repo/core/domain/note/noteRevision";
import type {
  NoteProjectionEntry,
  ProjectedTagName,
} from "@repo/core/domain/note/ports/localNoteProjectionWriter";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { AccountDeletionReceipt } from "../../application/ports/accountDeletionManifestStore";
import { type Clock, SystemClock } from "../../application/ports/clock";
import type { MaintenanceKind } from "../../application/ports/globalMaintenanceRunStore";
import {
  type IdGenerator,
  UuidV7Generator,
} from "../../application/ports/idGenerator";
import type { OAuthFlowState } from "../../application/ports/oauthStateStore";
import type { PersonalCleanupComponent } from "../../application/ports/scopeCleanupAdmissionStore";
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
  state: "reserved" | "active";
  operationId: string;
  expiresAt: Date | null;
  userVersion: number | null;
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
 * Placeholder source for `AccountDeletionManifestStore.appendMembershipPage`
 * until the Workspace domain lands in slice #3. The table key is opaque:
 * the page scan filters on the `userId` field and orders by `edgeKey`, so
 * a seeder may key rows however it likes as long as keys stay unique.
 */
export type MembershipEdgeSeed = Readonly<{
  userId: UserId;
  edgeKey: string;
  workspaceId: WorkspaceId;
  edgeState: "active" | "removing" | "pending";
  membershipId: string | null;
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

export type ScopeStore = Readonly<{
  key: string;
  notes: MemTable<Note>;
  noteRevisions: MemTable<NoteRevision>;
  cleanupReceipts: MemTable<CleanupReceiptRow>;
  actorLocks: MemTable<true>;
  localProjection: MemTable<LocalProjectionRow>;
  projectionRevisions: MemTable<number>;
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
  readonly loginAttempts = this.table<LoginAttemptRow>();
  readonly oauthStates = this.table<OAuthStateRow>();
  readonly outbox = this.table<OutboxRow>();
  readonly idempotency = this.table<true>();
  readonly noteRoutes = this.table<NoteRouteRow>();
  readonly manifestHeaders = this.table<ManifestHeaderRow>();
  readonly manifestItems = this.table<ManifestItemRow>();
  readonly membershipEdges = this.table<MembershipEdgeSeed>();
  readonly maintenanceRuns = this.table<MaintenanceRunRow>();
  readonly publicProjection = this.table<PublicProjectionRow>();
  readonly publicPurgeAcks = this.table<true>();

  private readonly scopes = new Map<string, ScopeStore>();

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
      notes: this.table<Note>(),
      noteRevisions: this.table<NoteRevision>(),
      cleanupReceipts: this.table<CleanupReceiptRow>(),
      actorLocks: this.table<true>(),
      localProjection: this.table<LocalProjectionRow>(),
      projectionRevisions: this.table<number>(),
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

  private table<V>(): MemTable<V> {
    return new MemTable<V>(this.transactions);
  }
}
