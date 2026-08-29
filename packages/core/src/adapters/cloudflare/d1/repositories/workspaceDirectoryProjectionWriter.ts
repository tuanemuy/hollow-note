import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type {
  WorkspaceDirectoryProjectionWriter,
  WorkspaceDirectorySnapshot,
} from "../../../../domain/workspace/ports/workspaceDirectoryProjectionWriter";
import {
  type WorkspaceId,
  WorkspaceName,
} from "../../../../domain/workspace/valueObject";
import { opaque, type RowMutation, upsert } from "../../execution/writeSet";
import { classifySqlError, databaseError } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import { int, text, textOrNull, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.workspaceDirectory;
const CONTEXT = "the workspace directory projection";

/**
 * Display name a tombstone keeps. The row survives the workspace so the
 * batch reader can answer `deleted`, and that answer carries no fields,
 * so nothing the workspace was named has to stay behind
 * (spec/database/index.md `workspace_directory`).
 */
const REDACTED_NAME = WorkspaceName.create("(deleted)");

const tombstonedByAnother = (workspaceId: WorkspaceId): ConflictError =>
  new ConflictError(
    "WORKSPACE_DIRECTORY_CONFLICT",
    `Workspace ${workspaceId} is already tombstoned by another deletion`,
  );

type DirectoryRow = Readonly<{
  lifecycle: string;
  deletionOperationId: string | null;
  sourceVersion: number;
  publication: string;
  raw: SqlRow;
}>;

const toRow = (row: SqlRow): DirectoryRow => ({
  lifecycle: text(row, "lifecycle"),
  deletionOperationId: textOrNull(row, "deletion_operation_id"),
  sourceVersion: int(row, "source_version"),
  publication: text(row, "publication"),
  raw: row,
});

export type D1WorkspaceDirectoryProjectionWriterDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
}>;

/**
 * Writer of the `workspace_directory` projection on global D1
 * (`spec/database/index.md#workspace_directory`).
 *
 * Both methods decide their branch from the row they just read and stage
 * a statement that repeats the predicate, so a concurrent projection of a
 * newer version — or a tombstone landing in between — leaves the row it
 * wrote rather than being overwritten by a decision taken over a state
 * that no longer holds. `source_version` is the whole ordering: an event
 * redelivered after a newer one changes nothing.
 *
 * The `slug UNIQUE` index is satisfied by taking the slug rather than by
 * failing on it. The reservation table is the authority on ownership, so
 * the row still holding a slug that this workspace has reserved is stale,
 * and the release is staged in the same write-set as the apply — under
 * the same predicate, so a snapshot that turns out to write nothing
 * takes nothing away either.
 */
export function createD1WorkspaceDirectoryProjectionWriter(
  deps: D1WorkspaceDirectoryProjectionWriterDeps,
): WorkspaceDirectoryProjectionWriter {
  const { session, clock } = deps;

  const read = async (
    workspaceId: WorkspaceId,
  ): Promise<DirectoryRow | null> => {
    const row = await session.readRow({
      table: TABLE,
      key: workspaceId,
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE workspace_id = ?`,
        workspaceId,
      ),
    });
    return row === null ? null : toRow(row);
  };

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throw databaseError(CONTEXT, cause);
    }
  };

  /**
   * Frees the slug from whichever other row still projects it.
   *
   * The `NOT EXISTS` is the same guard the apply carries, so the two
   * statements stand or fall together: the branch was decided from a
   * `read` issued a round trip earlier, and if a newer snapshot or a
   * tombstone lands in between, an unconditional release would strip a
   * third workspace's slug — dropping it out of the sitemap until its
   * own next event — while the apply that was going to take the slug
   * writes nothing.
   */
  const releaseSlug = (
    slug: string,
    owner: WorkspaceId,
    sourceVersion: number,
  ): RowMutation =>
    opaque({
      table: TABLE,
      statement: statement(
        `UPDATE ${TABLE} SET slug = NULL
           WHERE slug = ? AND workspace_id <> ?
             AND NOT EXISTS (
               SELECT 1 FROM ${TABLE} taker
                WHERE taker.workspace_id = ?
                  AND (taker.lifecycle <> 'active'
                       OR taker.source_version >= ?))`,
        slug,
        owner,
        owner,
        sourceVersion,
      ),
    });

  return {
    async applySnapshotIfNewer(
      snapshot: WorkspaceDirectorySnapshot,
    ): Promise<void> {
      const stored = await read(snapshot.workspaceId);
      if (
        stored !== null &&
        (stored.lifecycle === "deleting" ||
          stored.sourceVersion >= snapshot.sourceVersion)
      ) {
        return;
      }
      const now = toTimestamp(clock.now());
      const row: SqlRow = {
        workspace_id: snapshot.workspaceId,
        name: snapshot.name,
        slug: snapshot.slug,
        publication: snapshot.publication,
        lifecycle: "active",
        deletion_operation_id: null,
        avatar_url: snapshot.avatarUrl,
        source_version: snapshot.sourceVersion,
        updated_at: now,
      };
      const mutations: RowMutation[] = [];
      if (snapshot.slug !== null) {
        mutations.push(
          releaseSlug(
            snapshot.slug,
            snapshot.workspaceId,
            snapshot.sourceVersion,
          ),
        );
      }
      mutations.push(
        upsert({
          table: TABLE,
          key: snapshot.workspaceId,
          row,
          statement: statement(
            `INSERT INTO ${TABLE}
               (workspace_id, name, slug, publication, lifecycle,
                deletion_operation_id, avatar_url, source_version, updated_at)
             VALUES (?, ?, ?, ?, 'active', NULL, ?, ?, ?)
             ON CONFLICT (workspace_id) DO UPDATE SET
               name = excluded.name,
               slug = excluded.slug,
               publication = excluded.publication,
               avatar_url = excluded.avatar_url,
               source_version = excluded.source_version,
               updated_at = excluded.updated_at
             WHERE ${TABLE}.lifecycle = 'active'
               AND ${TABLE}.source_version < excluded.source_version`,
            snapshot.workspaceId,
            snapshot.name,
            snapshot.slug,
            snapshot.publication,
            snapshot.avatarUrl,
            snapshot.sourceVersion,
            now,
          ),
        }),
      );
      await write(mutations);
    },

    async tombstone(input): Promise<void> {
      const stored = await read(input.workspaceId);
      if (
        stored !== null &&
        stored.deletionOperationId !== null &&
        stored.deletionOperationId !== input.operationId
      ) {
        throw tombstonedByAnother(input.workspaceId);
      }
      const now = toTimestamp(clock.now());
      const publication = stored?.publication ?? "private";
      const sourceVersion = stored?.sourceVersion ?? 0;
      const mutations: RowMutation[] = [
        // The branch above was decided from a `read` issued a round trip
        // earlier, and the upsert's `ON CONFLICT … WHERE` merely leaves
        // the row alone when a foreign tombstone lands in between; the
        // guard turns that silence into the refusal the port promises.
        opaque(
          occGuard(
            statement(
              `SELECT 1 WHERE NOT EXISTS (
                 SELECT 1 FROM ${TABLE}
                  WHERE workspace_id = ?
                    AND deletion_operation_id IS NOT NULL
                    AND deletion_operation_id <> ?
               )`,
              input.workspaceId,
              input.operationId,
            ),
          ),
        ),
        upsert({
          table: TABLE,
          key: input.workspaceId,
          row: {
            workspace_id: input.workspaceId,
            name: REDACTED_NAME,
            slug: null,
            publication,
            lifecycle: "deleting",
            deletion_operation_id: input.operationId,
            avatar_url: null,
            source_version: sourceVersion,
            updated_at: now,
          },
          statement: statement(
            `INSERT INTO ${TABLE}
               (workspace_id, name, slug, publication, lifecycle,
                deletion_operation_id, avatar_url, source_version, updated_at)
             VALUES (?, ?, NULL, ?, 'deleting', ?, NULL, ?, ?)
             ON CONFLICT (workspace_id) DO UPDATE SET
               name = excluded.name,
               slug = NULL,
               lifecycle = 'deleting',
               deletion_operation_id = excluded.deletion_operation_id,
               avatar_url = NULL,
               updated_at = excluded.updated_at
             WHERE ${TABLE}.deletion_operation_id IS NULL
                OR ${TABLE}.deletion_operation_id = excluded.deletion_operation_id`,
            input.workspaceId,
            REDACTED_NAME,
            publication,
            input.operationId,
            sourceVersion,
            now,
          ),
        }),
      ];
      try {
        await session.write(mutations);
      } catch (cause) {
        throw classifySqlError(cause) === "occGuard"
          ? tombstonedByAnother(input.workspaceId)
          : databaseError(CONTEXT, cause);
      }
    },
  };
}
