import { ConflictError } from "../../../../application/errors";
import type {
  Pagination,
  PaginationResult,
} from "../../../../domain/common/pagination";
import type {
  ExpectedVersion,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import { Version } from "../../../../domain/common/version";
import { UserId } from "../../../../domain/identity/valueObject";
import { NoteId } from "../../../../domain/note/valueObject";
import {
  NOTE_DELETABLE_PURPOSES,
  type StoredFileRepository,
} from "../../../../domain/storage/ports/storedFileRepository";
import type {
  EphemeralFile,
  PersistentFile,
  StoredFile,
} from "../../../../domain/storage/storedFile";
import {
  ByteSize,
  Checksum,
  FILE_PURPOSES,
  FileName,
  type FilePurpose,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "../../../../domain/storage/valueObject";
import { WorkspaceId } from "../../../../domain/workspace/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import {
  classifySqlError,
  optimisticLockFailure,
  throwTranslated,
} from "../../sql/errors";
import { inJsonList, jsonList } from "../../sql/json";
import { occGuard } from "../../sql/occGuard";
import {
  date,
  dateOrNull,
  enumOf,
  int,
  text,
  textOrNull,
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

const TABLE = SCOPE_TABLES.storedFiles;

const COLUMNS = [
  "id",
  "owner_type",
  "owner_id",
  "uploaded_by",
  "purpose",
  "note_id",
  "note_version",
  "object_key",
  "file_name",
  "mime_type",
  "size",
  "checksum_algorithm",
  "checksum_value",
  "retention",
  "expires_at",
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
  owner: StorageOwner,
): Readonly<{ type: string; id: string }> =>
  owner.type === "user"
    ? { type: "user", id: owner.userId }
    : { type: "workspace", id: owner.workspaceId };

const ownerOf = (row: SqlRow): StorageOwner =>
  text(row, "owner_type") === "user"
    ? StorageOwner.user(UserId.create(text(row, "owner_id")))
    : StorageOwner.workspace(WorkspaceId.create(text(row, "owner_id")));

const toRow = (file: StoredFile): SqlRow => {
  const owner = ownerColumns(file.owner);
  return {
    id: file.id,
    owner_type: owner.type,
    owner_id: owner.id,
    uploaded_by: file.uploadedBy,
    purpose: file.purpose,
    note_id: file.noteId,
    note_version: file.purpose === "artifact" ? file.noteVersion : null,
    object_key: file.objectKey,
    file_name: file.fileName,
    mime_type: file.mimeType,
    size: file.size,
    checksum_algorithm: file.checksum.algorithm,
    checksum_value: file.checksum.value,
    retention: file.retention,
    expires_at:
      file.retention === "ephemeral" ? toTimestamp(file.expiresAt) : null,
    version: file.version,
    created_at: toTimestamp(file.createdAt),
    updated_at: toTimestamp(file.updatedAt),
  };
};

const baseOf = (row: SqlRow) => ({
  id: StoredFileId.create(text(row, "id")),
  owner: ownerOf(row),
  objectKey: ObjectKey.create(text(row, "object_key")),
  fileName: FileName.create(text(row, "file_name")),
  mimeType: MimeType.create(text(row, "mime_type")),
  size: ByteSize.create(int(row, "size")),
  checksum: Checksum.sha256(text(row, "checksum_value")),
  version: Version.create(int(row, "version")),
  createdAt: date(row, "created_at"),
  updatedAt: date(row, "updated_at"),
});

/**
 * Rebuilds the `FileProvenance` union from the discriminating columns.
 * There is no `StoredFile.reconstruct` in the domain — the aggregate has
 * no rehydration entry point — so the shape is assembled here and every
 * value object is built through its own constructor.
 */
const fromRow = (row: SqlRow): StoredFile => {
  const base = baseOf(row);
  const purpose: FilePurpose = enumOf(row, "purpose", FILE_PURPOSES);
  const noteIdRaw = textOrNull(row, "note_id");
  const uploadedByRaw = textOrNull(row, "uploaded_by");
  const uploadedBy =
    uploadedByRaw === null ? null : UserId.create(uploadedByRaw);
  const expiresAt = dateOrNull(row, "expires_at");

  if (purpose === "artifact") {
    const ephemeral: EphemeralFile = {
      ...base,
      retention: "ephemeral",
      expiresAt: date(row, "expires_at"),
      ...(noteIdRaw === null
        ? {
            purpose,
            noteId: null,
            noteVersion: null,
            uploadedBy,
          }
        : {
            purpose,
            noteId: NoteId.create(noteIdRaw),
            noteVersion: int(row, "note_version"),
            uploadedBy,
          }),
    };
    return ephemeral;
  }

  const provenance =
    purpose === "avatar"
      ? {
          purpose,
          noteId: null,
          uploadedBy: UserId.create(text(row, "uploaded_by")),
        }
      : {
          purpose,
          noteId: NoteId.create(text(row, "note_id")),
          uploadedBy: UserId.create(text(row, "uploaded_by")),
        };

  if (expiresAt !== null) {
    const ephemeral: EphemeralFile = {
      ...base,
      retention: "ephemeral",
      expiresAt,
      ...provenance,
    };
    return ephemeral;
  }
  const persistent: PersistentFile = {
    ...base,
    retention: "persistent",
    ...provenance,
  };
  return persistent;
};

const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const byId = (a: SqlRow, b: SqlRow): number =>
  compareText(text(a, "id"), text(b, "id"));

/** Oldest first, `id` breaking a tie so the order is total. */
const oldestFirst = (a: SqlRow, b: SqlRow): number =>
  int(a, "created_at") - int(b, "created_at") || byId(a, b);

const DELETABLE_PURPOSE_LIST = NOTE_DELETABLE_PURPOSES.map(
  (purpose) => `'${purpose}'`,
).join(", ");

const isDeletablePurpose = (purpose: string): boolean =>
  (NOTE_DELETABLE_PURPOSES as readonly string[]).includes(purpose);

const objectKeyConflict = (objectKey: string): ConflictError =>
  new ConflictError(
    "OBJECT_KEY_ALREADY_USED",
    `Object key already used: ${objectKey}`,
  );

export type CloudflareStoredFileRepositoryDeps = Readonly<{
  session: SqlSession;
}>;

/**
 * `stored_files` of one scope object.
 *
 * `owner_type` / `owner_id` is **not** the scope key here: the port's
 * JSDoc states that `StorageOwner` records who the bytes count against
 * and never overrides the physical scope (an anonymous export artifact
 * of a workspace note is owned by no user, ADR 010). The physical scope
 * is the object itself, which pins and checks its own `ScopeKey`
 * (`_scope_identity`), so no owner check is made here.
 */
export function createCloudflareStoredFileRepository(
  deps: CloudflareStoredFileRepositoryDeps,
): StoredFileRepository {
  const { session } = deps;

  const contextOf = (id: string): string => `${TABLE} row ${id}`;

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

  const selectById = (id: StoredFileId): SqlStatement =>
    statement(`SELECT ${SELECTION} FROM ${TABLE} WHERE id = ?`, id);

  const guard = (id: StoredFileId, expectedVersion: number): SqlStatement =>
    occGuard(
      statement(
        `SELECT 1 FROM ${TABLE} WHERE id = ? AND version = ?`,
        id,
        expectedVersion,
      ),
    );

  const readForUpdate = async (
    id: StoredFileId,
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
    async insert(file: StoredFile): Promise<void> {
      const clashes = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT ${SELECTION} FROM ${TABLE} WHERE object_key = ?`,
          file.objectKey,
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) => text(row, "object_key") === file.objectKey,
      });
      if (clashes.length > 0) {
        throw objectKeyConflict(file.objectKey);
      }
      const row = toRow(file);
      try {
        await session.write([
          upsert({
            table: TABLE,
            key: file.id,
            row,
            statement: statement(INSERT_SQL, ...valuesOf(row, COLUMNS)),
          }),
        ]);
      } catch (cause) {
        // The pre-read settles the ordinary case; the UNIQUE index is the
        // fence against a unit that claimed the same key concurrently.
        if (
          classifySqlError(cause) === "unique" &&
          String(cause).includes("object_key")
        ) {
          throw objectKeyConflict(file.objectKey);
        }
        throwTranslated(contextOf(file.id), cause);
      }
    },

    async findById(id: StoredFileId): Promise<Versioned<StoredFile> | null> {
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
        expectedVersion: int(row, "version") as ExpectedVersion<StoredFile>,
      };
    },

    async save(
      file: StoredFile,
      expectedVersion: ExpectedVersion<StoredFile>,
    ): Promise<void> {
      await readForUpdate(file.id, expectedVersion);
      const row = toRow(file);
      await write(
        [
          opaque(guard(file.id, expectedVersion)),
          upsert({
            table: TABLE,
            key: file.id,
            row,
            statement: statement(
              UPDATE_SQL,
              ...valuesOf(row, MUTABLE),
              file.id,
            ),
          }),
        ],
        contextOf(file.id),
      );
    },

    async delete(
      id: StoredFileId,
      expectedVersion: ExpectedVersion<StoredFile>,
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

    async listByIds(
      ids: readonly StoredFileId[],
    ): Promise<readonly StoredFile[]> {
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
        .map(fromRow);
    },

    async listDeletableByNote(
      noteId: NoteId,
      limit: number,
    ): Promise<readonly StoredFile[]> {
      const bounded = Math.max(0, limit);
      if (bounded === 0) {
        return [];
      }
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT ${SELECTION} FROM ${TABLE}
             WHERE note_id = ? AND purpose IN (${DELETABLE_PURPOSE_LIST})
             ORDER BY id LIMIT ?`,
          noteId,
          bounded,
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) =>
          textOrNull(row, "note_id") === noteId &&
          isDeletablePurpose(text(row, "purpose")),
        compare: byId,
        limit: bounded,
      });
      return rows.map(fromRow);
    },

    async listByPurposeOlderThan(
      purpose: FilePurpose,
      createdBefore: Date,
      limit: number,
    ): Promise<readonly StoredFile[]> {
      const bounded = Math.max(0, limit);
      if (bounded === 0) {
        return [];
      }
      const threshold = toTimestamp(createdBefore);
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT ${SELECTION} FROM ${TABLE}
             WHERE purpose = ? AND created_at <= ?
             ORDER BY created_at, id LIMIT ?`,
          purpose,
          threshold,
          bounded,
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) =>
          text(row, "purpose") === purpose &&
          int(row, "created_at") <= threshold,
        compare: oldestFirst,
        limit: bounded,
      });
      return rows.map(fromRow);
    },

    async listByOwner(
      owner: StorageOwner,
      purpose: FilePurpose | null,
      pagination: Pagination,
    ): Promise<PaginationResult<StoredFile>> {
      const columns = ownerColumns(owner);
      const limit = Math.max(0, pagination.limit);
      const offset = Math.max(0, (pagination.page - 1) * limit);
      const where = `WHERE owner_type = ? AND owner_id = ?${purpose === null ? "" : " AND purpose = ?"}`;
      const scoped: readonly SqlValue[] =
        purpose === null
          ? [columns.type, columns.id]
          : [columns.type, columns.id, purpose];
      const [items, totals] = await Promise.all([
        session.query(
          statement(
            `SELECT ${SELECTION} FROM ${TABLE} ${where} ORDER BY id LIMIT ? OFFSET ?`,
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
        items: items.map(fromRow),
        count: totals[0] === undefined ? 0 : int(totals[0], "total"),
      };
    },

    async sumSizeByOwner(owner: StorageOwner): Promise<number> {
      const columns = ownerColumns(owner);
      // Artifacts are expiring by-products and Usage leaves them out of
      // the total too (spec/domains/usage.md).
      const rows = await session.query(
        statement(
          `SELECT COALESCE(SUM(size), 0) AS total FROM ${TABLE}
             WHERE owner_type = ? AND owner_id = ? AND purpose <> 'artifact'`,
          columns.type,
          columns.id,
        ),
      );
      return rows[0] === undefined ? 0 : int(rows[0], "total");
    },
  };
}
