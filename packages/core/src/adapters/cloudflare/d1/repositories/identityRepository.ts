import type {
  ExpectedVersion,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import type { Identity } from "../../../../domain/identity/identity";
import { Identity as IdentityAggregate } from "../../../../domain/identity/identity";
import type { IdentityRepository } from "../../../../domain/identity/ports/identityRepository";
import type {
  IdentityId,
  UserId,
} from "../../../../domain/identity/valueObject";
import { opaque, remove, upsert } from "../../execution/writeSet";
import { occGuard } from "../../sql/occGuard";
import { date, int, text, textOrNull, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import type { SqlRow } from "../../sql/statement";
import { statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import { createTableWriter, writeTranslated } from "./identitySupport";

const TABLE = GLOBAL_TABLES.identities;

const COLUMNS = [
  "id",
  "user_id",
  "kind",
  "password_hash",
  "provider",
  "provider_account_id",
  "provider_email",
  "version",
  "created_at",
  "updated_at",
] as const;

const writer = createTableWriter(TABLE, COLUMNS, ["id"]);

const toRow = (identity: Identity): SqlRow => ({
  id: identity.id,
  user_id: identity.userId,
  kind: identity.kind,
  password_hash: identity.kind === "password" ? identity.passwordHash : null,
  provider: identity.kind === "oauth" ? identity.provider : null,
  provider_account_id:
    identity.kind === "oauth" ? identity.providerAccountId : null,
  provider_email: identity.kind === "oauth" ? identity.providerEmail : null,
  version: identity.version,
  created_at: toTimestamp(identity.createdAt),
  updated_at: toTimestamp(identity.updatedAt),
});

const fromRow = (row: SqlRow): Identity =>
  IdentityAggregate.reconstruct({
    id: text(row, "id"),
    userId: text(row, "user_id"),
    kind: text(row, "kind"),
    version: int(row, "version"),
    createdAt: date(row, "created_at"),
    updatedAt: date(row, "updated_at"),
    passwordHash: textOrNull(row, "password_hash"),
    provider: textOrNull(row, "provider"),
    providerAccountId: textOrNull(row, "provider_account_id"),
    providerEmail: textOrNull(row, "provider_email"),
  });

/**
 * `identities` on global D1. Provider-account uniqueness is deliberately
 * not enforced here — `IdentityUniqueDirectory` is its only guard.
 */
export function createD1IdentityRepository(
  deps: Readonly<{ session: SqlSession }>,
): IdentityRepository {
  const { session } = deps;
  const guard = (id: IdentityId, expectedVersion: number) =>
    opaque(
      occGuard(
        statement(
          `SELECT 1 FROM ${TABLE} WHERE id = ? AND version = ?`,
          id,
          expectedVersion,
        ),
      ),
    );
  return {
    async insert(identity: Identity): Promise<void> {
      const row = toRow(identity);
      await writeTranslated(session, `${TABLE} insert`, [
        upsert({
          table: TABLE,
          key: identity.id,
          row,
          statement: writer.insert(row),
        }),
      ]);
    },

    async findById(id: IdentityId): Promise<Versioned<Identity> | null> {
      const row = await session.readRow({
        table: TABLE,
        key: id,
        statement: statement(`SELECT * FROM ${TABLE} WHERE id = ?`, id),
      });
      if (row === null) {
        return null;
      }
      return {
        entity: fromRow(row),
        expectedVersion: int(row, "version") as ExpectedVersion<Identity>,
      };
    },

    async save(
      identity: Identity,
      expectedVersion: ExpectedVersion<Identity>,
    ): Promise<void> {
      const row = toRow(identity);
      await writeTranslated(session, `${TABLE} row ${identity.id}`, [
        guard(identity.id, expectedVersion),
        upsert({
          table: TABLE,
          key: identity.id,
          row,
          statement: writer.upsert(row),
        }),
      ]);
    },

    async delete(
      id: IdentityId,
      expectedVersion: ExpectedVersion<Identity>,
    ): Promise<void> {
      await writeTranslated(session, `${TABLE} row ${id}`, [
        guard(id, expectedVersion),
        remove({
          table: TABLE,
          key: id,
          statement: statement(`DELETE FROM ${TABLE} WHERE id = ?`, id),
        }),
      ]);
    },

    async listByUserId(userId: UserId): Promise<readonly Identity[]> {
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT * FROM ${TABLE} WHERE user_id = ? ORDER BY created_at, id`,
          userId,
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) => textOrNull(row, "user_id") === userId,
        compare: (a, b) =>
          int(a, "created_at") - int(b, "created_at") ||
          (text(a, "id") < text(b, "id") ? -1 : 1),
      });
      return rows.map(fromRow);
    },
  };
}
