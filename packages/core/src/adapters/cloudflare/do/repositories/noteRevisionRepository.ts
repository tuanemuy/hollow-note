import { NoteRevision } from "../../../../domain/note/noteRevision";
import type { NoteRevisionRepository } from "../../../../domain/note/ports/noteRevisionRepository";
import type { NoteId, RevisionId } from "../../../../domain/note/valueObject";
import { type RowMutation, remove, upsert } from "../../execution/writeSet";
import { throwTranslated } from "../../sql/errors";
import { date, int, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const TABLE = SCOPE_TABLES.noteRevisions;

const COLUMNS = [
  "id",
  "note_id",
  "html",
  "title",
  "title_origin",
  "style_mode",
  "created_by",
  "created_at",
  "reason",
] as const;

const SELECTION = COLUMNS.join(", ");
const INSERT_SQL = `INSERT INTO ${TABLE} (${SELECTION}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;

const toRow = (revision: NoteRevision): SqlRow => ({
  id: revision.id,
  note_id: revision.noteId,
  html: revision.html,
  title: revision.title.value,
  title_origin: revision.title.origin,
  style_mode: revision.styleMode,
  created_by: revision.createdBy,
  created_at: toTimestamp(revision.createdAt),
  reason: revision.reason,
});

const fromRow = (row: SqlRow): NoteRevision =>
  NoteRevision.reconstruct({
    id: text(row, "id"),
    noteId: text(row, "note_id"),
    html: text(row, "html"),
    title: text(row, "title"),
    titleOrigin: text(row, "title_origin"),
    styleMode: text(row, "style_mode"),
    createdBy: text(row, "created_by"),
    createdAt: date(row, "created_at"),
    reason: text(row, "reason"),
  });

const valuesOf = (row: SqlRow): readonly SqlValue[] =>
  COLUMNS.map((column) => row[column] ?? null);

const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** Newest first, `id` breaking a tie so the order is total. */
const newestFirst = (a: SqlRow, b: SqlRow): number =>
  int(b, "created_at") - int(a, "created_at") ||
  compareText(text(b, "id"), text(a, "id"));

export type CloudflareNoteRevisionRepositoryDeps = Readonly<{
  session: SqlSession;
}>;

/**
 * `note_revisions` of one scope object. Revisions are immutable, so
 * there is no OCC here — only inserts, ordered reads, and the two
 * bounded deletes the retention invariant needs.
 */
export function createCloudflareNoteRevisionRepository(
  deps: CloudflareNoteRevisionRepositoryDeps,
): NoteRevisionRepository {
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

  /** Every row of one note, newest first. The retention invariant keeps
   * this bounded (newest 20 per note), so it needs no paging. */
  const rowsOfNote = (noteId: NoteId): Promise<readonly SqlRow[]> =>
    session.readRows({
      table: TABLE,
      statement: statement(
        `SELECT ${SELECTION} FROM ${TABLE} WHERE note_id = ?
           ORDER BY created_at DESC, id DESC`,
        noteId,
      ),
      keyOf: (row) => text(row, "id"),
      matches: (row) => text(row, "note_id") === noteId,
      compare: newestFirst,
    });

  const deleteRows = (
    rows: readonly SqlRow[],
    context: string,
  ): Promise<void> =>
    write(
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
      context,
    );

  return {
    async insert(revision: NoteRevision): Promise<void> {
      const row = toRow(revision);
      await write(
        [
          upsert({
            table: TABLE,
            key: revision.id,
            row,
            statement: statement(INSERT_SQL, ...valuesOf(row)),
          }),
        ],
        `${TABLE} row ${revision.id}`,
      );
    },

    async listByNote(
      noteId: NoteId,
      limit: number,
    ): Promise<readonly NoteRevision[]> {
      const bounded = Math.max(0, limit);
      if (bounded === 0) {
        return [];
      }
      const rows = await rowsOfNote(noteId);
      return rows.slice(0, bounded).map(fromRow);
    },

    async findById(id: RevisionId): Promise<NoteRevision | null> {
      const row = await session.readRow({
        table: TABLE,
        key: id,
        statement: statement(
          `SELECT ${SELECTION} FROM ${TABLE} WHERE id = ?`,
          id,
        ),
      });
      return row === null ? null : fromRow(row);
    },

    async deleteOlderThanNewest(noteId: NoteId, keep: number): Promise<number> {
      const stale = (await rowsOfNote(noteId)).slice(Math.max(0, keep));
      if (stale.length === 0) {
        return 0;
      }
      await deleteRows(stale, `${TABLE} rows of note ${noteId}`);
      return stale.length;
    },

    async deleteByNote(noteId: NoteId): Promise<number> {
      const rows = await rowsOfNote(noteId);
      if (rows.length === 0) {
        return 0;
      }
      await deleteRows(rows, `${TABLE} rows of note ${noteId}`);
      return rows.length;
    },
  };
}
