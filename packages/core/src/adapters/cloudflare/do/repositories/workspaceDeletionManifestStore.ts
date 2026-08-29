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
import {
  type RowMutation,
  removeMany,
  upsert,
  upsertMany,
} from "../../execution/writeSet";
import { databaseError } from "../../sql/errors";
import {
  inJsonList,
  insertRowsFromJson,
  jsonList,
  jsonRows,
  notInJsonList,
} from "../../sql/json";
import {
  compositeKey,
  dateOrNull,
  enumOf,
  intOrNull,
  text,
  toTimestamp,
} from "../../sql/row";
import { ALL_ROWS, type SqlSession } from "../../sql/session";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";
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

/** The write-set key of an item row: its `(operation_id, key)` primary key. */
const itemOverlayKey = (row: SqlRow): string =>
  compositeKey(text(row, "operation_id"), text(row, "key"));

const byItemKey = (a: SqlRow, b: SqlRow): number => {
  const left = text(a, "key");
  const right = text(b, "key");
  return left < right ? -1 : left > right ? 1 : 0;
};

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
 * a statement at 100 bound parameters. Each of those statements still
 * names the item keys it touches (`upsertMany` / `removeMany`), so a unit
 * of work reads its own page back exactly as the memory backend does:
 * `markReady` sees the targets the same turn fixed, and `markCompleted`
 * sees the items the same turn reclaimed. Both state guards would
 * otherwise read a pre-transaction storage image, refuse, and strand the
 * deletion saga.
 *
 * The one read the overlay cannot repair is a `LIMIT`-ed page whose rows
 * this unit already wrote — the session refuses it rather than returning
 * a short page — which is no constraint on the saga: every turn reads its
 * page at the head and writes last.
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

  /**
   * Every item read goes through here so the staged page is merged in.
   * `matches` repeats the `WHERE` over a staged row image, which is why
   * the images the writers stage carry every item column.
   */
  const readItems = (
    input: Readonly<{
      where: string;
      params: readonly SqlValue[];
      matches: (row: SqlRow) => boolean;
      ordered?: true;
      limit?: number;
    }>,
  ): Promise<readonly SqlRow[]> =>
    session.readRows({
      table: ITEMS,
      statement: {
        sql: `SELECT * FROM ${ITEMS} WHERE ${input.where}${
          input.ordered === true ? " ORDER BY key" : ""
        }${input.limit === undefined ? "" : ` LIMIT ${input.limit}`}`,
        params: [...input.params],
      },
      keyOf: itemOverlayKey,
      matches: input.matches,
      ...(input.ordered === true ? { compare: byItemKey } : {}),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });

  const itemsOf =
    (operationId: string) =>
    (row: SqlRow): boolean =>
      text(row, "operation_id") === operationId;

  /** Which of `keys` this manifest already holds, staged pages included. */
  const fixedAmong = async (
    operationId: string,
    keys: readonly string[],
  ): Promise<ReadonlySet<string>> => {
    if (keys.length === 0) {
      return new Set();
    }
    const wanted = new Set(keys);
    const belongs = itemsOf(operationId);
    const rows = await readItems({
      where: `operation_id = ? AND ${inJsonList("key")}`,
      params: [operationId, jsonList([...wanted])],
      matches: (row) => belongs(row) && wanted.has(text(row, "key")),
    });
    return new Set(rows.map((row) => text(row, "key")));
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
    const wanted = new Set(itemKeys);
    const belongs = itemsOf(operationId);
    const at = toTimestamp(clock.now());
    const rows = await readItems({
      where: `operation_id = ? AND ${inJsonList("key")}`,
      params: [operationId, jsonList([...wanted])],
      matches: (row) => belongs(row) && wanted.has(text(row, "key")),
    });
    // `IS NULL` keeps the first timestamp, and a key that no longer
    // exists — compacted away, or never part of this manifest — simply
    // matches nothing rather than being resurrected. The staged images
    // repeat both rules so the overlay agrees with the statement.
    await write([
      upsertMany({
        table: ITEMS,
        rows: rows
          .filter((row) => intOrNull(row, column) === null)
          .map((row) => [itemOverlayKey(row), { ...row, [column]: at }]),
        statement: statement(
          `UPDATE ${ITEMS} SET ${column} = ?
            WHERE operation_id = ? AND ${column} IS NULL AND ${inJsonList("key")}`,
          at,
          operationId,
          jsonList([...wanted]),
        ),
      }),
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
      itemRow: (row: SqlRow) => SqlRow;
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
      const images = page.map(input.itemRow);
      // The insert is `DO NOTHING` on conflict, so a replayed page leaves
      // the existing row — timestamps included — untouched. Only the keys
      // this call actually creates get an overlay image.
      const alreadyFixed = await fixedAmong(
        input.operationId,
        images.map((image) => text(image, "key")),
      );
      mutations.push(
        upsertMany({
          table: ITEMS,
          rows: images
            .filter((image) => !alreadyFixed.has(text(image, "key")))
            .map((image) => [itemOverlayKey(image), image]),
          statement: statement(
            insertRowsFromJson({
              table: ITEMS,
              columns: input.itemColumns,
              conflictKey: ["operation_id", "key"],
              conflict: "ignore",
            }),
            jsonRows(images),
          ),
        }),
      );
    }
    mutations.push(cursorUpdate(header, input.cursorColumn, next));
    await write(mutations);
    return { next, count: page.length };
  };

  /**
   * Targets this manifest has not fixed yet.
   *
   * The `NOT EXISTS` half only sees committed items, so it is read as a
   * candidate list rather than an answer: whatever it returns is checked
   * against the overlay, which is where the page this very turn appended
   * lives. In the turn that readies a manifest the candidates are exactly
   * that page.
   */
  const unfixedTargets = async (
    operationId: string,
    table: string,
    kind: "membership" | "invitation",
    idColumn: "membership_id" | "invitation_id",
    keyOf: (id: string) => string,
  ): Promise<boolean> => {
    const rows = await session.query(
      statement(
        `SELECT t.id AS id FROM ${table} t
          WHERE NOT EXISTS (
            SELECT 1 FROM ${ITEMS} i
             WHERE i.operation_id = ? AND i.kind = ? AND i.${idColumn} = t.id
          )`,
        operationId,
        kind,
      ),
    );
    if (rows.length === 0) {
      return false;
    }
    const candidates = rows.map((row) => keyOf(text(row, "id")));
    const fixed = await fixedAmong(operationId, candidates);
    return candidates.some((key) => !fixed.has(key));
  };

  const remainingItems = (
    operationId: string,
    input: Readonly<{ excluding?: ReadonlySet<string>; limit?: number }> = {},
  ): Promise<readonly SqlRow[]> => {
    const excluded = input.excluding ?? new Set<string>();
    const belongs = itemsOf(operationId);
    return readItems({
      where:
        excluded.size === 0
          ? "operation_id = ?"
          : `operation_id = ? AND ${notInJsonList("key")}`,
      params:
        excluded.size === 0
          ? [operationId]
          : [operationId, jsonList([...excluded])],
      matches: (row) => belongs(row) && !excluded.has(text(row, "key")),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
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
          token_hash: null,
          invitation_id: null,
          local_deleted_at: null,
          global_acked_at: null,
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
          user_id: null,
          membership_id: null,
          token_hash: text(row, "token_hash"),
          invitation_id: text(row, "id"),
          local_deleted_at: null,
          global_acked_at: null,
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
          membershipKey,
        )) ||
        (await unfixedTargets(
          operationId,
          INVITATIONS,
          "invitation",
          "invitation_id",
          invitationKey,
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
      const belongs = itemsOf(operationId);
      const rows = await readItems({
        where: "operation_id = ? AND local_deleted_at IS NULL",
        params: [operationId],
        matches: (row) =>
          belongs(row) && intOrNull(row, "local_deleted_at") === null,
        ordered: true,
        limit: boundedLimit(limit),
      });
      return rows.map(toItem);
    },

    acknowledgeLocal(operationId, itemKeys): Promise<void> {
      return stamp(operationId, itemKeys, "local_deleted_at");
    },

    async listItems(operationId, cursor, limit) {
      await requireHeader(operationId);
      const bounded = boundedLimit(limit);
      const belongs = itemsOf(operationId);
      // Deliberately unfiltered by acknowledgement: the cursor walks the
      // full key order, and re-sending a delete for an acknowledged item
      // is a no-op on the target shard.
      const rows = await readItems({
        where:
          cursor === null ? "operation_id = ?" : "operation_id = ? AND key > ?",
        params: cursor === null ? [operationId] : [operationId, cursor],
        matches: (row) =>
          belongs(row) && (cursor === null || text(row, "key") > cursor),
        ordered: true,
        limit: bounded + 1,
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
      const belongs = itemsOf(operationId);
      const rows =
        bounded === 0
          ? []
          : await readItems({
              where:
                "operation_id = ? AND local_deleted_at IS NOT NULL AND global_acked_at IS NOT NULL",
              params: [operationId],
              matches: (row) =>
                belongs(row) &&
                intOrNull(row, "local_deleted_at") !== null &&
                intOrNull(row, "global_acked_at") !== null,
              ordered: true,
              limit: bounded,
            });
      const doomed = new Set(rows.map((row) => text(row, "key")));
      if (doomed.size > 0) {
        await write([
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
      }
      // Any item at all, not just a compactable one: the continuation
      // must keep re-registering while items await an acknowledgement.
      const rest = await remainingItems(operationId, {
        excluding: doomed,
        limit: 1,
      });
      return { removed: doomed.size, remaining: rest.length > 0 };
    },

    async markCompleted(operationId: string): Promise<void> {
      const header = await requireHeader(operationId);
      if (header.state === "completed") {
        return;
      }
      // Unbounded on purpose: the compaction that empties the manifest
      // may share this unit of work, so the count has to come from the
      // overlay-merged set rather than a `COUNT(*)` over storage.
      if ((await remainingItems(operationId)).length > 0) {
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
