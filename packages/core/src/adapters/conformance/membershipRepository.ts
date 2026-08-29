import { beforeEach, describe, expect, it } from "vitest";
import { isSystemError } from "../../application/errors";
import { Membership } from "../../domain/workspace/membership";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import {
  makeMembership,
  membershipId,
  userId,
  workspaceId,
  workspaceScopeOf,
} from "./fixtures";

const MINUTE_MS = 60 * 1000;

/** Shared conformance suite for `MembershipRepository` (ADP-workspace-008..015). */
export function describeMembershipRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`MembershipRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(workspaceScopeOf(1));
    });

    const seed = async (
      n: number,
      member: number,
      role: "owner" | "editor" | "viewer",
      joinedAt: Date,
    ): Promise<void> => {
      await scoped.membershipRepository.insert(
        makeMembership(n, workspaceId(1), userId(member), role, joinedAt),
      );
    };

    it("ADP-workspace-008/009: insert then findById round-trips with a version token", async () => {
      const now = backend.clock.now();
      const membership = makeMembership(
        1,
        workspaceId(1),
        userId(1),
        "owner",
        now,
      );
      await scoped.membershipRepository.insert(membership);

      const found = await scoped.membershipRepository.findById(membershipId(1));
      expect(found?.entity).toEqual(membership);
      expect(found?.expectedVersion).toBe(0);
    });

    it("ADP-workspace-008: a second membership for the same (workspace, user) is rejected", async () => {
      const now = backend.clock.now();
      await seed(1, 1, "owner", now);

      await expectConflict(
        scoped.membershipRepository.insert(
          makeMembership(2, workspaceId(1), userId(1), "viewer", now),
        ),
        "MEMBERSHIP_ALREADY_EXISTS",
      );
      // Another user in the same workspace, and the same user elsewhere,
      // are both untouched by the invariant.
      await seed(2, 2, "editor", now);
      const elsewhere = backend.forScope(workspaceScopeOf(2));
      await elsewhere.membershipRepository.insert(
        makeMembership(3, workspaceId(2), userId(1), "viewer", now),
      );
      expect(
        await scoped.membershipRepository.findById(membershipId(2)),
      ).not.toBeNull();
    });

    it("ADP-workspace-010/011: save and delete enforce OCC", async () => {
      const now = backend.clock.now();
      await seed(1, 1, "viewer", now);

      const first = await scoped.membershipRepository.findById(membershipId(1));
      if (first === null) {
        throw new Error("seeded membership missing");
      }
      const promoted = Membership.changeRole(
        first.entity,
        "editor",
        now,
      ).entity;
      await scoped.membershipRepository.save(promoted, first.expectedVersion);

      await expectConflict(
        scoped.membershipRepository.save(promoted, first.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      await expectConflict(
        scoped.membershipRepository.delete(
          membershipId(1),
          first.expectedVersion,
        ),
        "OPTIMISTIC_LOCK_FAILURE",
      );

      const fresh = await scoped.membershipRepository.findById(membershipId(1));
      if (fresh === null) {
        throw new Error("seeded membership missing");
      }
      expect(fresh.entity.role).toBe("editor");
      await scoped.membershipRepository.delete(
        membershipId(1),
        fresh.expectedVersion,
      );
      expect(
        await scoped.membershipRepository.findById(membershipId(1)),
      ).toBeNull();
    });

    it("ADP-workspace-012: findByWorkspaceAndUser answers with an OCC token, or null when the user is not a member", async () => {
      const now = backend.clock.now();
      await seed(1, 1, "owner", now);

      const found = await scoped.membershipRepository.findByWorkspaceAndUser(
        workspaceId(1),
        userId(1),
      );
      expect(found?.entity.id).toBe(membershipId(1));
      expect(found?.expectedVersion).toBe(0);

      expect(
        await scoped.membershipRepository.findByWorkspaceAndUser(
          workspaceId(1),
          userId(2),
        ),
      ).toBeNull();
      // A workspaceId other than the bound one names no scope this
      // repository can reach, so it matches nothing.
      expect(
        await scoped.membershipRepository.findByWorkspaceAndUser(
          workspaceId(2),
          userId(1),
        ),
      ).toBeNull();
    });

    it("ADP-workspace-013: listByWorkspace pages a total joinedAt ASC, id ASC order and counts every member", async () => {
      const now = backend.clock.now();
      // Memberships 2..4 share a joinedAt, so only the id tiebreak orders
      // them; membership 1 joined later, so a pure id order would put it
      // first instead of last.
      await seed(1, 1, "owner", new Date(now.getTime() + MINUTE_MS));
      for (const n of [4, 3, 2]) {
        await seed(n, n, "viewer", now);
      }

      const first = await scoped.membershipRepository.listByWorkspace(
        workspaceId(1),
        { page: 1, limit: 2 },
      );
      expect(first.count).toBe(4);
      expect(first.items.map((row) => row.id)).toEqual([
        membershipId(2),
        membershipId(3),
      ]);

      const second = await scoped.membershipRepository.listByWorkspace(
        workspaceId(1),
        { page: 2, limit: 2 },
      );
      expect(second.count).toBe(4);
      expect(second.items.map((row) => row.id)).toEqual([
        membershipId(4),
        membershipId(1),
      ]);

      const foreign = await scoped.membershipRepository.listByWorkspace(
        workspaceId(2),
        { page: 1, limit: 10 },
      );
      expect(foreign.items).toEqual([]);
      expect(foreign.count).toBe(0);
    });

    it("ADP-workspace-013: listByWorkspace answers from the last committed state, so the deletion sweep's probe never reads its own turn", async () => {
      const now = backend.clock.now();
      await seed(1, 1, "owner", new Date(now.getTime() - MINUTE_MS));
      await seed(2, 2, "editor", now);

      const observed = await backend.scopeUnitOfWork.run(
        workspaceScopeOf(1),
        async (ctx) => {
          await ctx.membershipRepository.insert(
            makeMembership(
              3,
              workspaceId(1),
              userId(3),
              "viewer",
              new Date(now.getTime() + MINUTE_MS),
            ),
          );
          const afterInsert = await ctx.membershipRepository.listByWorkspace(
            workspaceId(1),
            { page: 1, limit: 10 },
          );
          await ctx.membershipRepository.deleteByIds([membershipId(1)]);
          const afterDelete = await ctx.membershipRepository.listByWorkspace(
            workspaceId(1),
            { page: 1, limit: 10 },
          );
          return {
            afterInsert: afterInsert.items.map((row) => row.id),
            afterInsertCount: afterInsert.count,
            afterDelete: afterDelete.items.map((row) => row.id),
            // The last-owner count is the read that does observe the
            // unit, which is what makes the split visible in one turn.
            owners: await ctx.membershipRepository.countByRole(
              workspaceId(1),
              "owner",
            ),
          };
        },
      );

      expect(observed).toEqual({
        afterInsert: [membershipId(1), membershipId(2)],
        afterInsertCount: 2,
        afterDelete: [membershipId(1), membershipId(2)],
        owners: 0,
      });

      const settled = await scoped.membershipRepository.listByWorkspace(
        workspaceId(1),
        { page: 1, limit: 10 },
      );
      expect(settled.items.map((row) => row.id)).toEqual([
        membershipId(2),
        membershipId(3),
      ]);
      expect(settled.count).toBe(2);
    });

    it("ADP-workspace-014: countByRole is the exact number of members holding the role", async () => {
      const now = backend.clock.now();
      await seed(1, 1, "owner", now);
      await seed(2, 2, "editor", now);
      await seed(3, 3, "editor", now);

      expect(
        await scoped.membershipRepository.countByRole(workspaceId(1), "owner"),
      ).toBe(1);
      expect(
        await scoped.membershipRepository.countByRole(workspaceId(1), "editor"),
      ).toBe(2);
      expect(
        await scoped.membershipRepository.countByRole(workspaceId(1), "viewer"),
      ).toBe(0);
      expect(
        await scoped.membershipRepository.countByRole(workspaceId(2), "owner"),
      ).toBe(0);

      const owner = await scoped.membershipRepository.findById(membershipId(1));
      if (owner === null) {
        throw new Error("seeded membership missing");
      }
      await scoped.membershipRepository.save(
        Membership.changeRole(owner.entity, "editor", now).entity,
        owner.expectedVersion,
      );
      expect(
        await scoped.membershipRepository.countByRole(workspaceId(1), "owner"),
      ).toBe(0);
      expect(
        await scoped.membershipRepository.countByRole(workspaceId(1), "editor"),
      ).toBe(3);
    });

    it("ADP-workspace-014: countByRole sees the role change of its own unit of work", async () => {
      const now = backend.clock.now();
      await seed(1, 1, "owner", now);
      await seed(2, 2, "owner", now);

      // The last-owner invariant is decided on this number inside the
      // transaction that demotes an owner. A backend answering it from an
      // aggregate over committed rows would still see two owners and let
      // the second demotion through, leaving the workspace ownerless.
      const counts = await backend.scopeUnitOfWork.run(
        workspaceScopeOf(1),
        async (ctx) => {
          const owner = await ctx.membershipRepository.findById(
            membershipId(1),
          );
          if (owner === null) {
            throw new Error("seeded membership missing");
          }
          await ctx.membershipRepository.save(
            Membership.changeRole(owner.entity, "editor", now).entity,
            owner.expectedVersion,
          );
          const afterDemotion = await ctx.membershipRepository.countByRole(
            workspaceId(1),
            "owner",
          );
          await ctx.membershipRepository.deleteByIds([membershipId(2)]);
          return {
            afterDemotion,
            afterDelete: await ctx.membershipRepository.countByRole(
              workspaceId(1),
              "owner",
            ),
          };
        },
      );

      expect(counts).toEqual({ afterDemotion: 1, afterDelete: 0 });
    });

    it("ADP-workspace-015: deleteByIds is idempotent per page and answers how many rows it removed", async () => {
      const now = backend.clock.now();
      await seed(1, 1, "owner", now);
      await seed(2, 2, "editor", now);

      const removed = await scoped.membershipRepository.deleteByIds([
        membershipId(1),
        membershipId(2),
        // Never existed, and one that belongs to another scope: both are
        // skipped rather than raising, so a replayed page still succeeds.
        membershipId(9),
      ]);
      expect(removed).toBe(2);
      expect(
        await scoped.membershipRepository.deleteByIds([
          membershipId(1),
          membershipId(2),
        ]),
      ).toBe(0);
      expect(
        await scoped.membershipRepository.findById(membershipId(1)),
      ).toBeNull();
    });

    it("ADP-workspace-015: deleteByIds accepts exactly 100 ids and rejects 101", async () => {
      const now = backend.clock.now();
      await seed(1, 1, "owner", now);

      const atLimit = await scoped.membershipRepository.deleteByIds(
        Array.from({ length: 100 }, (_, i) => membershipId(i + 1)),
      );
      expect(atLimit).toBe(1);

      await expect(
        scoped.membershipRepository.deleteByIds(
          Array.from({ length: 101 }, (_, i) => membershipId(i + 1)),
        ),
      ).rejects.toSatisfy(isSystemError);
    });
  });
}
