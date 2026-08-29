import { ConflictError } from "../../../../application/errors";
import type {
  AccountDeletionAckPhase,
  AccountDeletionAuthorRoute,
  AccountDeletionManifestHeader,
  AccountDeletionManifestItem,
  AccountDeletionManifestStatus,
  AccountDeletionManifestStore,
  AccountDeletionPhase,
  AccountDeletionReceipt,
} from "../../../../application/ports/accountDeletionManifestStore";
import type { Clock } from "../../../../application/ports/clock";
import { UserId } from "../../../../domain/identity/valueObject";
import { NoteId } from "../../../../domain/note/valueObject";
import { WorkspaceId } from "../../../../domain/workspace/valueObject";
import {
  opaque,
  type RowMutation,
  removeMany,
  upsert,
  upsertMany,
} from "../../execution/writeSet";
import { classifySqlError, databaseError } from "../../sql/errors";
import {
  deleteRowsFromJson,
  inJsonList,
  insertRowsFromJson,
  jsonList,
  jsonRows,
  notInJsonList,
} from "../../sql/json";
import { occGuard } from "../../sql/occGuard";
import {
  compositeKey,
  dateOrNull,
  enumOf,
  int,
  intOrNull,
  json,
  text,
  textOrNull,
  toJson,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const HEADERS = GLOBAL_TABLES.accountDeletionManifests;
const ITEMS = GLOBAL_TABLES.accountDeletionManifestItems;
const EDGES = GLOBAL_TABLES.membershipDirectory;

const PAGE_LIMIT = 100;

const STATUSES: readonly AccountDeletionManifestStatus[] = [
  "building",
  "built",
  "rollingBack",
  "completed",
  "rejected",
];

/**
 * Receipts finalize waits for when a deployment declares nothing. The
 * strictest reading on purpose: a deployment that forgets to declare its
 * participants stalls rather than finalizing early (ADR 039).
 */
const ALL_FINALIZE_RECEIPTS: readonly AccountDeletionReceipt[] = [
  "personalCleanup",
  "authResidue",
  "externalConnections",
  "jobHistory",
  "uniquenessRelease",
];

/** Membership-directory states a deletion manifest fixes as targets. */
const DELETABLE_EDGE_STATES = "('active', 'removing', 'pending')";

const stateViolation = (operationId: string, detail: string): ConflictError =>
  new ConflictError(
    "ACCOUNT_DELETION_MANIFEST_STATE_VIOLATION",
    `Manifest ${operationId}: ${detail}`,
  );

const cap = (limit: number): number =>
  Math.min(Math.max(0, Math.trunc(limit)), PAGE_LIMIT);

type Header = Readonly<{
  header: AccountDeletionManifestHeader;
  raw: SqlRow;
}>;

const toHeader = (row: SqlRow): AccountDeletionManifestHeader => ({
  operationId: text(row, "operation_id"),
  userId: UserId.create(text(row, "user_id")),
  status: enumOf(row, "status", STATUSES),
  membershipCursor: textOrNull(row, "membership_cursor"),
  authorRouteCursor: textOrNull(row, "author_route_cursor"),
  receipts: json<readonly AccountDeletionReceipt[]>(row, "receipts"),
  terminalAt: dateOrNull(row, "terminal_at"),
  retainUntil: dateOrNull(row, "retain_until"),
});

const toItem = (row: SqlRow): AccountDeletionManifestItem =>
  text(row, "kind") === "membership"
    ? {
        key: text(row, "key"),
        kind: "membership",
        workspaceId: WorkspaceId.create(text(row, "workspace_id")),
        edgeState: enumOf(row, "edge_state", [
          "active",
          "removing",
          "pending",
        ] as const),
        membershipId: textOrNull(row, "membership_id"),
        prepareCommandKey: textOrNull(row, "prepare_command_key"),
        prepareDispatchedAt: dateOrNull(row, "prepare_dispatched_at"),
        prepareAckedAt: dateOrNull(row, "prepare_acked_at"),
        releaseCommandKey: textOrNull(row, "release_command_key"),
        releaseDispatchedAt: dateOrNull(row, "release_dispatched_at"),
        releaseAckedAt: dateOrNull(row, "release_acked_at"),
        cleanupAckedAt: dateOrNull(row, "cleanup_acked_at"),
      }
    : {
        key: text(row, "key"),
        kind: "authorRoute",
        noteId: NoteId.create(text(row, "note_id")),
        routeVersion: int(row, "route_version"),
        localRedactionAckedAt: dateOrNull(row, "local_redaction_acked_at"),
        publicRedactionAckedAt: dateOrNull(row, "public_redaction_acked_at"),
      };

/** The write-set key of an item row: its `(operation_id, key)` primary key. */
const itemOverlayKey = (row: SqlRow): string =>
  compositeKey(text(row, "operation_id"), text(row, "key"));

const byItemKey = (a: SqlRow, b: SqlRow): number => {
  const left = text(a, "key");
  const right = text(b, "key");
  return left < right ? -1 : left > right ? 1 : 0;
};

/**
 * Every optional item column, unset. A staged image has to carry the
 * whole row: the predicates below run over the image rather than over
 * storage, so a column the image omits reads as `undefined` and quietly
 * drops the row from the page.
 */
const ITEM_NULLS: SqlRow = {
  workspace_id: null,
  edge_state: null,
  membership_id: null,
  prepare_command_key: null,
  prepare_dispatched_at: null,
  prepare_acked_at: null,
  release_command_key: null,
  release_dispatched_at: null,
  release_acked_at: null,
  cleanup_acked_at: null,
  note_id: null,
  route_version: null,
  local_redaction_acked_at: null,
  public_redaction_acked_at: null,
};

/**
 * One item selection, in the two forms an overlay-aware read needs it in:
 * the SQL appended after `operation_id = ?`, and the same predicate
 * evaluated over a staged row image.
 */
type ItemFilter = Readonly<{
  sql: string;
  params?: readonly SqlValue[];
  matches: (row: SqlRow) => boolean;
}>;

const isMembership = (row: SqlRow): boolean =>
  text(row, "kind") === "membership";

const unset = (row: SqlRow, column: string): boolean =>
  intOrNull(row, column) === null;

const ALL_ITEMS: ItemFilter = { sql: "", matches: () => true };

const RELEASE_OUTSTANDING: ItemFilter = {
  sql: "AND kind = 'membership' AND prepare_dispatched_at IS NOT NULL AND release_acked_at IS NULL",
  matches: (row) =>
    isMembership(row) &&
    !unset(row, "prepare_dispatched_at") &&
    unset(row, "release_acked_at"),
};

const OPEN_ITEMS: ItemFilter = {
  sql: `AND (
         (kind = 'membership' AND (prepare_acked_at IS NULL OR cleanup_acked_at IS NULL))
         OR (kind = 'authorRoute' AND (local_redaction_acked_at IS NULL OR public_redaction_acked_at IS NULL))
       )`,
  matches: (row) =>
    isMembership(row)
      ? unset(row, "prepare_acked_at") || unset(row, "cleanup_acked_at")
      : unset(row, "local_redaction_acked_at") ||
        unset(row, "public_redaction_acked_at"),
};

const CLAIMABLE: Record<AccountDeletionPhase, ItemFilter> = {
  prepare: {
    sql: "AND kind = 'membership' AND prepare_acked_at IS NULL",
    matches: (row) => isMembership(row) && unset(row, "prepare_acked_at"),
  },
  release: RELEASE_OUTSTANDING,
  cleanup: {
    sql: "AND kind = 'membership' AND cleanup_acked_at IS NULL",
    matches: (row) => isMembership(row) && unset(row, "cleanup_acked_at"),
  },
  redaction: {
    sql: "AND kind = 'authorRoute' AND (local_redaction_acked_at IS NULL OR public_redaction_acked_at IS NULL)",
    matches: (row) =>
      !isMembership(row) &&
      (unset(row, "local_redaction_acked_at") ||
        unset(row, "public_redaction_acked_at")),
  },
};

const withKeys = (keys: ReadonlySet<string>): ItemFilter => ({
  sql: `AND ${inJsonList("key")}`,
  params: [jsonList([...keys])],
  matches: (row) => keys.has(text(row, "key")),
});

const withoutKeys = (keys: ReadonlySet<string>): ItemFilter =>
  keys.size === 0
    ? ALL_ITEMS
    : {
        sql: `AND ${notInJsonList("key")}`,
        params: [jsonList([...keys])],
        matches: (row) => !keys.has(text(row, "key")),
      };

const ackable = (
  kind: string,
  column: string,
  keys: ReadonlySet<string>,
): ItemFilter => ({
  sql: `AND kind = ? AND ${column} IS NULL AND ${inJsonList("key")}`,
  params: [kind, jsonList([...keys])],
  matches: (row) =>
    text(row, "kind") === kind &&
    unset(row, column) &&
    keys.has(text(row, "key")),
});

export type D1AccountDeletionManifestStoreDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
  /**
   * Receipts this deployment's finalize waits for. `undefined` means the
   * deployment declared nothing, which stalls on the full enum.
   */
  requiredFinalizeReceipts?: readonly AccountDeletionReceipt[] | undefined;
}>;

/**
 * `account_deletion_manifests` (header) + `account_deletion_manifest_items`
 * on global D1, both on the UserId shard.
 *
 * Every page — membership, author route, claim, ack, compaction, prune —
 * is one multi-row statement built with `json_each` rather than a
 * statement per row: a page is up to 100 items and both planes cap a
 * statement at 100 bound parameters (`spec/database/index.md` の共通の規約).
 * Each of those statements still names the item rows it touches
 * (`upsertMany` / `removeMany`), so a unit of work reads its own page
 * back exactly as the memory backend does: the two acks of one redaction
 * turn compose, and `markCompleted` counts what the same turn compacted.
 * The terminal prune is the one exception — it drops whole manifests by
 * operation rather than by item key, so the item keys are not enumerable
 * at staging time.
 *
 * The one read the overlay cannot repair is a `LIMIT`-ed page ordered by
 * key whose rows this unit already wrote — the session refuses it rather
 * than returning a short page — which is no constraint on the saga:
 * every turn claims its page at the head and writes last.
 */
export function createD1AccountDeletionManifestStore(
  deps: D1AccountDeletionManifestStoreDeps,
): AccountDeletionManifestStore {
  const { session, clock } = deps;
  const requiredReceipts =
    deps.requiredFinalizeReceipts ?? ALL_FINALIZE_RECEIPTS;

  const findHeader = async (operationId: string): Promise<Header | null> => {
    const row = await session.readRow({
      table: HEADERS,
      key: operationId,
      statement: statement(
        `SELECT * FROM ${HEADERS} WHERE operation_id = ?`,
        operationId,
      ),
    });
    return row === null ? null : { header: toHeader(row), raw: row };
  };

  const requireHeader = async (operationId: string): Promise<Header> => {
    const found = await findHeader(operationId);
    if (found === null) {
      throw stateViolation(operationId, "manifest does not exist");
    }
    return found;
  };

  /**
   * Every item read goes through here so the rows this unit of work has
   * already staged are merged in. `ordered` is what a page needs and what
   * an existence check must not ask for: the session refuses a full
   * `LIMIT`-ed page ordered over rows this unit rewrote, since the new
   * values could move one past the page boundary.
   */
  const readItems = (
    operationId: string,
    filter: ItemFilter,
    page: Readonly<{ ordered?: true; limit?: number }> = {},
  ): Promise<readonly SqlRow[]> =>
    session.readRows({
      table: ITEMS,
      statement: {
        sql: `SELECT * FROM ${ITEMS} WHERE operation_id = ? ${filter.sql}${
          page.ordered === true ? " ORDER BY key" : ""
        }${page.limit === undefined ? "" : ` LIMIT ${page.limit}`}`,
        params: [operationId, ...(filter.params ?? [])],
      },
      keyOf: itemOverlayKey,
      matches: (row) =>
        text(row, "operation_id") === operationId && filter.matches(row),
      ...(page.ordered === true ? { compare: byItemKey } : {}),
      ...(page.limit === undefined ? {} : { limit: page.limit }),
    });

  /** Which of `keys` this manifest already holds, staged pages included. */
  const fixedAmong = async (
    operationId: string,
    keys: readonly string[],
  ): Promise<ReadonlySet<string>> => {
    if (keys.length === 0) {
      return new Set();
    }
    const rows = await readItems(operationId, withKeys(new Set(keys)));
    return new Set(rows.map((row) => text(row, "key")));
  };

  const rollbackReleased = async (operationId: string): Promise<boolean> =>
    (await readItems(operationId, RELEASE_OUTSTANDING)).length === 0;

  const requiredAcknowledged = async (
    operationId: string,
  ): Promise<boolean> => {
    const { header } = await requireHeader(operationId);
    // Unbounded on purpose: the compaction that empties the manifest may
    // share this unit of work, so the answer has to come from the
    // overlay-merged set rather than a `COUNT(*)` over storage.
    const openItems = await readItems(operationId, OPEN_ITEMS);
    return (
      openItems.length === 0 &&
      requiredReceipts.every((receipt) => header.receipts.includes(receipt))
    );
  };

  const writeHeader = async (
    current: Header,
    next: AccountDeletionManifestStatus,
    terminal?: Readonly<{ terminalAt: Date; retainUntil: Date }>,
  ): Promise<void> => {
    const changes: readonly (readonly [string, SqlValue])[] =
      terminal === undefined
        ? [["status", next]]
        : [
            ["status", next],
            ["terminal_at", toTimestamp(terminal.terminalAt)],
            ["retain_until", toTimestamp(terminal.retainUntil)],
          ];
    try {
      await session.write([
        // Every caller decided its transition from the status it read a
        // round trip earlier; the guard makes that decision conditional
        // on the status still being the one it judged.
        opaque(
          occGuard(
            statement(
              `SELECT 1 FROM ${HEADERS} WHERE operation_id = ? AND status = ?`,
              current.header.operationId,
              current.header.status,
            ),
          ),
        ),
        upsert({
          table: HEADERS,
          key: current.header.operationId,
          row: { ...current.raw, ...Object.fromEntries(changes) },
          statement: statement(
            `UPDATE ${HEADERS} SET ${changes
              .map(([column]) => `${column} = ?`)
              .join(", ")} WHERE operation_id = ? AND status = ?`,
            ...changes.map(([, value]) => value),
            current.header.operationId,
            current.header.status,
          ),
        }),
      ]);
    } catch (cause) {
      if (classifySqlError(cause) === "occGuard") {
        // Every caller reads "already at the status I wanted" as a no-op
        // success, so losing the race to that very transition has to land
        // on the same answer; anything else really is a violation.
        const landed = await findHeader(current.header.operationId);
        if (landed?.header.status === next) {
          return;
        }
        throw stateViolation(
          current.header.operationId,
          `status is no longer ${current.header.status}`,
        );
      }
      throw databaseError("the account deletion manifest store", cause);
    }
  };

  return {
    async describe(
      operationId: string,
    ): Promise<AccountDeletionManifestHeader | null> {
      return (await findHeader(operationId))?.header ?? null;
    },

    async begin(operationId: string, userId: UserId): Promise<void> {
      const existing = await findHeader(operationId);
      if (existing !== null) {
        return;
      }
      try {
        await session.write([
          // `opaque`, not `upsert`: the statement is a no-op when a header
          // is already there, so staging this call's row image would let a
          // later read in the same unit see a header the write never made.
          opaque(
            // A replayed begin must preserve everything already recorded,
            // so the insert never overwrites an existing header.
            statement(
              `INSERT INTO ${HEADERS}
                 (operation_id, user_id, status, membership_cursor, author_route_cursor, receipts, terminal_at, retain_until)
               VALUES (?, ?, 'building', NULL, NULL, '[]', NULL, NULL)
               ON CONFLICT (operation_id) DO NOTHING`,
              operationId,
              userId,
            ),
          ),
        ]);
      } catch (cause) {
        throw databaseError("the account deletion manifest store", cause);
      }
    },

    async appendMembershipPage(
      operationId: string,
      afterEdgeKey: string | null,
      limit: number,
    ): Promise<Readonly<{ count: number; nextCursor: string | null }>> {
      const current = await requireHeader(operationId);
      if (current.header.status !== "building") {
        throw stateViolation(operationId, "membership pages require building");
      }
      const effectiveLimit = cap(limit);
      // The cursor is built into the SQL instead of guarded by
      // `? IS NULL OR`: SQLite plans without looking at bound values, so
      // the OR form leaves the keyset as a residual predicate and every
      // page rescans the ones before it.
      const afterEdge = afterEdgeKey === null ? "" : " AND operation_id > ?";
      const edges = await session.query({
        sql: `SELECT operation_id AS edge_key, workspace_id, state, membership_id
             FROM ${EDGES}
            WHERE user_id = ? AND state IN ${DELETABLE_EDGE_STATES}${afterEdge}
            ORDER BY operation_id
            LIMIT ${effectiveLimit + 1}`,
        params:
          afterEdgeKey === null
            ? [current.header.userId]
            : [current.header.userId, afterEdgeKey],
      });
      const page = edges.slice(0, effectiveLimit);
      const last = page[page.length - 1];
      const nextCursor =
        edges.length > page.length && last !== undefined
          ? text(last, "edge_key")
          : null;

      const mutations: RowMutation[] = [];
      if (page.length > 0) {
        const images: readonly SqlRow[] = page.map((edge) => ({
          ...ITEM_NULLS,
          operation_id: operationId,
          key: `membership:${text(edge, "edge_key")}`,
          kind: "membership",
          workspace_id: text(edge, "workspace_id"),
          edge_state: text(edge, "state"),
          membership_id: textOrNull(edge, "membership_id"),
        }));
        // The insert is `DO NOTHING` on conflict, so a replayed page
        // leaves the existing row untouched: only the keys this call
        // actually creates get an overlay image.
        const alreadyFixed = await fixedAmong(
          operationId,
          images.map((image) => text(image, "key")),
        );
        mutations.push(
          upsertMany({
            table: ITEMS,
            rows: images
              .filter((image) => !alreadyFixed.has(text(image, "key")))
              .map((image) => [itemOverlayKey(image), image] as const),
            statement: statement(
              insertRowsFromJson({
                table: ITEMS,
                columns: [
                  "operation_id",
                  "key",
                  "kind",
                  "workspace_id",
                  "edge_state",
                  "membership_id",
                ],
                conflictKey: ["operation_id", "key"],
                conflict: "ignore",
              }),
              jsonRows(images),
            ),
          }),
        );
      }
      mutations.push(
        upsert({
          table: HEADERS,
          key: operationId,
          row: { ...current.raw, membership_cursor: nextCursor },
          statement: statement(
            `UPDATE ${HEADERS} SET membership_cursor = ? WHERE operation_id = ?`,
            nextCursor,
            operationId,
          ),
        }),
      );
      try {
        await session.write(mutations);
      } catch (cause) {
        throw databaseError("the account deletion manifest store", cause);
      }
      return { count: page.length, nextCursor };
    },

    async appendAuthorRoutePage(
      operationId: string,
      routes: readonly AccountDeletionAuthorRoute[],
      nextCursor: string | null,
    ): Promise<void> {
      const current = await requireHeader(operationId);
      if (current.header.status !== "building") {
        throw stateViolation(
          operationId,
          "author-route pages require building",
        );
      }
      const mutations: RowMutation[] = [];
      if (routes.length > 0) {
        const images: readonly SqlRow[] = routes.map((route) => ({
          ...ITEM_NULLS,
          operation_id: operationId,
          key: `authorRoute:${route.noteId}`,
          kind: "authorRoute",
          note_id: route.noteId,
          route_version: route.routeVersion,
        }));
        const alreadyFixed = await fixedAmong(
          operationId,
          images.map((image) => text(image, "key")),
        );
        mutations.push(
          upsertMany({
            table: ITEMS,
            rows: images
              .filter((image) => !alreadyFixed.has(text(image, "key")))
              .map((image) => [itemOverlayKey(image), image] as const),
            statement: statement(
              insertRowsFromJson({
                table: ITEMS,
                columns: [
                  "operation_id",
                  "key",
                  "kind",
                  "note_id",
                  "route_version",
                ],
                conflictKey: ["operation_id", "key"],
                conflict: "ignore",
              }),
              jsonRows(images),
            ),
          }),
        );
      }
      mutations.push(
        upsert({
          table: HEADERS,
          key: operationId,
          row: { ...current.raw, author_route_cursor: nextCursor },
          statement: statement(
            `UPDATE ${HEADERS} SET author_route_cursor = ? WHERE operation_id = ?`,
            nextCursor,
            operationId,
          ),
        }),
      );
      try {
        await session.write(mutations);
      } catch (cause) {
        throw databaseError("the account deletion manifest store", cause);
      }
    },

    async markBuilt(operationId: string): Promise<void> {
      const current = await requireHeader(operationId);
      if (current.header.status === "built") {
        return;
      }
      if (current.header.status !== "building") {
        throw stateViolation(
          operationId,
          `cannot mark ${current.header.status} built`,
        );
      }
      await writeHeader(current, "built");
    },

    async beginRollback(operationId: string): Promise<void> {
      const current = await requireHeader(operationId);
      if (current.header.status === "rollingBack") {
        return;
      }
      if (current.header.status !== "built") {
        throw stateViolation(
          operationId,
          `cannot roll back from ${current.header.status}`,
        );
      }
      await writeHeader(current, "rollingBack");
    },

    async claimPending(
      operationId: string,
      phase: AccountDeletionPhase,
      limit: number,
    ): Promise<readonly AccountDeletionManifestItem[]> {
      const { header } = await requireHeader(operationId);
      const requiredStatus = phase === "release" ? "rollingBack" : "built";
      if (header.status !== requiredStatus) {
        throw stateViolation(
          operationId,
          `phase ${phase} requires ${requiredStatus}, was ${header.status}`,
        );
      }
      const effectiveLimit = cap(limit);
      if (effectiveLimit === 0) {
        return [];
      }
      const rows = await readItems(operationId, CLAIMABLE[phase], {
        ordered: true,
        limit: effectiveLimit,
      });
      if (rows.length === 0 || phase === "cleanup" || phase === "redaction") {
        return rows.map(toItem);
      }

      // A remote command claims its deterministic key and `dispatchedAt`
      // before it is sent, and a replayed claim must hand back the very
      // same key — hence `COALESCE` rather than an unconditional write.
      const now = toTimestamp(clock.now());
      const column = phase === "prepare" ? "prepare" : "release";
      const keys = rows.map((row) => text(row, "key"));
      const claimed: readonly SqlRow[] = rows.map((row) => ({
        ...row,
        [`${column}_command_key`]:
          textOrNull(row, `${column}_command_key`) ??
          `${operationId}:${column}:${text(row, "key")}`,
        [`${column}_dispatched_at`]:
          intOrNull(row, `${column}_dispatched_at`) ?? now,
      }));
      try {
        await session.write([
          upsertMany({
            table: ITEMS,
            rows: claimed.map((row) => [itemOverlayKey(row), row] as const),
            statement: statement(
              `UPDATE ${ITEMS}
                  SET ${column}_command_key = COALESCE(${column}_command_key, ? || key),
                      ${column}_dispatched_at = COALESCE(${column}_dispatched_at, ?)
                WHERE operation_id = ? AND ${inJsonList("key")}`,
              `${operationId}:${column}:`,
              now,
              operationId,
              jsonList(keys),
            ),
          }),
        ]);
      } catch (cause) {
        throw databaseError("the account deletion manifest store", cause);
      }
      return claimed.map(toItem);
    },

    async acknowledge(
      operationId: string,
      itemKeys: readonly string[],
      phase: AccountDeletionAckPhase,
    ): Promise<void> {
      await requireHeader(operationId);
      if (itemKeys.length === 0) {
        return;
      }
      const [column, kind] =
        phase === "prepare"
          ? (["prepare_acked_at", "membership"] as const)
          : phase === "release"
            ? (["release_acked_at", "membership"] as const)
            : phase === "cleanup"
              ? (["cleanup_acked_at", "membership"] as const)
              : phase === "localRedaction"
                ? (["local_redaction_acked_at", "authorRoute"] as const)
                : (["public_redaction_acked_at", "authorRoute"] as const);
      const at = toTimestamp(clock.now());
      // `IS NULL` keeps the first ack, and a key this manifest does not
      // hold matches nothing rather than being resurrected. The staged
      // images repeat both rules so the overlay agrees with the statement.
      const stamped = await readItems(
        operationId,
        ackable(kind, column, new Set(itemKeys)),
      );
      try {
        await session.write([
          upsertMany({
            table: ITEMS,
            rows: stamped.map(
              (row) => [itemOverlayKey(row), { ...row, [column]: at }] as const,
            ),
            statement: statement(
              `UPDATE ${ITEMS} SET ${column} = ?
                WHERE operation_id = ? AND kind = ? AND ${column} IS NULL AND ${inJsonList("key")}`,
              at,
              operationId,
              kind,
              jsonList([...itemKeys]),
            ),
          }),
        ]);
      } catch (cause) {
        throw databaseError("the account deletion manifest store", cause);
      }
    },

    async acknowledgeReceipt(
      operationId: string,
      receipt: AccountDeletionReceipt,
    ): Promise<void> {
      const current = await requireHeader(operationId);
      if (current.header.receipts.includes(receipt)) {
        return;
      }
      try {
        await session.write([
          upsert({
            table: HEADERS,
            key: operationId,
            row: {
              ...current.raw,
              receipts: toJson([...current.header.receipts, receipt]),
            },
            // Receipts are a set filled by independent continuations, so
            // the append is done by the statement rather than from the
            // list read above: a read-modify-write would drop whichever
            // receipt a concurrent chain added in between, and no chain
            // acknowledges twice.
            statement: statement(
              `UPDATE ${HEADERS}
                  SET receipts = CASE
                        WHEN EXISTS (SELECT 1 FROM json_each(receipts) WHERE value = ?)
                          THEN receipts
                        ELSE json_insert(receipts, '$[#]', ?)
                      END
                WHERE operation_id = ?`,
              receipt,
              receipt,
              operationId,
            ),
          }),
        ]);
      } catch (cause) {
        throw databaseError("the account deletion manifest store", cause);
      }
    },

    async allRollbackReleased(operationId: string): Promise<boolean> {
      await requireHeader(operationId);
      return rollbackReleased(operationId);
    },

    allRequiredAcknowledged(operationId: string): Promise<boolean> {
      return requiredAcknowledged(operationId);
    },

    async compactItems(
      operationId: string,
      limit: number,
    ): Promise<Readonly<{ removed: number; remaining: boolean }>> {
      const { header } = await requireHeader(operationId);
      const rollback =
        header.status === "rollingBack" || header.status === "rejected";
      const success =
        header.status === "built" || header.status === "completed";
      if (!rollback && !success) {
        throw stateViolation(operationId, "compaction requires a settled path");
      }
      if (rollback && !(await rollbackReleased(operationId))) {
        throw stateViolation(
          operationId,
          "compaction requires every release ack",
        );
      }
      if (success && !(await requiredAcknowledged(operationId))) {
        throw stateViolation(
          operationId,
          "compaction requires every finalize ack",
        );
      }
      const effectiveLimit = cap(limit);
      const rows =
        effectiveLimit === 0
          ? []
          : await readItems(operationId, ALL_ITEMS, {
              ordered: true,
              limit: effectiveLimit,
            });
      const doomed = new Set(rows.map((row) => text(row, "key")));
      if (rows.length > 0) {
        try {
          await session.write([
            removeMany({
              table: ITEMS,
              keys: rows.map(itemOverlayKey),
              statement: statement(
                `DELETE FROM ${ITEMS} WHERE operation_id = ? AND ${inJsonList("key")}`,
                operationId,
                jsonList([...doomed]),
              ),
            }),
          ]);
        } catch (cause) {
          throw databaseError("the account deletion manifest store", cause);
        }
      }
      const rest = await readItems(operationId, withoutKeys(doomed), {
        limit: 1,
      });
      return { removed: rows.length, remaining: rest.length > 0 };
    },

    async markCompleted(
      operationId: string,
      terminalAt: Date,
      retainUntil: Date,
    ): Promise<void> {
      const current = await requireHeader(operationId);
      if (current.header.status === "completed") {
        return;
      }
      if (current.header.status !== "built") {
        throw stateViolation(
          operationId,
          `cannot complete from ${current.header.status}`,
        );
      }
      if (!(await requiredAcknowledged(operationId))) {
        throw stateViolation(operationId, "finalize acks are incomplete");
      }
      await writeHeader(current, "completed", { terminalAt, retainUntil });
    },

    async markRejected(
      operationId: string,
      terminalAt: Date,
      retainUntil: Date,
    ): Promise<void> {
      const current = await requireHeader(operationId);
      if (current.header.status === "rejected") {
        return;
      }
      if (current.header.status !== "rollingBack") {
        throw stateViolation(
          operationId,
          `cannot reject from ${current.header.status}`,
        );
      }
      if (!(await rollbackReleased(operationId))) {
        throw stateViolation(operationId, "release acks are incomplete");
      }
      await writeHeader(current, "rejected", { terminalAt, retainUntil });
    },

    async pruneTerminal(
      asOf: Date,
      cursor: string | null,
      limit: number,
    ): Promise<
      Readonly<{ operationIds: readonly string[]; nextCursor: string | null }>
    > {
      const effectiveLimit = cap(limit);
      if (effectiveLimit === 0) {
        return { operationIds: [], nextCursor: null };
      }
      const reclaimable = (row: SqlRow): boolean => {
        const status = row.status;
        const retainUntil = row.retain_until;
        return (
          (status === "completed" || status === "rejected") &&
          typeof retainUntil === "number" &&
          retainUntil <= toTimestamp(asOf) &&
          (cursor === null || text(row, "operation_id") > cursor)
        );
      };
      // Same reason as `appendMembershipPage`: a `? IS NULL OR` guard is
      // invisible to the planner, so the cursor is built into the SQL.
      const afterHeader = cursor === null ? "" : " AND operation_id > ?";
      const rows = await session.readRows({
        table: HEADERS,
        statement: {
          sql: `SELECT operation_id, status, retain_until FROM ${HEADERS}
             WHERE status IN ('completed', 'rejected')
               AND retain_until IS NOT NULL AND retain_until <= ?${afterHeader}
             ORDER BY operation_id
             LIMIT ${effectiveLimit + 1}`,
          params:
            cursor === null ? [toTimestamp(asOf)] : [toTimestamp(asOf), cursor],
        },
        keyOf: (row) => text(row, "operation_id"),
        matches: reclaimable,
        compare: (a, b) =>
          text(a, "operation_id") < text(b, "operation_id") ? -1 : 1,
        limit: effectiveLimit + 1,
      });
      const page = rows.slice(0, effectiveLimit);
      if (page.length === 0) {
        return { operationIds: [], nextCursor: null };
      }
      const operationIds = page.map((row) => text(row, "operation_id"));
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > page.length && last !== undefined
          ? text(last, "operation_id")
          : null;
      try {
        await session.write([
          // The only item write whose keys are not enumerable: a prune
          // drops whole manifests, and the items are named by the
          // operation they belong to rather than one by one.
          opaque(
            statement(
              deleteRowsFromJson(ITEMS, "operation_id"),
              jsonList(operationIds),
            ),
          ),
          removeMany({
            table: HEADERS,
            keys: operationIds,
            statement: statement(
              deleteRowsFromJson(HEADERS, "operation_id"),
              jsonList(operationIds),
            ),
          }),
        ]);
      } catch (cause) {
        throw databaseError("the account deletion manifest store", cause);
      }
      return { operationIds, nextCursor };
    },
  };
}
