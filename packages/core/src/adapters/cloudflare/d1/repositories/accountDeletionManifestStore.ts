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
import { opaque, upsert } from "../../execution/writeSet";
import { databaseError } from "../../sql/errors";
import {
  deleteRowsFromJson,
  inJsonList,
  insertRowsFromJson,
  jsonList,
  jsonRows,
} from "../../sql/json";
import {
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
import { type SqlRow, statement } from "../../sql/statement";
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
 * The consequence is that those writes are `opaque`, so a unit of work
 * that appends a page does not read it back before it commits.
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

  // Item pages are read through `query`, not `readRows`: every item write
  // is a multi-row `json_each` statement with no single-row image, so the
  // write-set overlay has nothing to contribute here.
  const itemRows = (
    operationId: string,
    where: string,
    limit?: number,
  ): Promise<readonly SqlRow[]> =>
    session.query(
      statement(
        `SELECT * FROM ${ITEMS} WHERE operation_id = ? ${where} ORDER BY key${
          limit === undefined ? "" : ` LIMIT ${limit}`
        }`,
        operationId,
      ),
    );

  const countItems = async (
    operationId: string,
    where: string,
  ): Promise<number> => {
    const rows = await session.query(
      statement(
        `SELECT COUNT(*) AS item_count FROM ${ITEMS} WHERE operation_id = ? ${where}`,
        operationId,
      ),
    );
    const row = rows[0];
    return row === undefined ? 0 : int(row, "item_count");
  };

  const rollbackReleased = async (operationId: string): Promise<boolean> =>
    (await countItems(
      operationId,
      "AND kind = 'membership' AND prepare_dispatched_at IS NOT NULL AND release_acked_at IS NULL",
    )) === 0;

  const requiredAcknowledged = async (
    operationId: string,
  ): Promise<boolean> => {
    const { header } = await requireHeader(operationId);
    const openItems = await countItems(
      operationId,
      `AND (
         (kind = 'membership' AND (prepare_acked_at IS NULL OR cleanup_acked_at IS NULL))
         OR (kind = 'authorRoute' AND (local_redaction_acked_at IS NULL OR public_redaction_acked_at IS NULL))
       )`,
    );
    return (
      openItems === 0 &&
      requiredReceipts.every((receipt) => header.receipts.includes(receipt))
    );
  };

  const writeHeader = async (
    current: Header,
    changes: Readonly<Record<string, string | number | null>>,
    assignments: string,
    params: readonly (string | number | null)[],
  ): Promise<void> => {
    try {
      await session.write([
        upsert({
          table: HEADERS,
          key: current.header.operationId,
          row: { ...current.raw, ...changes },
          statement: statement(
            `UPDATE ${HEADERS} SET ${assignments} WHERE operation_id = ?`,
            ...params,
            current.header.operationId,
          ),
        }),
      ]);
    } catch (cause) {
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
      const row: SqlRow = {
        operation_id: operationId,
        user_id: userId,
        status: "building",
        membership_cursor: null,
        author_route_cursor: null,
        receipts: "[]",
        terminal_at: null,
        retain_until: null,
      };
      try {
        await session.write([
          upsert({
            table: HEADERS,
            key: operationId,
            row,
            // A replayed begin must preserve everything already recorded,
            // so the insert never overwrites an existing header.
            statement: statement(
              `INSERT INTO ${HEADERS}
                 (operation_id, user_id, status, membership_cursor, author_route_cursor, receipts, terminal_at, retain_until)
               VALUES (?, ?, 'building', NULL, NULL, '[]', NULL, NULL)
               ON CONFLICT (operation_id) DO NOTHING`,
              operationId,
              userId,
            ),
          }),
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
      const edges = await session.query(
        statement(
          `SELECT operation_id AS edge_key, workspace_id, state, membership_id
             FROM ${EDGES}
            WHERE user_id = ? AND state IN ${DELETABLE_EDGE_STATES}
              AND (? IS NULL OR operation_id > ?)
            ORDER BY operation_id
            LIMIT ${effectiveLimit + 1}`,
          current.header.userId,
          afterEdgeKey,
          afterEdgeKey,
        ),
      );
      const page = edges.slice(0, effectiveLimit);
      const last = page[page.length - 1];
      const nextCursor =
        edges.length > page.length && last !== undefined
          ? text(last, "edge_key")
          : null;

      const mutations = [];
      if (page.length > 0) {
        mutations.push(
          opaque(
            statement(
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
              jsonRows(
                page.map((edge) => ({
                  operation_id: operationId,
                  key: `membership:${text(edge, "edge_key")}`,
                  kind: "membership",
                  workspace_id: text(edge, "workspace_id"),
                  edge_state: text(edge, "state"),
                  membership_id: textOrNull(edge, "membership_id"),
                })),
              ),
            ),
          ),
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
      const mutations = [];
      if (routes.length > 0) {
        mutations.push(
          opaque(
            statement(
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
              jsonRows(
                routes.map((route) => ({
                  operation_id: operationId,
                  key: `authorRoute:${route.noteId}`,
                  kind: "authorRoute",
                  note_id: route.noteId,
                  route_version: route.routeVersion,
                })),
              ),
            ),
          ),
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
      await writeHeader(current, { status: "built" }, "status = 'built'", []);
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
      await writeHeader(
        current,
        { status: "rollingBack" },
        "status = 'rollingBack'",
        [],
      );
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
      if (phase === "redaction") {
        const rows = await itemRows(
          operationId,
          "AND kind = 'authorRoute' AND (local_redaction_acked_at IS NULL OR public_redaction_acked_at IS NULL)",
          effectiveLimit,
        );
        return rows.map(toItem);
      }
      const pending =
        phase === "prepare"
          ? "AND kind = 'membership' AND prepare_acked_at IS NULL"
          : phase === "release"
            ? "AND kind = 'membership' AND prepare_dispatched_at IS NOT NULL AND release_acked_at IS NULL"
            : "AND kind = 'membership' AND cleanup_acked_at IS NULL";
      const rows = await itemRows(operationId, pending, effectiveLimit);
      if (rows.length === 0 || phase === "cleanup") {
        return rows.map(toItem);
      }

      // A remote command claims its deterministic key and `dispatchedAt`
      // before it is sent, and a replayed claim must hand back the very
      // same key — hence `COALESCE` rather than an unconditional write.
      const now = toTimestamp(clock.now());
      const column = phase === "prepare" ? "prepare" : "release";
      const keys = rows.map((row) => text(row, "key"));
      const claimed = rows.map((row) => ({
        ...row,
        [`${column}_command_key`]:
          textOrNull(row, `${column}_command_key`) ??
          `${operationId}:${column}:${text(row, "key")}`,
        [`${column}_dispatched_at`]:
          intOrNull(row, `${column}_dispatched_at`) ?? now,
      }));
      try {
        await session.write([
          opaque(
            statement(
              `UPDATE ${ITEMS}
                  SET ${column}_command_key = COALESCE(${column}_command_key, ? || key),
                      ${column}_dispatched_at = COALESCE(${column}_dispatched_at, ?)
                WHERE operation_id = ? AND ${inJsonList("key")}`,
              `${operationId}:${column}:`,
              now,
              operationId,
              jsonList(keys),
            ),
          ),
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
      try {
        await session.write([
          opaque(
            statement(
              `UPDATE ${ITEMS} SET ${column} = ?
                WHERE operation_id = ? AND kind = ? AND ${column} IS NULL AND ${inJsonList("key")}`,
              toTimestamp(clock.now()),
              operationId,
              kind,
              jsonList([...itemKeys]),
            ),
          ),
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
      const receipts = toJson([...current.header.receipts, receipt]);
      await writeHeader(current, { receipts }, "receipts = ?", [receipts]);
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
      const total = await countItems(operationId, "");
      const rows =
        effectiveLimit === 0
          ? []
          : await itemRows(operationId, "", effectiveLimit);
      if (rows.length > 0) {
        try {
          await session.write([
            opaque(
              statement(
                `DELETE FROM ${ITEMS} WHERE operation_id = ? AND ${inJsonList("key")}`,
                operationId,
                jsonList(rows.map((row) => text(row, "key"))),
              ),
            ),
          ]);
        } catch (cause) {
          throw databaseError("the account deletion manifest store", cause);
        }
      }
      return { removed: rows.length, remaining: total > rows.length };
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
      await writeHeader(
        current,
        {
          status: "completed",
          terminal_at: toTimestamp(terminalAt),
          retain_until: toTimestamp(retainUntil),
        },
        "status = 'completed', terminal_at = ?, retain_until = ?",
        [toTimestamp(terminalAt), toTimestamp(retainUntil)],
      );
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
      await writeHeader(
        current,
        {
          status: "rejected",
          terminal_at: toTimestamp(terminalAt),
          retain_until: toTimestamp(retainUntil),
        },
        "status = 'rejected', terminal_at = ?, retain_until = ?",
        [toTimestamp(terminalAt), toTimestamp(retainUntil)],
      );
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
      const rows = await session.readRows({
        table: HEADERS,
        statement: statement(
          `SELECT operation_id, status, retain_until FROM ${HEADERS}
             WHERE status IN ('completed', 'rejected')
               AND retain_until IS NOT NULL AND retain_until <= ?
               AND (? IS NULL OR operation_id > ?)
             ORDER BY operation_id
             LIMIT ${effectiveLimit + 1}`,
          toTimestamp(asOf),
          cursor,
          cursor,
        ),
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
          opaque(
            statement(
              deleteRowsFromJson(ITEMS, "operation_id"),
              jsonList(operationIds),
            ),
          ),
          opaque(
            statement(
              deleteRowsFromJson(HEADERS, "operation_id"),
              jsonList(operationIds),
            ),
          ),
        ]);
      } catch (cause) {
        throw databaseError("the account deletion manifest store", cause);
      }
      return { operationIds, nextCursor };
    },
  };
}
