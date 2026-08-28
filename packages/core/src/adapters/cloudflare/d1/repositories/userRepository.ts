import type {
  ExpectedVersion,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import type { UserRepository } from "../../../../domain/identity/ports/userRepository";
import type { User } from "../../../../domain/identity/user";
import { User as UserAggregate } from "../../../../domain/identity/user";
import type { UserId } from "../../../../domain/identity/valueObject";
import { opaque, remove, upsert } from "../../execution/writeSet";
import { occGuard } from "../../sql/occGuard";
import {
  date,
  dateOrNull,
  int,
  text,
  textOrNull,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import type { SqlRow } from "../../sql/statement";
import { statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import { createTableWriter, writeTranslated } from "./identitySupport";

const TABLE = GLOBAL_TABLES.users;

const COLUMNS = [
  "id",
  "email",
  "status",
  "verified_at",
  "display_name",
  "bio",
  "avatar_url",
  "handle",
  "auth_epoch",
  "deletion_operation_id",
  "deleted_at",
  "version",
  "created_at",
  "updated_at",
] as const;

const writer = createTableWriter(TABLE, COLUMNS, ["id"]);

const toRow = (user: User): SqlRow =>
  user.status === "deleted"
    ? {
        id: user.id,
        email: null,
        status: "deleted",
        verified_at: null,
        display_name: null,
        bio: null,
        avatar_url: null,
        handle: null,
        auth_epoch: user.authEpoch,
        deletion_operation_id: null,
        deleted_at: toTimestamp(user.deletedAt),
        version: user.version,
        created_at: toTimestamp(user.createdAt),
        updated_at: toTimestamp(user.updatedAt),
      }
    : {
        id: user.id,
        email: user.email,
        status: user.status,
        verified_at:
          user.status === "pending" ? null : toTimestamp(user.verifiedAt),
        display_name: user.displayName,
        bio: user.bio,
        avatar_url: user.avatarUrl,
        handle: user.handle,
        auth_epoch: user.authEpoch,
        deletion_operation_id:
          user.status === "deleting" ? user.deletionOperationId : null,
        deleted_at: null,
        version: user.version,
        created_at: toTimestamp(user.createdAt),
        updated_at: toTimestamp(user.updatedAt),
      };

// The three PII columns are absent rather than `undefined` on a deleted
// user: `ReconstructInput` declares them optional, and the project runs
// with `exactOptionalPropertyTypes`.
const fromRow = (row: SqlRow): User => {
  const email = textOrNull(row, "email");
  const displayName = textOrNull(row, "display_name");
  const bio = textOrNull(row, "bio");
  return UserAggregate.reconstruct({
    id: text(row, "id"),
    status: text(row, "status"),
    ...(email === null ? {} : { email }),
    ...(displayName === null ? {} : { displayName }),
    ...(bio === null ? {} : { bio }),
    avatarUrl: textOrNull(row, "avatar_url"),
    handle: textOrNull(row, "handle"),
    authEpoch: int(row, "auth_epoch"),
    version: int(row, "version"),
    createdAt: date(row, "created_at"),
    updatedAt: date(row, "updated_at"),
    verifiedAt: dateOrNull(row, "verified_at"),
    deletionOperationId: textOrNull(row, "deletion_operation_id"),
    deletedAt: dateOrNull(row, "deleted_at"),
  });
};

const selectById = (id: UserId) =>
  statement(`SELECT * FROM ${TABLE} WHERE id = ?`, id);

/**
 * `users` on global D1. The `version` column carries the optimistic lock
 * and `_occ_guard` turns a mismatch into an aborted write-set, since a
 * conditional `UPDATE` matching nothing is not an error to SQLite.
 */
export function createD1UserRepository(
  deps: Readonly<{ session: SqlSession }>,
): UserRepository {
  const { session } = deps;
  const guard = (id: UserId, expectedVersion: number) =>
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
    async insert(user: User): Promise<void> {
      const row = toRow(user);
      await writeTranslated(session, `${TABLE} insert`, [
        upsert({
          table: TABLE,
          key: user.id,
          row,
          statement: writer.insert(row),
        }),
      ]);
    },

    async findById(id: UserId): Promise<Versioned<User> | null> {
      const row = await session.readRow({
        table: TABLE,
        key: id,
        statement: selectById(id),
      });
      if (row === null) {
        return null;
      }
      return {
        entity: fromRow(row),
        expectedVersion: int(row, "version") as ExpectedVersion<User>,
      };
    },

    async save(
      user: User,
      expectedVersion: ExpectedVersion<User>,
    ): Promise<void> {
      const row = toRow(user);
      await writeTranslated(session, `${TABLE} row ${user.id}`, [
        guard(user.id, expectedVersion),
        upsert({
          table: TABLE,
          key: user.id,
          row,
          statement: writer.upsert(row),
        }),
      ]);
    },

    async delete(
      id: UserId,
      expectedVersion: ExpectedVersion<User>,
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
  };
}

export { fromRow as userFromRow };
