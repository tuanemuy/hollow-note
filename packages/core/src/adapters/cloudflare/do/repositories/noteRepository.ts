import type { ScopeKey } from "../../../../application/scope";
import type {
  Pagination,
  PaginationResult,
} from "../../../../domain/common/pagination";
import type {
  ExpectedVersion,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import { Note, type TrashedNote } from "../../../../domain/note/note";
import type {
  NoteLifecycleFilter,
  NoteRepository,
} from "../../../../domain/note/ports/noteRepository";
import type {
  NoteHeading,
  NoteId,
  NoteOwner,
} from "../../../../domain/note/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import {
  dataIntegrityError,
  optimisticLockFailure,
  throwTranslated,
} from "../../sql/errors";
import { inJsonList, jsonList } from "../../sql/json";
import { occGuard } from "../../sql/occGuard";
import {
  date,
  dateOrNull,
  int,
  intOrNull,
  jsonOrNull,
  text,
  textOrNull,
  toJson,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import {
  type SqlRow,
  type SqlStatement,
  type SqlValue,
  statement,
} from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const TABLE = SCOPE_TABLES.notes;

const COLUMNS = [
  "id",
  "owner_type",
  "owner_id",
  "created_by",
  "title",
  "title_origin",
  "content_status",
  "content_html",
  "content_text",
  "content_excerpt",
  "content_headings",
  "content_failure_reason",
  "visibility",
  "published_at",
  "share_token_hash",
  "share_token_ciphertext",
  "share_token_key_version",
  "share_password_hash",
  "share_password_updated_at",
  "share_issued_at",
  "style_mode",
  "source_file_id",
  "lifecycle",
  "trashed_at",
  "purge_after",
  "version",
  "created_at",
  "updated_at",
] as const;

const SELECTION = COLUMNS.join(", ");
const MUTABLE = COLUMNS.filter((column) => column !== "id");

const INSERT_SQL = `INSERT INTO ${TABLE} (${SELECTION}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;
const UPDATE_SQL = `UPDATE ${TABLE} SET ${MUTABLE.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`;

const valuesOf = (
  row: SqlRow,
  columns: readonly string[],
): readonly SqlValue[] => columns.map((column) => row[column] ?? null);

const ownerColumns = (
  owner: NoteOwner,
): Readonly<{ type: string; id: string }> =>
  owner.type === "user"
    ? { type: "user", id: owner.userId }
    : { type: "workspace", id: owner.workspaceId };

const scopeColumns = (
  scope: ScopeKey,
): Readonly<{ type: string; id: string }> =>
  scope.type === "user"
    ? { type: "user", id: scope.userId }
    : { type: "workspace", id: scope.workspaceId };

const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const toRow = (note: Note): SqlRow => {
  const owner = ownerColumns(note.owner);
  const content = note.content;
  const link =
    note.visibility.status === "unlisted"
      ? note.visibility.shareLink
      : note.visibility.dormantShareLink;
  const password = link === null ? null : link.password;
  return {
    id: note.id,
    owner_type: owner.type,
    owner_id: owner.id,
    created_by: note.createdBy,
    title: note.title.value,
    title_origin: note.title.origin,
    content_status: content.status,
    content_html: content.status === "ready" ? content.html : null,
    content_text: content.status === "ready" ? content.text : null,
    content_excerpt: content.status === "ready" ? content.excerpt : null,
    content_headings:
      content.status === "ready" ? toJson(content.headings) : null,
    content_failure_reason: content.status === "failed" ? content.reason : null,
    visibility: note.visibility.status,
    published_at:
      note.visibility.status === "public"
        ? toTimestamp(note.visibility.publishedAt)
        : null,
    share_token_hash: link === null ? null : link.tokenHash,
    share_token_ciphertext:
      link === null ? null : link.protectedToken.cipherText,
    share_token_key_version:
      link === null ? null : link.protectedToken.keyVersion,
    share_password_hash: password === null ? null : password.hash,
    share_password_updated_at:
      password === null ? null : toTimestamp(password.updatedAt),
    share_issued_at: link === null ? null : toTimestamp(link.issuedAt),
    style_mode: note.styleMode,
    source_file_id: note.sourceFileId,
    lifecycle: note.lifecycle,
    trashed_at:
      note.lifecycle === "trashed" ? toTimestamp(note.trashedAt) : null,
    purge_after:
      note.lifecycle === "trashed" ? toTimestamp(note.purgeAfter) : null,
    version: note.version,
    created_at: toTimestamp(note.createdAt),
    updated_at: toTimestamp(note.updatedAt),
  };
};

const shareLinkOf = (
  row: SqlRow,
): Readonly<{
  tokenHash: string;
  cipherText: string;
  keyVersion: number;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  issuedAt: Date;
}> | null => {
  const tokenHash = textOrNull(row, "share_token_hash");
  if (tokenHash === null) {
    return null;
  }
  return {
    tokenHash,
    cipherText: text(row, "share_token_ciphertext"),
    keyVersion: int(row, "share_token_key_version"),
    passwordHash: textOrNull(row, "share_password_hash"),
    passwordUpdatedAt: dateOrNull(row, "share_password_updated_at"),
    issuedAt: date(row, "share_issued_at"),
  };
};

const fromRow = (row: SqlRow): Note => {
  const visibilityStatus = text(row, "visibility");
  const link = shareLinkOf(row);
  return Note.reconstruct({
    id: text(row, "id"),
    ownerType: text(row, "owner_type"),
    ownerId: text(row, "owner_id"),
    createdBy: text(row, "created_by"),
    title: text(row, "title"),
    titleOrigin: text(row, "title_origin"),
    contentStatus: text(row, "content_status"),
    failureReason: textOrNull(row, "content_failure_reason"),
    html: textOrNull(row, "content_html"),
    text: textOrNull(row, "content_text"),
    excerpt: textOrNull(row, "content_excerpt"),
    headings: jsonOrNull<readonly NoteHeading[]>(row, "content_headings") ?? [],
    visibilityStatus,
    publishedAt: dateOrNull(row, "published_at"),
    shareLink: visibilityStatus === "unlisted" ? link : null,
    dormantShareLink: visibilityStatus === "unlisted" ? null : link,
    styleMode: text(row, "style_mode"),
    sourceFileId: textOrNull(row, "source_file_id"),
    lifecycle: text(row, "lifecycle"),
    trashedAt: dateOrNull(row, "trashed_at"),
    purgeAfter: dateOrNull(row, "purge_after"),
    version: int(row, "version"),
    createdAt: date(row, "created_at"),
    updatedAt: date(row, "updated_at"),
  });
};

const lifecyclePredicate = (lifecycle: NoteLifecycleFilter): string =>
  lifecycle === "all" ? "" : " AND lifecycle = ?";

const lifecycleParams = (
  lifecycle: NoteLifecycleFilter,
): readonly SqlValue[] => (lifecycle === "all" ? [] : [lifecycle]);

export type CloudflareNoteRepositoryDeps = Readonly<{
  session: SqlSession;
  scope: ScopeKey;
}>;

/**
 * `notes` of one scope object.
 *
 * Unlike `stored_files` / `storage_quotas`, whose owner column records
 * *who the row counts against* and may legitimately differ from the
 * object it lives in, `notes.owner_type` / `owner_id` **is** the scope —
 * routing resolves a note to exactly the object its owner names — so the
 * `scope 検証` rule of `spec/database/index.md` の「共通の規約」 applies
 * here and is checked on both save and restore.
 */
export function createCloudflareNoteRepository(
  deps: CloudflareNoteRepositoryDeps,
): NoteRepository {
  const { session, scope } = deps;
  const bound = scopeColumns(scope);

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

  const contextOf = (id: string): string => `${TABLE} row ${id}`;

  const ensureOwnerInScope = (owner: NoteOwner): void => {
    const columns = ownerColumns(owner);
    if (columns.type !== bound.type || columns.id !== bound.id) {
      throw dataIntegrityError(
        `Note owner ${columns.type}:${columns.id} does not match the scope ${bound.type}:${bound.id}`,
      );
    }
  };

  const restore = (row: SqlRow): Note => {
    if (
      text(row, "owner_type") !== bound.type ||
      text(row, "owner_id") !== bound.id
    ) {
      throw dataIntegrityError(
        `Note ${text(row, "id")} is owned by ${text(row, "owner_type")}:${text(row, "owner_id")} but the scope is ${bound.type}:${bound.id}`,
      );
    }
    return fromRow(row);
  };

  const selectById = (id: NoteId): SqlStatement =>
    statement(`SELECT ${SELECTION} FROM ${TABLE} WHERE id = ?`, id);

  const guard = (id: NoteId, expectedVersion: number): SqlStatement =>
    occGuard(
      statement(
        `SELECT 1 FROM ${TABLE} WHERE id = ? AND version = ?`,
        id,
        expectedVersion,
      ),
    );

  /**
   * Reads the row the caller claims to hold a token for. The comparison
   * here is what turns a stale token into `OPTIMISTIC_LOCK_FAILURE` even
   * while the write is only staged; the `occGuard` staged alongside the
   * update is the fence against a unit that commits in between.
   */
  const readForUpdate = async (
    id: NoteId,
    expectedVersion: number,
  ): Promise<void> => {
    const current = await session.readRow({
      table: TABLE,
      key: id,
      statement: selectById(id),
    });
    if (current === null || int(current, "version") !== expectedVersion) {
      throw optimisticLockFailure(contextOf(id));
    }
  };

  return {
    async insert(note: Note): Promise<void> {
      ensureOwnerInScope(note.owner);
      const row = toRow(note);
      await write(
        [
          upsert({
            table: TABLE,
            key: note.id,
            row,
            statement: statement(INSERT_SQL, ...valuesOf(row, COLUMNS)),
          }),
        ],
        contextOf(note.id),
      );
    },

    async findById(id: NoteId): Promise<Versioned<Note> | null> {
      const row = await session.readRow({
        table: TABLE,
        key: id,
        statement: selectById(id),
      });
      if (row === null) {
        return null;
      }
      return {
        entity: restore(row),
        expectedVersion: int(row, "version") as ExpectedVersion<Note>,
      };
    },

    async save(
      note: Note,
      expectedVersion: ExpectedVersion<Note>,
    ): Promise<void> {
      ensureOwnerInScope(note.owner);
      await readForUpdate(note.id, expectedVersion);
      const row = toRow(note);
      await write(
        [
          opaque(guard(note.id, expectedVersion)),
          upsert({
            table: TABLE,
            key: note.id,
            row,
            statement: statement(
              UPDATE_SQL,
              ...valuesOf(row, MUTABLE),
              note.id,
            ),
          }),
        ],
        contextOf(note.id),
      );
    },

    async delete(
      id: NoteId,
      expectedVersion: ExpectedVersion<Note>,
    ): Promise<void> {
      await readForUpdate(id, expectedVersion);
      await write(
        [
          opaque(guard(id, expectedVersion)),
          remove({
            table: TABLE,
            key: id,
            statement: statement(`DELETE FROM ${TABLE} WHERE id = ?`, id),
          }),
        ],
        contextOf(id),
      );
    },

    async listByIds(ids: readonly NoteId[]): Promise<readonly Note[]> {
      if (ids.length === 0) {
        return [];
      }
      const wanted = new Set<string>(ids);
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT ${SELECTION} FROM ${TABLE} WHERE ${inJsonList("id")}`,
          jsonList(ids),
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) => wanted.has(text(row, "id")),
      });
      const byId = new Map(rows.map((row) => [text(row, "id"), row]));
      return ids
        .map((id) => byId.get(id))
        .filter((row): row is SqlRow => row !== undefined)
        .map(restore);
    },

    async listPurgeable(
      now: Date,
      limit: number,
    ): Promise<readonly TrashedNote[]> {
      const bounded = Math.max(0, limit);
      if (bounded === 0) {
        return [];
      }
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT ${SELECTION} FROM ${TABLE}
             WHERE lifecycle = 'trashed' AND purge_after <= ?
             ORDER BY purge_after, id LIMIT ?`,
          now.getTime(),
          bounded,
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) =>
          text(row, "lifecycle") === "trashed" &&
          (intOrNull(row, "purge_after") ?? Number.POSITIVE_INFINITY) <=
            now.getTime(),
        compare: (a, b) =>
          (intOrNull(a, "purge_after") ?? 0) -
            (intOrNull(b, "purge_after") ?? 0) ||
          compareText(text(a, "id"), text(b, "id")),
        limit: bounded,
      });
      return rows.map(restore).filter(Note.isTrashed);
    },

    async countByOwner(
      owner: NoteOwner,
      lifecycle: NoteLifecycleFilter,
    ): Promise<number> {
      const columns = ownerColumns(owner);
      const rows = await session.query(
        statement(
          `SELECT COUNT(*) AS total FROM ${TABLE}
             WHERE owner_type = ? AND owner_id = ?${lifecyclePredicate(lifecycle)}`,
          columns.type,
          columns.id,
          ...lifecycleParams(lifecycle),
        ),
      );
      return rows[0] === undefined ? 0 : int(rows[0], "total");
    },

    async listByOwner(
      owner: NoteOwner,
      lifecycle: NoteLifecycleFilter,
      pagination: Pagination,
    ): Promise<PaginationResult<Note>> {
      const columns = ownerColumns(owner);
      const limit = Math.max(0, pagination.limit);
      const offset = Math.max(0, (pagination.page - 1) * limit);
      const where = `WHERE owner_type = ? AND owner_id = ?${lifecyclePredicate(lifecycle)}`;
      const scoped = [columns.type, columns.id, ...lifecycleParams(lifecycle)];
      // Straight through rather than overlay-aware: an offset page cannot
      // be merged with staged rows without re-reading the whole set, and
      // every caller that pages (cleanup turns, projection rebuilds) reads
      // before it writes.
      const [items, totals] = await Promise.all([
        session.query(
          statement(
            `SELECT ${SELECTION} FROM ${TABLE} ${where}
               ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
            ...scoped,
            limit,
            offset,
          ),
        ),
        session.query(
          statement(
            `SELECT COUNT(*) AS total FROM ${TABLE} ${where}`,
            ...scoped,
          ),
        ),
      ]);
      return {
        items: items.map(restore),
        count: totals[0] === undefined ? 0 : int(totals[0], "total"),
      };
    },
  };
}
