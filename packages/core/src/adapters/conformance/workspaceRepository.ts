import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../domain/workspace/workspace";
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

/** Shared conformance suite for `WorkspaceRepository` (ADP-workspace-001..004). */
export function describeWorkspaceRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`WorkspaceRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(workspaceScopeOf(1));
    });

    it("ADP-workspace-001/002: insert then findById round-trips with a version token", async () => {
      const now = backend.clock.now();
      const workspace = makeWorkspace(1, userId(1), now);
      await scoped.workspaceRepository.insert(workspace);

      const found = await scoped.workspaceRepository.findById(workspaceId(1));
      expect(found?.entity).toEqual(workspace);
      expect(found?.expectedVersion).toBe(0);
    });

    it("ADP-workspace-002: an id the scope does not hold resolves to null", async () => {
      expect(
        await scoped.workspaceRepository.findById(workspaceId(1)),
      ).toBeNull();

      const now = backend.clock.now();
      await scoped.workspaceRepository.insert(makeWorkspace(1, userId(1), now));
      const other = backend.forScope(workspaceScopeOf(2));
      expect(
        await other.workspaceRepository.findById(workspaceId(1)),
      ).toBeNull();
    });

    it("ADP-workspace-003/004: save and delete enforce OCC", async () => {
      const now = backend.clock.now();
      await scoped.workspaceRepository.insert(makeWorkspace(1, userId(1), now));

      const first = await scoped.workspaceRepository.findById(workspaceId(1));
      if (first === null) {
        throw new Error("seeded workspace missing");
      }
      const renamed = Workspace.updateProfile(
        first.entity,
        { name: "Renamed" },
        now,
      ).entity;
      await scoped.workspaceRepository.save(renamed, first.expectedVersion);

      await expectConflict(
        scoped.workspaceRepository.save(renamed, first.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      await expectConflict(
        scoped.workspaceRepository.delete(
          workspaceId(1),
          first.expectedVersion,
        ),
        "OPTIMISTIC_LOCK_FAILURE",
      );

      const fresh = await scoped.workspaceRepository.findById(workspaceId(1));
      expect(fresh?.entity.name).toBe("Renamed");
      expect(fresh?.expectedVersion).toBe(1);
    });

    it("ADP-workspace-003: a published workspace round-trips through save", async () => {
      const now = backend.clock.now();
      await scoped.workspaceRepository.insert(makeWorkspace(1, userId(1), now));

      const read = await scoped.workspaceRepository.findById(workspaceId(1));
      if (read === null || read.entity.publication !== "private") {
        throw new Error("seeded workspace missing");
      }
      const published = Workspace.publish(read.entity, now).entity;
      await scoped.workspaceRepository.save(published, read.expectedVersion);

      const stored = await scoped.workspaceRepository.findById(workspaceId(1));
      expect(stored?.entity).toEqual(published);
    });

    it("ADP-workspace-004: delete leaves findById null, which is what makes the deletion saga re-entrant", async () => {
      const now = backend.clock.now();
      await scoped.workspaceRepository.insert(makeWorkspace(1, userId(1), now));
      const found = await scoped.workspaceRepository.findById(workspaceId(1));
      if (found === null) {
        throw new Error("seeded workspace missing");
      }

      await scoped.workspaceRepository.delete(
        workspaceId(1),
        found.expectedVersion,
      );
      expect(
        await scoped.workspaceRepository.findById(workspaceId(1)),
      ).toBeNull();
      await expectConflict(
        scoped.workspaceRepository.delete(
          workspaceId(1),
          found.expectedVersion,
        ),
        "OPTIMISTIC_LOCK_FAILURE",
      );
    });
  });
}
