import { ConflictError } from "../../../application/errors";
import { Version } from "../../../domain/common/version";
import type { UserId } from "../../../domain/identity/valueObject";
import type {
  WorkspaceMaintenanceKind,
  WorkspaceOperationLockStore,
} from "../../../domain/workspace/ports/workspaceOperationLockStore";
import type {
  MemoryBackend,
  ScopeStore,
  WorkspaceDeletionManifestHeaderRow,
} from "../store";

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

export function createMemoryWorkspaceOperationLockStore(
  backend: MemoryBackend,
  scope: ScopeStore,
): WorkspaceOperationLockStore {
  // One workspace per scope, so the scope's single header — whatever its
  // state — is the deletion's whole memory once the Workspace row is gone.
  const header = (): WorkspaceDeletionManifestHeaderRow | undefined =>
    scope.deletionManifestHeaders.values()[0];

  const deletingOperationId = (): string | null => {
    const workspace = scope.workspaces.values()[0];
    return workspace !== undefined && workspace.lifecycle.state === "deleting"
      ? workspace.lifecycle.operationId
      : null;
  };

  return {
    async hasActiveMove(): Promise<boolean> {
      return scope.moveAuthorizationLocks.size > 0;
    },

    async hasMoveConflict(userId: UserId): Promise<boolean> {
      return scope.moveAuthorizationLocks
        .values()
        .some((row) => row.actorUserId === userId);
    },

    async stageMove(input): Promise<void> {
      const existing = scope.moveAuthorizationLocks.get(input.migrationId);
      if (existing !== undefined) {
        if (existing.actorUserId !== input.actorUserId) {
          throw moveLockConflict(
            `Move ${input.migrationId} already locks the membership of ${existing.actorUserId}`,
          );
        }
        return;
      }
      scope.moveAuthorizationLocks.set(input.migrationId, {
        migrationId: input.migrationId,
        actorUserId: input.actorUserId,
      });
    },

    async releaseMove(migrationId: string): Promise<void> {
      scope.moveAuthorizationLocks.delete(migrationId);
    },

    async beginDeletion(input): Promise<void> {
      const existing = header();
      if (existing !== undefined) {
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
      const workspace = scope.workspaces.get(input.workspaceId);
      if (workspace === undefined) {
        throw admissionConflict(
          `Workspace ${input.workspaceId} does not exist`,
        );
      }
      if (workspace.lifecycle.state === "deleting") {
        throw deleting(
          `Workspace ${input.workspaceId} is being deleted by another operation`,
        );
      }
      if ((workspace.version as number) !== input.expectedWorkspaceVersion) {
        throw new ConflictError(
          "OPTIMISTIC_LOCK_FAILURE",
          `Workspace ${input.workspaceId} is not at version ${input.expectedWorkspaceVersion}`,
        );
      }
      scope.workspaces.set(input.workspaceId, {
        ...workspace,
        lifecycle: { state: "deleting", operationId: input.operationId },
        version: Version.next(workspace.version),
        updatedAt: backend.clock.now(),
      });
      scope.deletionManifestHeaders.set(input.operationId, {
        operationId: input.operationId,
        workspaceId: input.workspaceId,
        state: "building",
        membershipCursor: null,
        invitationCursor: null,
      });
    },

    async assertWritable(): Promise<void> {
      const surviving = header();
      if (surviving !== undefined) {
        throw deleting(
          `Workspace scope is closed by deletion ${surviving.operationId}`,
        );
      }
      const owner = deletingOperationId();
      if (owner !== null) {
        throw deleting(`Workspace scope is closed by deletion ${owner}`);
      }
    },

    async assertDeletionOwner(operationId: string): Promise<void> {
      const surviving = header();
      if (surviving !== undefined) {
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
      if (deletingOperationId() !== operationId) {
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
