import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import { TokenHash, UserId } from "../../../../domain/identity/valueObject";
import type {
  WorkspaceDeletionManifestItem,
  WorkspaceDeletionManifestStore,
} from "../../../../domain/workspace/ports/workspaceDeletionManifestStore";
import {
  InvitationId,
  MembershipId,
  WorkspaceId,
} from "../../../../domain/workspace/valueObject";
import { opaque, type RowMutation, upsert } from "../../execution/writeSet";
import { databaseError } from "../../sql/errors";
import {
  inJsonList,
  insertRowsFromJson,
  jsonList,
  jsonRows,
} from "../../sql/json";
import { dateOrNull, enumOf, int, text, toTimestamp } from "../../sql/row";
import { ALL_ROWS, type SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const HEADERS = SCOPE_TABLES.workspaceDeletionManifests;
const ITEMS = SCOPE_TABLES.workspaceDeletionManifestItems;
const MEMBERSHIPS = SCOPE_TABLES.memberships;
const INVITATIONS = SCOPE_TABLES.invitations;
const CONTEXT = "the workspace deletion manifest store";

const PAGE_LIMIT = 100;

const HEADER_STATES = [
  "building",
  "ready",
  "localCleaning",
  "globalCleaning",
  "compacting",
  "completed",
] as const;
type HeaderState = (typeof HEADER_STATES)[number];

export type WorkspaceDeletionManifestHeader = Readonly<{
  operationId: string;
  workspaceId: WorkspaceId;
  state: HeaderState;
  raw: SqlRow;
}>;

const toHeader = (row: SqlRow): WorkspaceDeletionManifestHeader => ({
  operationId: text(row, "operation_id"),
  workspaceId: WorkspaceId.create(text(row, "workspace_id")),
  state: enumOf(row, "state", HEADER_STATES),
  raw: row,
});

/**
 * The scope's single manifest header, whatever operation owns it.
 *
 * One workspace per scope object, so one header — which is what lets
 * `WorkspaceOperationLockStore` answer admission from here once the
 * Workspace row itself is gone.
 */
export async function readManifestHeader(
  session: SqlSession,
): Promise<WorkspaceDeletionManifestHeader | null> {
  const rows = await session.readRows({
    table: HEADERS,
    statement: statement(`SELECT * FROM ${HEADERS} ORDER BY operation_id`),
    keyOf: (row) => text(row, "operation_id"),
    matches: ALL_ROWS,
  });
  const row = rows[0];
  return row === undefined ? null : toHeader(row);
}

const membershipKey = (id: string): string => `membership:${id}`;
const invitationKey = (id: string): string => `invitation:${id}`;

const stateViolation = (operationId: string, detail: string): ConflictError =>
  new ConflictError(
    "WORKSPACE_DELETION_MANIFEST_STATE_VIOLATION",
    `Manifest ${operationId}: ${detail}`,
  );

const boundedLimit = (limit: number): number =>
  Math.min(Math.max(0, Math.trunc(limit)), PAGE_LIMIT);

const toItem = (row: SqlRow): WorkspaceDeletionManifestItem =>
  text(row, "kind") === "membership"
    ? {
        key: text(row, "key"),
        kind: "membership",
        userId: UserId.create(text(row, "user_id")),
        membershipId: MembershipId.create(text(row, "membership_id")),
        localDeletedAt: dateOrNull(row, "local_deleted_at"),
        globalAckedAt: dateOrNull(row, "global_acked_at"),
      }
    : {
        key: text(row, "key"),
        kind: "invitation",
        tokenHash: TokenHash.create(text(row, "token_hash")),
        invitationId: InvitationId.create(text(row, "invitation_id")),
        localDeletedAt: dateOrNull(row, "local_deleted_at"),
        globalAckedAt: dateOrNull(row, "global_acked_at"),
      };

export type CloudflareWorkspaceDeletionManifestDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
}>;

/**
 * `workspace_deletion_manifests` and its items, in one workspace scope
 * object (`spec/database/index.md#workspace_deletion_manifests`).
 *
 * Every page — the two target walks, the acknowledgements, the compaction
 * — is one multi-row statement built with `json_each` rather than a
 * statement per row, since a page is up to 100 items and both planes cap
 * a statement at 100 bound parameters. Those writes therefore carry no
 * single-row image and are staged `opaque`, which is why the item reads
 * below go through `query` rather than the overlay-aware `readRows`.
 *
 * The header is the exception: it is one row per operation, so its cursor
 * and state transitions stage a full image and a turn that appends a page
 * and advances the cursor still reads its own header back.
 */
export function createCloudflareWorkspaceDeletionManifestStore(
  deps: CloudflareWorkspaceDeletionManifestDeps,
): WorkspaceDeletionManifestStore {
  const { session, clock } = deps;

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throw databaseError(CONTEXT, cause);
    }
  };

  const findHeader = async (
    operationId: string,
  ): Promise<WorkspaceDeletionManifestHeader | null> => {
    const row = await session.readRow({
      table: HEADERS,
      key: operationId,
      statement: statement(
        `SELECT * FROM ${HEADERS} WHERE operation_id = ?`,
        operationId,
      ),
    });
    return row === null ? null : toHeader(row);
  };

  const requireHeader = async (
    operationId: string,
  ): Promise<WorkspaceDeletionManifestHeader> => {
    const header = await findHeader(operationId);
    if (header === null) {
      throw stateViolation(operationId, "manifest does not exist");
    }
    return header;
  };

  const requireOpenHeader = async (
    operationId: string,
  ): Promise<WorkspaceDeletionManifestHeader> => {
    const header = await requireHeader(operationId);
    if (header.state === "completed") {
      throw stateViolation(operationId, "manifest is a completed tombstone");
    }
    return header;
  };

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

  const cursorUpdate = (
    header: WorkspaceDeletionManifestHeader,
    column: "membership_cursor" | "invitation_cursor",
    next: string | null,
  ): RowMutation =>
    upsert({
      table: HEADERS,
      key: header.operationId,
      row: {
        ...header.raw,
        [column]: next,
        updated_at: toTimestamp(clock.now()),
      },
      statement: statement(
        `UPDATE ${HEADERS} SET ${column} = ?, updated_at = ? WHERE operation_id = ?`,
        next,
        toTimestamp(clock.now()),
        header.operationId,
      ),
    });

  const stamp = async (
    operationId: string,
    itemKeys: readonly string[],
    column: "local_deleted_at" | "global_acked_at",
  ): Promise<void> => {
    await requireHeader(operationId);
    if (itemKeys.length === 0) {
      return;
    }
    // `IS NULL` keeps the first timestamp, and a key that no longer
    // exists — compacted away, or never part of this manifest — simply
    // matches nothing rather than being resurrected.
    await write([
      opaque(
        statement(
          `UPDATE ${ITEMS} SET ${column} = ?
            WHERE operation_id = ? AND ${column} IS NULL AND ${inJsonList("key")}`,
          toTimestamp(clock.now()),
          operationId,
          jsonList([...itemKeys]),
        ),
      ),
    ]);
  };

  /**
   * One target walk: a keyset page of the source table, the items it
   * fixes, and the header cursor, all in one write-set — so no target can
   * be skipped by a cursor that moved without its page.
   */
  const appendPage = async (
    input: Readonly<{
      operationId: string;
      table: string;
      after: string | null;
      limit: number;
      cursorColumn: "membership_cursor" | "invitation_cursor";
      selection: string;
      itemColumns: readonly string[];
      itemRow: (row: SqlRow) => Readonly<Record<string, string>>;
    }>,
  ): Promise<Readonly<{ next: string | null; count: number }>> => {
    const header = await requireOpenHeader(input.operationId);
    const limit = boundedLimit(input.limit);
    // The cursor is built into the SQL instead of guarded by
    // `? IS NULL OR`: SQLite plans without looking at bound values, so the
    // OR form leaves the keyset as a residual predicate.
    const keyset = input.after === null ? "" : " WHERE id > ?";
    const rows = await session.query({
      sql: `SELECT ${input.selection} FROM ${input.table}${keyset} ORDER BY id LIMIT ${limit + 1}`,
      params: input.after === null ? [] : [input.after],
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const next =
      rows.length > page.length && last !== undefined ? text(last, "id") : null;

    const mutations: RowMutation[] = [];
    if (page.length > 0) {
      mutations.push(
        opaque({
          table: ITEMS,
          statement: statement(
            insertRowsFromJson({
              table: ITEMS,
              columns: input.itemColumns,
              conflictKey: ["operation_id", "key"],
              conflict: "ignore",
            }),
            jsonRows(page.map(input.itemRow)),
          ),
        }),
      );
    }
    mutations.push(cursorUpdate(header, input.cursorColumn, next));
    await write(mutations);
    return { next, count: page.length };
  };

  const unfixedTargets = async (
    operationId: string,
    table: string,
    kind: "membership" | "invitation",
    idColumn: "membership_id" | "invitation_id",
  ): Promise<boolean> => {
    const rows = await session.query(
      statement(
        `SELECT 1 AS unfixed FROM ${table} t
          WHERE NOT EXISTS (
            SELECT 1 FROM ${ITEMS} i
             WHERE i.operation_id = ? AND i.kind = ? AND i.${idColumn} = t.id
          )
          LIMIT 1`,
        operationId,
        kind,
      ),
    );
    return rows.length > 0;
  };

  return {
    async appendMembershipPage(operationId, afterMembershipId, limit) {
      const page = await appendPage({
        operationId,
        table: MEMBERSHIPS,
        after: afterMembershipId,
        limit,
        cursorColumn: "membership_cursor",
        selection: "id, user_id",
        itemColumns: [
          "operation_id",
          "key",
          "kind",
          "user_id",
          "membership_id",
        ],
        itemRow: (row) => ({
          operation_id: operationId,
          key: membershipKey(text(row, "id")),
          kind: "membership",
          user_id: text(row, "user_id"),
          membership_id: text(row, "id"),
        }),
      });
      return {
        next: page.next === null ? null : MembershipId.create(page.next),
        count: page.count,
      };
    },

    async appendInvitationPage(operationId, afterInvitationId, limit) {
      const page = await appendPage({
        operationId,
        table: INVITATIONS,
        after: afterInvitationId,
        limit,
        cursorColumn: "invitation_cursor",
        selection: "id, token_hash",
        itemColumns: [
          "operation_id",
          "key",
          "kind",
          "token_hash",
          "invitation_id",
        ],
        itemRow: (row) => ({
          operation_id: operationId,
          key: invitationKey(text(row, "id")),
          kind: "invitation",
          token_hash: text(row, "token_hash"),
          invitation_id: text(row, "id"),
        }),
      });
      return {
        next: page.next === null ? null : InvitationId.create(page.next),
        count: page.count,
      };
    },

    async markReady(operationId: string): Promise<void> {
      const header = await requireOpenHeader(operationId);
      if (header.state !== "building") {
        return;
      }
      // "Both walks reached their end" read as the property it protects:
      // every target the closed scope still holds is fixed as an item. The
      // scope stopped accepting mutation at `beginDeletion`, so this is
      // stable however the walks were resumed.
      if (
        (await unfixedTargets(
          operationId,
          MEMBERSHIPS,
          "membership",
          "membership_id",
        )) ||
        (await unfixedTargets(
          operationId,
          INVITATIONS,
          "invitation",
          "invitation_id",
        ))
      ) {
        throw stateViolation(operationId, "targets are not fixed yet");
      }
      await write([
        upsert({
          table: HEADERS,
          key: operationId,
          row: {
            ...header.raw,
            state: "ready",
            updated_at: toTimestamp(clock.now()),
          },
          statement: statement(
            `UPDATE ${HEADERS} SET state = 'ready', updated_at = ? WHERE operation_id = ? AND state = 'building'`,
            toTimestamp(clock.now()),
            operationId,
          ),
        }),
      ]);
    },

    async listLocalPending(
      operationId: string,
      limit: number,
    ): Promise<readonly WorkspaceDeletionManifestItem[]> {
      await requireHeader(operationId);
      const rows = await itemRows(
        operationId,
        "AND local_deleted_at IS NULL",
        boundedLimit(limit),
      );
      return rows.map(toItem);
    },

    acknowledgeLocal(operationId, itemKeys): Promise<void> {
      return stamp(operationId, itemKeys, "local_deleted_at");
    },

    async listItems(operationId, cursor, limit) {
      await requireHeader(operationId);
      const bounded = boundedLimit(limit);
      // Deliberately unfiltered by acknowledgement: the cursor walks the
      // full key order, and re-sending a delete for an acknowledged item
      // is a no-op on the target shard.
      const rows = await session.query({
        sql: `SELECT * FROM ${ITEMS} WHERE operation_id = ?${
          cursor === null ? "" : " AND key > ?"
        } ORDER BY key LIMIT ${bounded + 1}`,
        params: cursor === null ? [operationId] : [operationId, cursor],
      });
      const page = rows.slice(0, bounded);
      const last = page[page.length - 1];
      return {
        items: page.map(toItem),
        nextCursor:
          rows.length > page.length && last !== undefined
            ? text(last, "key")
            : null,
      };
    },

    acknowledge(operationId, itemKeys): Promise<void> {
      return stamp(operationId, itemKeys, "global_acked_at");
    },

    async compactAcknowledged(operationId, limit) {
      await requireHeader(operationId);
      const bounded = boundedLimit(limit);
      const total = await countItems(operationId, "");
      const rows =
        bounded === 0
          ? []
          : await itemRows(
              operationId,
              "AND local_deleted_at IS NOT NULL AND global_acked_at IS NOT NULL",
              bounded,
            );
      if (rows.length > 0) {
        await write([
          opaque(
            statement(
              `DELETE FROM ${ITEMS} WHERE operation_id = ? AND ${inJsonList("key")}`,
              operationId,
              jsonList(rows.map((row) => text(row, "key"))),
            ),
          ),
        ]);
      }
      return {
        removed: rows.length,
        // Any item at all, not just a compactable one: the continuation
        // must keep re-registering while items await an acknowledgement.
        remaining: total > rows.length,
      };
    },

    async markCompleted(operationId: string): Promise<void> {
      const header = await requireHeader(operationId);
      if (header.state === "completed") {
        return;
      }
      if ((await countItems(operationId, "")) > 0) {
        throw stateViolation(operationId, "manifest still holds items");
      }
      await write([
        upsert({
          table: HEADERS,
          key: operationId,
          row: {
            ...header.raw,
            state: "completed",
            updated_at: toTimestamp(clock.now()),
          },
          statement: statement(
            `UPDATE ${HEADERS} SET state = 'completed', updated_at = ? WHERE operation_id = ?`,
            toTimestamp(clock.now()),
            operationId,
          ),
        }),
      ]);
    },
  };
}
