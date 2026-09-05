import { ConflictError } from "../../../../application/errors";
import type { ScopeKey } from "../../../../application/scope";
import type { NoteId } from "../../../../domain/note/valueObject";
import type { TagAssignmentRepository } from "../../../../domain/tag/ports/tagAssignmentRepository";
import { TagAssignment } from "../../../../domain/tag/tagAssignment";
import { type RowMutation, remove, upsert } from "../../execution/writeSet";
import {
  classifySqlError,
  databaseError,
  dataIntegrityError,
  throwTranslated,
} from "../../sql/errors";
import { date, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const TABLE = SCOPE_TABLES.tagAssignments;

const COLUMNS = [
  "id",
  "tag_id",
  "note_id",
  "scope_type",
  "scope_id",
  "assigned_by",
  "assigned_at",
] as const;

const SELECTION = COLUMNS.join(", ");
const INSERT_SQL = `INSERT INTO ${TABLE} (${SELECTION}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;

const toRow = (assignment: TagAssignment): SqlRow => ({
  id: assignment.id,
  tag_id: assignment.tagId,
  note_id: assignment.noteId,
  scope_type: assignment.scope.type,
  scope_id:
    assignment.scope.type === "user"
      ? assignment.scope.userId
      : assignment.scope.workspaceId,
  assigned_by: assignment.assignedBy,
  assigned_at: toTimestamp(assignment.assignedAt),
});

const fromRow = (row: SqlRow): TagAssignment =>
  TagAssignment.reconstruct({
    id: text(row, "id"),
    tagId: text(row, "tag_id"),
    noteId: text(row, "note_id"),
    scopeType: text(row, "scope_type"),
    scopeId: text(row, "scope_id"),
    assignedBy: text(row, "assigned_by"),
    assignedAt: date(row, "assigned_at"),
  });

const valuesOf = (row: SqlRow): readonly SqlValue[] =>
  COLUMNS.map((column) => row[column] ?? null);

const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const scopeColumns = (
  scope: ScopeKey | TagAssignment["scope"],
): Readonly<{ type: string; id: string }> =>
  scope.type === "user"
    ? { type: "user", id: scope.userId }
    : { type: "workspace", id: scope.workspaceId };

const byId = (a: SqlRow, b: SqlRow): number =>
  compareText(text(a, "id"), text(b, "id"));

const pairConflict = (assignment: TagAssignment): ConflictError =>
  new ConflictError(
    "ASSIGNMENT_ALREADY_EXISTS",
    `Tag ${assignment.tagId} is already assigned to note ${assignment.noteId}`,
  );

/**
 * Re-using an assignment id is a caller fault, not "somebody already
 * claimed this pair": the two unique constraints of this table mean
 * different things, and mapping both to `ASSIGNMENT_ALREADY_EXISTS`
 * would answer a different error kind than the other backends do.
 */
const duplicateId = (assignment: TagAssignment) =>
  databaseError(`Duplicate primary key in ${TABLE}: ${assignment.id}`);

export type CloudflareTagAssignmentRepositoryDeps = Readonly<{
  session: SqlSession;
  scope: ScopeKey;
}>;

/**
 * `tag_assignments` of one scope object. Assignments are immutable, so
 * there is no OCC here — only inserts, the per-note read, and the
 * bounded delete the note purge walks.
 *
 * `scope_type` / `scope_id` is a scope key, not attribution: an
 * assignment lives in the scope of the note it is on
 * (spec/domains/tag.md), so a row naming another object is either a
 * write that went to the wrong place or a read that crossed objects.
 * Like `notes.owner_type` / `owner_id`, it is checked against the
 * object's own `_scope_identity` pin on every path that touches these
 * rows (`spec/database/index.md` の「共通の規約」): the save (`insert`),
 * the restore (`listByNote`), and the bounded delete (`deleteByNote`),
 * which is neither of the two yet is the only path the `note.purged`
 * fan-out takes. The delete answers a crossing the way the read does —
 * it reports it and removes nothing. `backup_records.user_id`
 * is the other case and is deliberately unchecked — it names the
 * connection whose Drive holds the copy, not the object holding the row.
 */
export function createCloudflareTagAssignmentRepository(
  deps: CloudflareTagAssignmentRepositoryDeps,
): TagAssignmentRepository {
  const { session } = deps;
  const bound = scopeColumns(deps.scope);

  const ensureScopeOf = (assignment: TagAssignment): void => {
    const columns = scopeColumns(assignment.scope);
    if (columns.type !== bound.type || columns.id !== bound.id) {
      throw dataIntegrityError(
        `Tag assignment scope ${columns.type}:${columns.id} does not match the scope ${bound.type}:${bound.id}`,
      );
    }
  };

  const ensureScopeOfRow = (row: SqlRow): void => {
    if (
      text(row, "scope_type") !== bound.type ||
      text(row, "scope_id") !== bound.id
    ) {
      throw dataIntegrityError(
        `Tag assignment ${text(row, "id")} is scoped to ${text(row, "scope_type")}:${text(row, "scope_id")} but the scope is ${bound.type}:${bound.id}`,
      );
    }
  };

  const restore = (row: SqlRow): TagAssignment => {
    ensureScopeOfRow(row);
    return fromRow(row);
  };

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

  const clashOf = async (
    assignment: TagAssignment,
  ): Promise<"id" | "pair" | null> => {
    const rows = await session.readRows({
      table: TABLE,
      statement: statement(
        `SELECT ${SELECTION} FROM ${TABLE}
           WHERE id = ? OR (tag_id = ? AND note_id = ?)`,
        assignment.id,
        assignment.tagId,
        assignment.noteId,
      ),
      keyOf: (row: SqlRow) => text(row, "id"),
      matches: (row: SqlRow) =>
        text(row, "id") === assignment.id ||
        (text(row, "tag_id") === assignment.tagId &&
          text(row, "note_id") === assignment.noteId),
    });
    if (rows.some((row) => text(row, "id") === assignment.id)) {
      return "id";
    }
    return rows.length > 0 ? "pair" : null;
  };

  return {
    async insert(assignment: TagAssignment): Promise<void> {
      ensureScopeOf(assignment);
      const clash = await clashOf(assignment);
      if (clash === "id") {
        throw duplicateId(assignment);
      }
      if (clash === "pair") {
        throw pairConflict(assignment);
      }
      const row = toRow(assignment);
      try {
        await session.write([
          upsert({
            table: TABLE,
            key: assignment.id,
            row,
            statement: statement(INSERT_SQL, ...valuesOf(row)),
          }),
        ]);
      } catch (cause) {
        // The pre-read settles the ordinary case; the UNIQUE index is
        // the fence against a unit that claimed the same pair
        // concurrently. Only that index means "already assigned" — a
        // primary-key violation falls through to the database fault the
        // other backends raise for it.
        if (
          classifySqlError(cause) === "unique" &&
          String(cause).includes(`${TABLE}.tag_id`)
        ) {
          throw pairConflict(assignment);
        }
        throwTranslated(`${TABLE} row ${assignment.id}`, cause);
      }
    },

    async listByNote(noteId: NoteId): Promise<readonly TagAssignment[]> {
      return (await rowsOfNote(noteId)).map(restore);
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
      // The page is checked before a single row goes, so a repository
      // bound to the wrong object deletes nothing at all rather than
      // partially — the same pin, and the same "report, do not repair",
      // that the read side applies.
      for (const row of rows) {
        ensureScopeOfRow(row);
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
