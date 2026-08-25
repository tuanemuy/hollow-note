import type {
  ExpectedVersion,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import { Version } from "../../../../domain/common/version";
import { UserId } from "../../../../domain/identity/valueObject";
import type { StorageQuotaRepository } from "../../../../domain/usage/ports/storageQuotaRepository";
import type { StorageQuota } from "../../../../domain/usage/storageQuota";
import { ByteQuota, QuotaSubject } from "../../../../domain/usage/valueObject";
import { WorkspaceId } from "../../../../domain/workspace/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { optimisticLockFailure, throwTranslated } from "../../sql/errors";
import { inJsonList, jsonList } from "../../sql/json";
import { occGuard } from "../../sql/occGuard";
import { compositeKey, date, int, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import {
  type SqlRow,
  type SqlStatement,
  type SqlValue,
  statement,
} from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const TABLE = SCOPE_TABLES.storageQuotas;

const COLUMNS = [
  "subject_type",
  "subject_id",
  "limit_bytes",
  "consumed_bytes",
  "note_count",
  "version",
  "updated_at",
] as const;

const SELECTION = COLUMNS.join(", ");
const MUTABLE = COLUMNS.filter(
  (column) => column !== "subject_type" && column !== "subject_id",
);

const INSERT_SQL = `INSERT INTO ${TABLE} (${SELECTION}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;
const UPDATE_SQL = `UPDATE ${TABLE} SET ${MUTABLE.map((column) => `${column} = ?`).join(", ")} WHERE subject_type = ? AND subject_id = ?`;

/** The key both the SQL `IN` list and the write-set overlay agree on. */
const subjectColumns = (
  subject: QuotaSubject,
): Readonly<{ type: string; id: string }> =>
  subject.type === "user"
    ? { type: "user", id: subject.userId }
    : { type: "workspace", id: subject.workspaceId };

const overlayKey = (subject: QuotaSubject): string => {
  const columns = subjectColumns(subject);
  return compositeKey(columns.type, columns.id);
};

const rowKey = (row: SqlRow): string =>
  compositeKey(text(row, "subject_type"), text(row, "subject_id"));

/** `subject_type || ':' || subject_id`; neither part can contain `:`
 * in the type position, so the join is unambiguous. */
const listKey = (subject: QuotaSubject): string => {
  const columns = subjectColumns(subject);
  return `${columns.type}:${columns.id}`;
};

const toRow = (quota: StorageQuota): SqlRow => {
  const columns = subjectColumns(quota.subject);
  return {
    subject_type: columns.type,
    subject_id: columns.id,
    limit_bytes: quota.quota.limit,
    consumed_bytes: quota.consumedBytes,
    note_count: quota.noteCount,
    version: quota.version,
    updated_at: toTimestamp(quota.updatedAt),
  };
};

const fromRow = (row: SqlRow): StorageQuota => ({
  subject:
    text(row, "subject_type") === "user"
      ? QuotaSubject.user(UserId.create(text(row, "subject_id")))
      : QuotaSubject.workspace(WorkspaceId.create(text(row, "subject_id"))),
  quota: ByteQuota.create(int(row, "limit_bytes")),
  consumedBytes: int(row, "consumed_bytes"),
  noteCount: int(row, "note_count"),
  version: Version.create(int(row, "version")),
  updatedAt: date(row, "updated_at"),
});

const valuesOf = (
  row: SqlRow,
  columns: readonly string[],
): readonly SqlValue[] => columns.map((column) => row[column] ?? null);

export type CloudflareStorageQuotaRepositoryDeps = Readonly<{
  session: SqlSession;
}>;

/**
 * `storage_quotas` of one scope object, keyed by the subject itself.
 *
 * The subject is the accounting identity, not the physical scope — a
 * workspace's quota may be read from a personal scope's object during a
 * cross-owner move — so no scope check is applied to `subject_type` /
 * `subject_id` (compare `noteRepository.ts`).
 */
export function createCloudflareStorageQuotaRepository(
  deps: CloudflareStorageQuotaRepositoryDeps,
): StorageQuotaRepository {
  const { session } = deps;

  const write = async (
    mutations: readonly RowMutation[],
    context: string,
  ): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throwTranslated(context, cause);
    }
  };

  const selectBySubject = (subject: QuotaSubject): SqlStatement => {
    const columns = subjectColumns(subject);
    return statement(
      `SELECT ${SELECTION} FROM ${TABLE} WHERE subject_type = ? AND subject_id = ?`,
      columns.type,
      columns.id,
    );
  };

  const readRow = (subject: QuotaSubject): Promise<SqlRow | null> =>
    session.readRow({
      table: TABLE,
      key: overlayKey(subject),
      statement: selectBySubject(subject),
    });

  return {
    async find(subject: QuotaSubject): Promise<Versioned<StorageQuota> | null> {
      const row = await readRow(subject);
      if (row === null) {
        return null;
      }
      return {
        entity: fromRow(row),
        expectedVersion: int(row, "version") as ExpectedVersion<StorageQuota>,
      };
    },

    async insert(quota: StorageQuota): Promise<void> {
      const row = toRow(quota);
      await write(
        [
          upsert({
            table: TABLE,
            key: overlayKey(quota.subject),
            row,
            statement: statement(INSERT_SQL, ...valuesOf(row, COLUMNS)),
          }),
        ],
        `${TABLE} row ${listKey(quota.subject)}`,
      );
    },

    async save(
      quota: StorageQuota,
      expectedVersion: ExpectedVersion<StorageQuota>,
    ): Promise<void> {
      const context = `${TABLE} row ${listKey(quota.subject)}`;
      const current = await readRow(quota.subject);
      if (current === null || int(current, "version") !== expectedVersion) {
        throw optimisticLockFailure(context);
      }
      const columns = subjectColumns(quota.subject);
      const row = toRow(quota);
      await write(
        [
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${TABLE} WHERE subject_type = ? AND subject_id = ? AND version = ?`,
                columns.type,
                columns.id,
                expectedVersion,
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key: overlayKey(quota.subject),
            row,
            statement: statement(
              UPDATE_SQL,
              ...valuesOf(row, MUTABLE),
              columns.type,
              columns.id,
            ),
          }),
        ],
        context,
      );
    },

    async listBySubjects(
      subjects: readonly QuotaSubject[],
    ): Promise<readonly StorageQuota[]> {
      if (subjects.length === 0) {
        return [];
      }
      const wanted = new Set(subjects.map(listKey));
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT ${SELECTION} FROM ${TABLE} WHERE ${inJsonList("subject_type || ':' || subject_id")}`,
          jsonList([...wanted]),
        ),
        keyOf: rowKey,
        matches: (row) =>
          wanted.has(`${text(row, "subject_type")}:${text(row, "subject_id")}`),
      });
      const bySubject = new Map(rows.map((row) => [rowKey(row), row]));
      return subjects
        .map((subject) => bySubject.get(overlayKey(subject)))
        .filter((row): row is SqlRow => row !== undefined)
        .map(fromRow);
    },

    async delete(subject: QuotaSubject): Promise<void> {
      const columns = subjectColumns(subject);
      await write(
        [
          remove({
            table: TABLE,
            key: overlayKey(subject),
            statement: statement(
              `DELETE FROM ${TABLE} WHERE subject_type = ? AND subject_id = ?`,
              columns.type,
              columns.id,
            ),
          }),
        ],
        `${TABLE} row ${listKey(subject)}`,
      );
    },
  };
}
