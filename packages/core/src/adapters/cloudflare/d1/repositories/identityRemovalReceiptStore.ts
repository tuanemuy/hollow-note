import type {
  IdentityRemovalReceipt,
  IdentityRemovalReceiptStore,
} from "../../../../application/ports/identityRemovalReceiptStore";
import type { PrunePage } from "../../../../domain/common/pagination";
import { IdentityId, UserId } from "../../../../domain/identity/valueObject";
import { opaque } from "../../execution/writeSet";
import { date, enumOf, text, textOrNull, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import type { SqlRow } from "../../sql/statement";
import { statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import {
  createTableWriter,
  deleteExpiredPage,
  writeTranslated,
} from "./identitySupport";

const TABLE = GLOBAL_TABLES.identityRemovalReceipts;

const COLUMNS = [
  "identity_id",
  "user_id",
  "operation_id",
  "kind",
  "provider_account_key",
  "expires_at",
] as const;

const writer = createTableWriter(TABLE, COLUMNS, ["identity_id"]);

const toRow = (receipt: IdentityRemovalReceipt): SqlRow => ({
  identity_id: receipt.identityId,
  user_id: receipt.userId,
  operation_id: receipt.operationId,
  kind: receipt.kind,
  provider_account_key: receipt.providerAccountKey,
  expires_at: toTimestamp(receipt.expiresAt),
});

const fromRow = (row: SqlRow): IdentityRemovalReceipt => ({
  operationId: text(row, "operation_id"),
  identityId: IdentityId.create(text(row, "identity_id")),
  userId: UserId.create(text(row, "user_id")),
  kind: enumOf(row, "kind", ["password", "oauth"]),
  providerAccountKey: textOrNull(row, "provider_account_key"),
  expiresAt: date(row, "expires_at"),
});

/**
 * `identity_removal_receipts` on global D1, keyed by `identity_id`.
 *
 * The first receipt of an identity wins: a lost-response retry and a
 * later removal attempt carrying another `operationId` both leave the
 * stored row untouched.
 */
export function createD1IdentityRemovalReceiptStore(
  deps: Readonly<{ session: SqlSession }>,
): IdentityRemovalReceiptStore {
  const { session } = deps;
  return {
    async record(receipt: IdentityRemovalReceipt): Promise<void> {
      const stored = await session.readRow({
        table: TABLE,
        key: receipt.identityId,
        statement: statement(
          `SELECT * FROM ${TABLE} WHERE identity_id = ?`,
          receipt.identityId,
        ),
      });
      if (stored !== null) {
        return;
      }
      // `opaque`, not `upsert`: the statement is a no-op when a receipt is
      // already there, so staging this call's row image would let a later
      // read in the same unit see a receipt the write never made.
      await writeTranslated(session, `${TABLE} insert`, [
        opaque(writer.insertIgnore(toRow(receipt))),
      ]);
    },

    async findByOperationId(
      operationId: string,
    ): Promise<IdentityRemovalReceipt | null> {
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT * FROM ${TABLE} WHERE operation_id = ? LIMIT 1`,
          operationId,
        ),
        keyOf: (row) => text(row, "identity_id"),
        matches: (row) => text(row, "operation_id") === operationId,
        limit: 1,
      });
      const row = rows[0];
      return row === undefined ? null : fromRow(row);
    },

    async findByIdentityId(
      identityId: IdentityId,
    ): Promise<IdentityRemovalReceipt | null> {
      const row = await session.readRow({
        table: TABLE,
        key: identityId,
        statement: statement(
          `SELECT * FROM ${TABLE} WHERE identity_id = ?`,
          identityId,
        ),
      });
      return row === null ? null : fromRow(row);
    },

    async deleteExpired(
      now: Date,
      cursor: string | null,
      limit: number,
    ): Promise<PrunePage> {
      return deleteExpiredPage(
        session,
        {
          table: TABLE,
          keyColumn: "identity_id",
          expiresColumn: "expires_at",
        },
        now,
        cursor,
        limit,
      );
    },
  };
}
