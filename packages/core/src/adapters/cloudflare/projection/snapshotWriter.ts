import type {
  AuthorRedaction,
  NoteProjectionEntry,
  ProjectedTagName,
  ProjectionVersion,
} from "../../../domain/note/ports/localNoteProjectionWriter";
import { WITHDRAWN_AUTHOR_DISPLAY_NAME } from "../../../domain/note/ports/localNoteProjectionWriter";
import type { NoteId } from "../../../domain/note/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../execution/writeSet";
import { bigramIndexText } from "../search/bigram";
import { throwTranslated } from "../sql/errors";
import { insertRowsFromJson, jsonRows } from "../sql/json";
import { text } from "../sql/row";
import type { SqlSession } from "../sql/session";
import { type SqlRow, type SqlStatement, statement } from "../sql/statement";
import {
  columnsOf,
  type NoteSearchPlane,
  redactedRow,
  snapshotRow,
} from "./noteSearchRow";

/**
 * The one writer of a `note_search*` triple, shared by both planes.
 *
 * `replaceSnapshotIfNewer` is the only path that writes the body row, the
 * tag filter rows, the two tag columns and the FTS index, and it writes
 * them in a single atomic unit — one `transactionSync` in a scope object,
 * one `batch()` on D1 (`spec/database/index.md#タグ列の同期契約`). Nothing
 * patches a field in isolation: a snapshot is replaced whole, so the
 * generation vector is the only thing that decides ordering.
 *
 * The FTS index is contentless, so a row cannot be overwritten — it has
 * to be withdrawn with the exact tokens it was inserted with and then
 * re-inserted. Those tokens are not stored anywhere; they are re-derived
 * by putting the raw `title` / `text` / `tag_names` columns of the row
 * being replaced back through `bigramIndexText`, which is pure and
 * therefore reproduces what went in.
 *
 * Both statements resolve `rowid` with a `SELECT … FROM <table> WHERE
 * note_id = ?` rather than a bound value. Inside a unit of work the body
 * row may not exist yet when the statement is built — it is staged in the
 * same write-set — so the rowid is only knowable at apply time, and this
 * is what lets one unit project the same note twice.
 */
export function createNoteSnapshotWriter(
  session: SqlSession,
  plane: NoteSearchPlane,
) {
  const columns = columnsOf(plane);

  const readStored = async (noteId: NoteId): Promise<SqlRow | null> =>
    session.readRow({
      table: plane.table,
      key: noteId,
      statement: statement(
        `SELECT * FROM ${plane.table} WHERE note_id = ?`,
        noteId,
      ),
    });

  const ftsMutation = (
    command: "delete" | "insert",
    row: SqlRow,
    noteId: NoteId,
  ): RowMutation => {
    const values: SqlStatement["params"] = [
      bigramIndexText(text(row, "title")),
      bigramIndexText(text(row, "text")),
      bigramIndexText(text(row, "tag_names")),
      noteId,
    ];
    return opaque(
      command === "delete"
        ? statement(
            `INSERT INTO ${plane.ftsTable}(${plane.ftsTable}, rowid, title_fts, text_fts, tag_names_fts)
             SELECT 'delete', rowid, ?, ?, ? FROM ${plane.table} WHERE note_id = ?`,
            ...values,
          )
        : statement(
            `INSERT INTO ${plane.ftsTable}(rowid, title_fts, text_fts, tag_names_fts)
             SELECT rowid, ?, ?, ? FROM ${plane.table} WHERE note_id = ?`,
            ...values,
          ),
    );
  };

  const bodyMutation = (noteId: NoteId, row: SqlRow): RowMutation =>
    upsert({
      table: plane.table,
      key: noteId,
      row,
      statement: statement(
        `INSERT INTO ${plane.table} (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})
         ON CONFLICT (note_id) DO UPDATE SET ${columns
           .filter((column) => column !== "note_id")
           .map((column) => `${column} = excluded.${column}`)
           .join(", ")}`,
        ...columns.map((column) => row[column] ?? null),
      ),
    });

  const tagMutations = (
    noteId: NoteId,
    tags: readonly ProjectedTagName[],
  ): readonly RowMutation[] => {
    const cleared = opaque(
      statement(`DELETE FROM ${plane.tagsTable} WHERE note_id = ?`, noteId),
    );
    if (tags.length === 0) {
      return [cleared];
    }
    return [
      cleared,
      opaque(
        statement(
          insertRowsFromJson({
            table: plane.tagsTable,
            columns: ["normalized", "note_id"],
            conflictKey: ["normalized", "note_id"],
            conflict: "ignore",
          }),
          jsonRows(
            tags.map((tag) => ({
              normalized: tag.normalized,
              note_id: noteId,
            })),
          ),
        ),
      ),
    ];
  };

  const write = async (
    context: string,
    mutations: readonly RowMutation[],
  ): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throwTranslated(context, cause);
    }
  };

  return {
    readStored,

    async replace(
      entry: NoteProjectionEntry,
      tags: readonly ProjectedTagName[],
      version: ProjectionVersion & Readonly<{ routeVersion?: number }>,
      stored: SqlRow | null,
    ): Promise<void> {
      const row = snapshotRow(plane, entry, tags, version);
      await write(`the ${plane.table} snapshot`, [
        ...(stored === null
          ? []
          : [ftsMutation("delete", stored, entry.noteId)]),
        bodyMutation(entry.noteId, row),
        ...tagMutations(entry.noteId, tags),
        ftsMutation("insert", row, entry.noteId),
      ]);
    },

    async remove(noteId: NoteId): Promise<void> {
      const stored = await readStored(noteId);
      await write(`the ${plane.table} row`, [
        // The withdrawal has to precede the body delete: it reads the
        // rowid back out of the row it is withdrawing.
        ...(stored === null ? [] : [ftsMutation("delete", stored, noteId)]),
        remove({
          table: plane.table,
          key: noteId,
          statement: statement(
            `DELETE FROM ${plane.table} WHERE note_id = ?`,
            noteId,
          ),
        }),
        opaque(
          statement(`DELETE FROM ${plane.tagsTable} WHERE note_id = ?`, noteId),
        ),
      ]);
    },

    /**
     * The author columns are outside the FTS index, so an erasure leaves
     * the tokens alone and only the body row changes.
     */
    async redactAuthor(input: AuthorRedaction): Promise<boolean> {
      const row = redactedRow(await readStored(input.noteId), input);
      if (row === null) {
        return false;
      }
      await write(`the ${plane.table} author`, [
        upsert({
          table: plane.table,
          key: input.noteId,
          row,
          statement: statement(
            `UPDATE ${plane.table}
             SET author_display_name = ?, author_handle = NULL, author_version = ?
             WHERE note_id = ? AND created_by = ? AND author_version < ?`,
            WITHDRAWN_AUTHOR_DISPLAY_NAME,
            input.redactionVersion,
            input.noteId,
            input.createdBy,
            input.redactionVersion,
          ),
        }),
      ]);
      return true;
    },
  };
}
