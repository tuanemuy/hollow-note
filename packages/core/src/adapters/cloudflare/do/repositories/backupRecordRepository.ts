import { ConflictError } from "../../../../application/errors";
import { BackupRecord } from "../../../../domain/integration/backupRecord";
import type { BackupRecordRepository } from "../../../../domain/integration/ports/backupRecordRepository";
import type { NoteId } from "../../../../domain/note/valueObject";
import { type RowMutation, remove, upsert } from "../../execution/writeSet";
import { classifySqlError, throwTranslated } from "../../sql/errors";
import { date, int, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const TABLE = SCOPE_TABLES.backupRecords;

const COLUMNS = [
  "id",
  "user_id",
  "note_id",
  "source_file_id",
  "external_file_id",
  "web_view_url",
  "checksum_value",
  "version",
  "backed_up_at",
  "updated_at",
] as const;

const SELECTION = COLUMNS.join(", ");
const INSERT_SQL = `INSERT INTO ${TABLE} (${SELECTION}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;

const toRow = (record: BackupRecord): SqlRow => ({
  id: record.id,
  user_id: record.userId,
  note_id: record.noteId,
  source_file_id: record.sourceFileId,
  external_file_id: record.external.externalFileId,
  web_view_url: record.external.webViewUrl,
  checksum_value: record.checksum.value,
  version: record.version,
  backed_up_at: toTimestamp(record.backedUpAt),
  updated_at: toTimestamp(record.updatedAt),
});

const fromRow = (row: SqlRow): BackupRecord =>
  BackupRecord.reconstruct({
    id: text(row, "id"),
    userId: text(row, "user_id"),
    noteId: text(row, "note_id"),
    sourceFileId: text(row, "source_file_id"),
    externalFileId: text(row, "external_file_id"),
    webViewUrl: text(row, "web_view_url"),
    checksumValue: text(row, "checksum_value"),
    version: int(row, "version"),
    backedUpAt: date(row, "backed_up_at"),
    updatedAt: date(row, "updated_at"),
  });

const valuesOf = (row: SqlRow): readonly SqlValue[] =>
  COLUMNS.map((column) => row[column] ?? null);

const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const byId = (a: SqlRow, b: SqlRow): number =>
  compareText(text(a, "id"), text(b, "id"));

const sourceFileConflict = (record: BackupRecord): ConflictError =>
  new ConflictError(
    "BACKUP_RECORD_ALREADY_EXISTS",
    `Note ${record.noteId} already records a backup of ${record.sourceFileId}`,
  );

export type CloudflareBackupRecordRepositoryDeps = Readonly<{
  session: SqlSession;
}>;

/**
 * `backup_records` of one scope object.
 *
 * `user_id` is the connection owner, which may legitimately name someone
 * other than the party the object belongs to; it is attribution, not a
 * scope key, so nothing is checked against the object's own `ScopeKey`
 * here (the `_scope_identity` pin carries the separation).
 */
export function createCloudflareBackupRecordRepository(
  deps: CloudflareBackupRecordRepositoryDeps,
): BackupRecordRepository {
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

  const rowsOfNote = (
    noteId: NoteId,
    limit?: number,
  ): Promise<readonly SqlRow[]> => {
    const spec = {
      table: TABLE,
      statement: statement(
        `SELECT ${SELECTION} FROM ${TABLE} WHERE note_id = ?
           ORDER BY id${limit === undefined ? "" : " LIMIT ?"}`,
        ...(limit === undefined ? [noteId] : [noteId, limit]),
      ),
      keyOf: (row: SqlRow) => text(row, "id"),
      matches: (row: SqlRow) => text(row, "note_id") === noteId,
      compare: byId,
    };
    return session.readRows(limit === undefined ? spec : { ...spec, limit });
  };

  return {
    async insert(record: BackupRecord): Promise<void> {
      const row = toRow(record);
      try {
        await session.write([
          upsert({
            table: TABLE,
            key: record.id,
            row,
            statement: statement(INSERT_SQL, ...valuesOf(row)),
          }),
        ]);
      } catch (cause) {
        if (classifySqlError(cause) === "unique") {
          throw sourceFileConflict(record);
        }
        throwTranslated(`${TABLE} row ${record.id}`, cause);
      }
    },

    async listByNote(noteId: NoteId): Promise<readonly BackupRecord[]> {
      return (await rowsOfNote(noteId)).map(fromRow);
    },

    async deleteByNote(noteId: NoteId, limit: number): Promise<number> {
      const bounded = Math.max(0, limit);
      if (bounded === 0) {
        return 0;
      }
      const rows = await rowsOfNote(noteId, bounded);
      if (rows.length === 0) {
        return 0;
      }
      // One statement per row rather than a bulk `DELETE … LIMIT`: a
      // `remove` is also the overlay entry that stops a later read in the
      // same unit of work from seeing a row this one deleted, and the
      // page is bounded by the caller's budget.
      await write(
        rows.map((row) =>
          remove({
            table: TABLE,
            key: text(row, "id"),
            statement: statement(
              `DELETE FROM ${TABLE} WHERE id = ?`,
              text(row, "id"),
            ),
          }),
        ),
        `${TABLE} rows of note ${noteId}`,
      );
      return rows.length;
    },
  };
}
