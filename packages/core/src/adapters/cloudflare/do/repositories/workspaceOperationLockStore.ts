import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type { UserId } from "../../../../domain/identity/valueObject";
import type {
  WorkspaceMaintenanceKind,
  WorkspaceOperationLockStore,
} from "../../../../domain/workspace/ports/workspaceOperationLockStore";
import type { WorkspaceId } from "../../../../domain/workspace/valueObject";
import { opaque, remove, upsert } from "../../execution/writeSet";
import { classifySqlError, databaseError } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import { int, text, toTimestamp } from "../../sql/row";
import { ALL_ROWS, type SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";
import { readManifestHeader } from "./workspaceDeletionManifestStore";

const WORKSPACES = SCOPE_TABLES.workspaces;
const MOVE_LOCKS = SCOPE_TABLES.moveAuthorizationLocks;
const CONTEXT = "the workspace operation lock store";

const MAINTENANCE_KINDS: ReadonlySet<string> =
  new Set<WorkspaceMaintenanceKind>([
    "jobRetention",
    "outboxRelay",
    "tombstonePrune",
  ]);

const deleting = (detail: string): ConflictError =>
  new ConflictError("WORKSPACE_DELETING", detail);

const admissionConflict = (detail: string): ConflictError =>
  new ConflictError("WORKSPACE_DELETION_ADMISSION_CONFLICT", detail);

const moveLockConflict = (detail: string): ConflictError =>
  new ConflictError("MOVE_AUTHORIZATION_LOCK_CONFLICT", detail);

export type CloudflareWorkspaceOperationLockDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
}>;

/**
 * Write admission of one workspace scope object: `move_authorization_locks`
 * and the deletion switch that `workspaces` and
 * `workspace_deletion_manifests` carry between them.
 *
 * The two tables are read from the same session, which is what lets one
 * local transaction decide both halves of `beginDeletion` — the Workspace
 * compare-and-set and the manifest header — and what keeps admission
 * answerable after the Workspace row is deleted: from then on the header,
 * and finally its completed tombstone, is the scope's whole memory.
 */
export function createCloudflareWorkspaceOperationLockStore(
  deps: CloudflareWorkspaceOperationLockDeps,
): WorkspaceOperationLockStore {
  const { session, clock } = deps;

  const stagedMoves = () =>
    session.readRows({
      table: MOVE_LOCKS,
      statement: statement(
        `SELECT migration_id, actor_user_id FROM ${MOVE_LOCKS}`,
      ),
      keyOf: (row) => text(row, "migration_id"),
      matches: ALL_ROWS,
    });

  const stagedMovesBy = (actorUserId: UserId) =>
    session.readRows({
      table: MOVE_LOCKS,
      statement: statement(
        `SELECT migration_id, actor_user_id FROM ${MOVE_LOCKS} WHERE actor_user_id = ?`,
        actorUserId,
      ),
      keyOf: (row) => text(row, "migration_id"),
      matches: (row) => row.actor_user_id === actorUserId,
    });

  const readMoveLock = (migrationId: string): Promise<SqlRow | null> =>
    session.readRow({
      table: MOVE_LOCKS,
      key: migrationId,
      statement: statement(
        `SELECT migration_id, actor_user_id FROM ${MOVE_LOCKS} WHERE migration_id = ?`,
        migrationId,
      ),
    });

  const readWorkspace = async (
    workspaceId: WorkspaceId,
  ): Promise<SqlRow | null> =>
    session.readRow({
      table: WORKSPACES,
      key: workspaceId,
      statement: statement(
        `SELECT * FROM ${WORKSPACES} WHERE id = ?`,
        workspaceId,
      ),
    });

  /**
   * The operation that closed this scope, read from the Workspace row.
   * `null` once the row is gone — the manifest header answers from there.
   */
  const deletingOperationId = async (): Promise<string | null> => {
    const rows = await session.readRows({
      table: WORKSPACES,
      statement: statement(
        `SELECT * FROM ${WORKSPACES} WHERE lifecycle = 'deleting'`,
      ),
      keyOf: (row) => text(row, "id"),
      matches: (row) => row.lifecycle === "deleting",
    });
    const row = rows[0];
    return row === undefined ? null : text(row, "deletion_operation_id");
  };

  return {
    async hasActiveMove(): Promise<boolean> {
      return (await stagedMoves()).length > 0;
    },

    async hasMoveConflict(userId: UserId): Promise<boolean> {
      return (await stagedMovesBy(userId)).length > 0;
    },

    async stageMove(input): Promise<void> {
      const existing = await readMoveLock(input.migrationId);
      if (existing !== null) {
        const owner = text(existing, "actor_user_id");
        if (owner !== input.actorUserId) {
          throw moveLockConflict(
            `Move ${input.migrationId} already locks the membership of ${owner}`,
          );
        }
        return;
      }
      try {
        await session.write([
          // `DO NOTHING` would leave a rival actor's row standing while
          // the staged row image tells this unit of work — and every read
          // it makes afterwards — that its own actor is pinned.
          opaque(
            occGuard(
              statement(
                `SELECT 1 WHERE NOT EXISTS (
                   SELECT 1 FROM ${MOVE_LOCKS}
                    WHERE migration_id = ? AND actor_user_id <> ?
                 )`,
                input.migrationId,
                input.actorUserId,
              ),
            ),
          ),
          upsert({
            table: MOVE_LOCKS,
            key: input.migrationId,
            row: {
              migration_id: input.migrationId,
              actor_user_id: input.actorUserId,
            },
            statement: statement(
              `INSERT INTO ${MOVE_LOCKS} (migration_id, actor_user_id)
               VALUES (?, ?)
               ON CONFLICT (migration_id) DO NOTHING`,
              input.migrationId,
              input.actorUserId,
            ),
          }),
        ]);
      } catch (cause) {
        throw classifySqlError(cause) === "occGuard"
          ? moveLockConflict(
              `Move ${input.migrationId} already locks the membership of another member`,
            )
          : databaseError(CONTEXT, cause);
      }
    },

    async releaseMove(migrationId: string): Promise<void> {
      try {
        await session.write([
          remove({
            table: MOVE_LOCKS,
            key: migrationId,
            statement: statement(
              `DELETE FROM ${MOVE_LOCKS} WHERE migration_id = ?`,
              migrationId,
            ),
          }),
        ]);
      } catch (cause) {
        throw databaseError(CONTEXT, cause);
      }
    },

    async beginDeletion(input): Promise<void> {
      const existing = await readManifestHeader(session);
      if (existing !== null) {
        if (existing.state === "completed") {
          throw admissionConflict(
            `Workspace ${input.workspaceId} deletion ${existing.operationId} is terminal`,
          );
        }
        if (existing.operationId !== input.operationId) {
          throw deleting(
            `Workspace ${input.workspaceId} is being deleted by another operation`,
          );
        }
        return;
      }
      const workspace = await readWorkspace(input.workspaceId);
      if (workspace === null) {
        throw admissionConflict(
          `Workspace ${input.workspaceId} does not exist`,
        );
      }
      if (workspace.lifecycle === "deleting") {
        throw deleting(
          `Workspace ${input.workspaceId} is being deleted by another operation`,
        );
      }
      const version = int(workspace, "version");
      if (version !== input.expectedWorkspaceVersion) {
        throw new ConflictError(
          "OPTIMISTIC_LOCK_FAILURE",
          `Workspace ${input.workspaceId} is not at version ${input.expectedWorkspaceVersion}`,
        );
      }
      const now = toTimestamp(clock.now());
      try {
        // One write-set: a scope can never be closed without a manifest to
        // drive it, nor gain a manifest it is not closed for.
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${WORKSPACES}
                  WHERE id = ? AND version = ? AND lifecycle = 'active'`,
                input.workspaceId,
                version,
              ),
            ),
          ),
          upsert({
            table: WORKSPACES,
            key: input.workspaceId,
            row: {
              ...workspace,
              lifecycle: "deleting",
              deletion_operation_id: input.operationId,
              version: version + 1,
              updated_at: now,
            },
            statement: statement(
              `UPDATE ${WORKSPACES}
                  SET lifecycle = 'deleting', deletion_operation_id = ?, version = ?, updated_at = ?
                WHERE id = ? AND version = ?`,
              input.operationId,
              version + 1,
              now,
              input.workspaceId,
              version,
            ),
          }),
          upsert({
            table: SCOPE_TABLES.workspaceDeletionManifests,
            key: input.operationId,
            row: {
              operation_id: input.operationId,
              workspace_id: input.workspaceId,
              state: "building",
              membership_cursor: null,
              invitation_cursor: null,
              created_at: now,
              updated_at: now,
            },
            statement: statement(
              `INSERT INTO ${SCOPE_TABLES.workspaceDeletionManifests}
                 (operation_id, workspace_id, state, membership_cursor, invitation_cursor, created_at, updated_at)
               VALUES (?, ?, 'building', NULL, NULL, ?, ?)`,
              input.operationId,
              input.workspaceId,
              now,
              now,
            ),
          }),
        ]);
      } catch (cause) {
        throw databaseError(CONTEXT, cause);
      }
    },

    async assertWritable(): Promise<void> {
      const surviving = await readManifestHeader(session);
      if (surviving !== null) {
        throw deleting(
          `Workspace scope is closed by deletion ${surviving.operationId}`,
        );
      }
      const owner = await deletingOperationId();
      if (owner !== null) {
        throw deleting(`Workspace scope is closed by deletion ${owner}`);
      }
    },

    async assertDeletionOwner(operationId: string): Promise<void> {
      const surviving = await readManifestHeader(session);
      if (surviving !== null) {
        // The completed tombstone is what stops a redelivered
        // continuation from restarting cleanup that already finished.
        if (surviving.state === "completed") {
          throw admissionConflict(
            `Deletion ${surviving.operationId} is already complete`,
          );
        }
        if (surviving.operationId !== operationId) {
          throw deleting(
            `Workspace scope is closed by deletion ${surviving.operationId}`,
          );
        }
        return;
      }
      if ((await deletingOperationId()) !== operationId) {
        throw admissionConflict(
          `Operation ${operationId} does not own a deletion of this scope`,
        );
      }
    },

    async assertMaintenanceAllowed(
      kind: WorkspaceMaintenanceKind,
    ): Promise<void> {
      if (!MAINTENANCE_KINDS.has(kind)) {
        throw admissionConflict(`Maintenance kind ${kind} is not admitted`);
      }
    },
  };
}
