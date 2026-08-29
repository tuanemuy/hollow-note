import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceMaintenanceKind } from "../../domain/workspace/ports/workspaceOperationLockStore";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import {
  makeWorkspace,
  userId,
  workspaceId,
  workspaceScopeOf,
} from "./fixtures";

const MAINTENANCE_KINDS: readonly WorkspaceMaintenanceKind[] = [
  "jobRetention",
  "outboxRelay",
  "tombstonePrune",
];

/**
 * Shared conformance suite for `WorkspaceOperationLockStore`
 * (ADP-workspace-046..051 / 071..072): the move locks a deletion must not
 * race, the one-way admission switch, and the three assertions that
 * divide who may still write.
 */
export function describeWorkspaceOperationLockStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`WorkspaceOperationLockStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;
    const store = (): ScopedConformancePorts["workspaceOperationLockStore"] =>
      scoped.workspaceOperationLockStore;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(workspaceScopeOf(1));
      await scoped.workspaceRepository.insert(
        makeWorkspace(1, userId(1), backend.clock.now()),
      );
    });

    const beginDeletion = (
      operationId: string,
      expectedWorkspaceVersion = 0,
    ): Promise<void> =>
      store().beginDeletion({
        workspaceId: workspaceId(1),
        operationId,
        expectedWorkspaceVersion,
      });

    it("ADP-workspace-046/047/071: a staged move locks the scope and its own actor only", async () => {
      expect(await store().hasActiveMove()).toBe(false);
      expect(await store().hasMoveConflict(userId(1))).toBe(false);

      await store().stageMove({
        migrationId: "migration-1",
        actorUserId: userId(1),
      });

      expect(await store().hasActiveMove()).toBe(true);
      expect(await store().hasMoveConflict(userId(1))).toBe(true);
      // Moves staged by other members do not constrain this membership.
      expect(await store().hasMoveConflict(userId(2))).toBe(false);
    });

    it("ADP-workspace-046/071: move locks are read from the scope that holds them", async () => {
      await backend
        .forScope(workspaceScopeOf(2))
        .workspaceOperationLockStore.stageMove({
          migrationId: "migration-1",
          actorUserId: userId(1),
        });

      expect(await store().hasActiveMove()).toBe(false);
      expect(
        await backend
          .forScope(workspaceScopeOf(2))
          .workspaceOperationLockStore.hasActiveMove(),
      ).toBe(true);
    });

    it("ADP-workspace-071: staging is idempotent for its migration, and never re-points a live lock", async () => {
      await store().stageMove({
        migrationId: "migration-1",
        actorUserId: userId(1),
      });
      // A phase whose response was lost replays under the same id.
      await store().stageMove({
        migrationId: "migration-1",
        actorUserId: userId(1),
      });
      expect(await store().hasMoveConflict(userId(1))).toBe(true);

      await expectConflict(
        store().stageMove({
          migrationId: "migration-1",
          actorUserId: userId(2),
        }),
        "MOVE_AUTHORIZATION_LOCK_CONFLICT",
      );
      expect(await store().hasMoveConflict(userId(2))).toBe(false);
    });

    it("ADP-workspace-071/072: locks of different migrations stand independently", async () => {
      await store().stageMove({
        migrationId: "migration-1",
        actorUserId: userId(1),
      });
      await store().stageMove({
        migrationId: "migration-2",
        actorUserId: userId(2),
      });

      await store().releaseMove("migration-1");

      expect(await store().hasActiveMove()).toBe(true);
      expect(await store().hasMoveConflict(userId(1))).toBe(false);
      expect(await store().hasMoveConflict(userId(2))).toBe(true);
    });

    it("ADP-workspace-072: releasing is idempotent and reaches only its own scope", async () => {
      // Activation and abort are each replayed under the same migration
      // id, so a release that finds no lock must not fail.
      await store().releaseMove("migration-1");

      await store().stageMove({
        migrationId: "migration-1",
        actorUserId: userId(1),
      });
      const other = backend.forScope(workspaceScopeOf(2));
      await other.workspaceOperationLockStore.stageMove({
        migrationId: "migration-1",
        actorUserId: userId(1),
      });

      await store().releaseMove("migration-1");
      await store().releaseMove("migration-1");

      expect(await store().hasActiveMove()).toBe(false);
      expect(await other.workspaceOperationLockStore.hasActiveMove()).toBe(
        true,
      );
    });

    it("ADP-workspace-048/049/050: beginDeletion closes the scope to everything but its own continuation", async () => {
      await store().assertWritable();
      await expectConflict(store().assertDeletionOwner("op-1"));

      await beginDeletion("op-1");

      await expectConflict(store().assertWritable(), "WORKSPACE_DELETING");
      await store().assertDeletionOwner("op-1");
      // Asking twice in one turn changes nothing.
      await store().assertDeletionOwner("op-1");
      await expectConflict(store().assertDeletionOwner("op-2"));
    });

    it("ADP-workspace-048: beginDeletion is idempotent for its operation, stale version included", async () => {
      await beginDeletion("op-1");
      // The version has already moved, so re-checking it would make the
      // lost-response retry impossible.
      await beginDeletion("op-1");
      await store().assertDeletionOwner("op-1");
    });

    it("ADP-workspace-048: a second operation loses with WORKSPACE_DELETING", async () => {
      await beginDeletion("op-1");

      await expectConflict(beginDeletion("op-2"), "WORKSPACE_DELETING");
      await store().assertDeletionOwner("op-1");
      await expectConflict(store().assertDeletionOwner("op-2"));
    });

    it("ADP-workspace-048: a version mismatch on a still-active scope is an OCC failure", async () => {
      await expectConflict(beginDeletion("op-1", 1), "OPTIMISTIC_LOCK_FAILURE");

      // The scope stayed open, so no manifest was created either.
      await store().assertWritable();
      await expectConflict(store().assertDeletionOwner("op-1"));
      await beginDeletion("op-1", 0);
      await expectConflict(store().assertWritable(), "WORKSPACE_DELETING");
    });

    it("ADP-workspace-049/050: the completed tombstone keeps rejecting writes and stops the continuation", async () => {
      await beginDeletion("op-1");
      const found = await scoped.workspaceRepository.findById(workspaceId(1));
      if (found === null) {
        throw new Error("workspace missing");
      }
      await scoped.workspaceRepository.delete(
        workspaceId(1),
        found.expectedVersion,
      );

      // The Workspace row is gone; the manifest header is what answers.
      await expectConflict(store().assertWritable(), "WORKSPACE_DELETING");
      await store().assertDeletionOwner("op-1");

      await scoped.workspaceDeletionManifestStore.markCompleted("op-1");

      await expectConflict(store().assertWritable(), "WORKSPACE_DELETING");
      // A redelivered continuation must not restart a finished cleanup.
      await expectConflict(store().assertDeletionOwner("op-1"));
      await expectConflict(beginDeletion("op-1"));
    });

    it("ADP-workspace-051: the three maintenance lanes stay open whatever the deletion state", async () => {
      for (const kind of MAINTENANCE_KINDS) {
        await store().assertMaintenanceAllowed(kind);
      }

      await beginDeletion("op-1");
      await scoped.workspaceDeletionManifestStore.markCompleted("op-1");
      for (const kind of MAINTENANCE_KINDS) {
        await store().assertMaintenanceAllowed(kind);
      }
    });

    it("ADP-workspace-051: a kind outside the allow-list is rejected rather than admitted", async () => {
      await expectConflict(
        store().assertMaintenanceAllowed(
          // The union is the enforcement; this stands in for a caller
          // that bypassed the type.
          "create" as WorkspaceMaintenanceKind,
        ),
      );
    });

    it("ADP-workspace-049: admission is bound to its own scope", async () => {
      await beginDeletion("op-1");

      const other = backend.forScope(workspaceScopeOf(2));
      await other.workspaceOperationLockStore.assertWritable();
    });
  });
}
