import { beforeEach, describe, expect, it } from "vitest";
import { expectValidation } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { userId, workspaceId } from "./fixtures";

const MINUTE_MS = 60 * 1000;

/** Shared conformance suite for `UserWorkspaceDirectory` (ADP-workspace-005). */
export function describeUserWorkspaceDirectoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`UserWorkspaceDirectory conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    /**
     * Edges 2 and 3 share a `createdAt`, so only the WorkspaceId tiebreak
     * orders them; edge 1 is newer, so a WorkspaceId-only order would put
     * it last instead of first.
     */
    const seedEdges = async (): Promise<void> => {
      const now = backend.clock.now();
      const tied = new Date(now.getTime() - MINUTE_MS);
      await backend.seedMembershipEdges(userId(1), [
        {
          edgeKey: "edge-1",
          workspaceId: workspaceId(1),
          edgeState: "active",
          membershipId: "membership-1",
          role: "owner",
          createdAt: now,
        },
        {
          edgeKey: "edge-2",
          workspaceId: workspaceId(2),
          edgeState: "active",
          membershipId: "membership-2",
          role: "editor",
          createdAt: tied,
        },
        {
          edgeKey: "edge-3",
          workspaceId: workspaceId(3),
          edgeState: "active",
          membershipId: "membership-3",
          role: "viewer",
          createdAt: tied,
        },
        {
          edgeKey: "edge-4",
          workspaceId: workspaceId(4),
          edgeState: "pending",
          membershipId: null,
          role: "viewer",
          createdAt: now,
        },
        {
          edgeKey: "edge-5",
          workspaceId: workspaceId(5),
          edgeState: "removing",
          membershipId: "membership-5",
          role: "editor",
          createdAt: now,
        },
      ]);
      await backend.seedMembershipEdges(userId(2), [
        {
          edgeKey: "edge-6",
          workspaceId: workspaceId(6),
          edgeState: "active",
          membershipId: "membership-6",
          role: "owner",
          createdAt: now,
        },
      ]);
    };

    /**
     * `seedEdges` plus the states the ownership count has to tell apart:
     * user 1 ends up with one active, one pending and one activating
     * owner edge, one `removing` owner edge that the count concedes, and
     * two active edges in other roles.
     */
    const seedOwnerEdges = async (): Promise<void> => {
      await seedEdges();
      await backend.seedMembershipEdges(userId(1), [
        {
          edgeKey: "edge-7",
          workspaceId: workspaceId(7),
          edgeState: "pending",
          membershipId: null,
          role: "owner",
        },
        {
          edgeKey: "edge-8",
          workspaceId: workspaceId(8),
          edgeState: "activating",
          membershipId: null,
          role: "owner",
        },
        {
          edgeKey: "edge-9",
          workspaceId: workspaceId(9),
          edgeState: "removing",
          membershipId: "membership-9",
          role: "owner",
        },
      ]);
    };

    it("ADP-workspace-005: returns only the user's active edges with their projected roles", async () => {
      await seedEdges();

      const page = await backend.userWorkspaceDirectory.listActiveByUser(
        userId(1),
        null,
        20,
      );
      expect(page.items).toEqual([
        { workspaceId: workspaceId(1), role: "owner" },
        { workspaceId: workspaceId(2), role: "editor" },
        { workspaceId: workspaceId(3), role: "viewer" },
      ]);
      expect(page.nextCursor).toBeNull();

      const other = await backend.userWorkspaceDirectory.listActiveByUser(
        userId(2),
        null,
        20,
      );
      expect(other.items.map((edge) => edge.workspaceId)).toEqual([
        workspaceId(6),
      ]);
      expect(
        (
          await backend.userWorkspaceDirectory.listActiveByUser(
            userId(3),
            null,
            20,
          )
        ).items,
      ).toEqual([]);
    });

    it("ADP-workspace-005: pages a total createdAt DESC, workspaceId order and resumes from the cursor", async () => {
      await seedEdges();

      const first = await backend.userWorkspaceDirectory.listActiveByUser(
        userId(1),
        null,
        2,
      );
      expect(first.items.map((edge) => edge.workspaceId)).toEqual([
        workspaceId(1),
        workspaceId(2),
      ]);
      expect(first.nextCursor).not.toBeNull();

      const second = await backend.userWorkspaceDirectory.listActiveByUser(
        userId(1),
        first.nextCursor,
        2,
      );
      expect(second.items.map((edge) => edge.workspaceId)).toEqual([
        workspaceId(3),
      ]);
      // `nextCursor === null` is the only exhaustion signal a caller has.
      expect(second.nextCursor).toBeNull();
    });

    it("ADP-workspace-005: a limit outside 1..20 raises INVALID_PAGINATION", async () => {
      await expectValidation(
        backend.userWorkspaceDirectory.listActiveByUser(userId(1), null, 0),
        "INVALID_PAGINATION",
      );
      await expectValidation(
        backend.userWorkspaceDirectory.listActiveByUser(userId(1), null, 21),
        "INVALID_PAGINATION",
      );
      expect(
        (
          await backend.userWorkspaceDirectory.listActiveByUser(
            userId(1),
            null,
            20,
          )
        ).items,
      ).toEqual([]);
    });

    it("ADP-workspace-005: an unreadable cursor is rejected, and one minted for another user is never honoured", async () => {
      await seedEdges();
      await expectValidation(
        backend.userWorkspaceDirectory.listActiveByUser(
          userId(1),
          "tampered-cursor",
          2,
        ),
        "INVALID_PAGINATION",
      );

      const first = await backend.userWorkspaceDirectory.listActiveByUser(
        userId(1),
        null,
        2,
      );
      // A cursor decides where a page starts, never what it may contain:
      // replaying user 1's cursor must not open user 2's edges.
      const replayed = await backend.userWorkspaceDirectory
        .listActiveByUser(userId(2), first.nextCursor, 2)
        .then(
          (page) => page.items.map((edge) => edge.workspaceId),
          () => [],
        );
      expect(replayed).not.toContain(workspaceId(1));
      expect(replayed).not.toContain(workspaceId(2));
      expect(replayed).not.toContain(workspaceId(3));
    });

    it("ADP-workspace-068: counts owner edges that are active or still reserved, per user", async () => {
      await seedOwnerEdges();
      // A quota that ignored the unsettled joins would read 1 here, and a
      // seat the removal already conceded would push it to 4.
      expect(
        await backend.userWorkspaceDirectory.countOwnedByUser(userId(1), 100),
      ).toBe(3);
      expect(
        await backend.userWorkspaceDirectory.countOwnedByUser(userId(2), 100),
      ).toBe(1);
      expect(
        await backend.userWorkspaceDirectory.countOwnedByUser(userId(3), 100),
      ).toBe(0);
    });

    it("ADP-workspace-068: the count stops at the limit and rejects one outside 1..100", async () => {
      await seedOwnerEdges();
      expect(
        await backend.userWorkspaceDirectory.countOwnedByUser(userId(1), 2),
      ).toBe(2);

      await expectValidation(
        backend.userWorkspaceDirectory.countOwnedByUser(userId(1), 0),
        "INVALID_PAGINATION",
      );
      await expectValidation(
        backend.userWorkspaceDirectory.countOwnedByUser(userId(1), 101),
        "INVALID_PAGINATION",
      );
    });

    it("ADP-workspace-076: counts every settled edge in any role and leaves out the one a join still holds", async () => {
      await seedOwnerEdges();
      // User 1 holds three active, two pending and two removing edges,
      // plus the `activating` one. A count that reused the active-only
      // enumeration would read 3, and one that copied the ownership
      // predicate would count the `activating` edge and drop the
      // `removing` ones.
      expect(
        await backend.userWorkspaceDirectory.countSettledByUser(userId(1), 100),
      ).toBe(7);
      expect(
        await backend.userWorkspaceDirectory.countSettledByUser(userId(2), 100),
      ).toBe(1);
      expect(
        await backend.userWorkspaceDirectory.countSettledByUser(userId(3), 100),
      ).toBe(0);
    });

    it("ADP-workspace-076: the settled count stops at the limit and rejects one outside 1..100", async () => {
      await seedOwnerEdges();
      expect(
        await backend.userWorkspaceDirectory.countSettledByUser(userId(1), 1),
      ).toBe(1);
      expect(
        await backend.userWorkspaceDirectory.countSettledByUser(userId(1), 3),
      ).toBe(3);

      await expectValidation(
        backend.userWorkspaceDirectory.countSettledByUser(userId(1), 0),
        "INVALID_PAGINATION",
      );
      await expectValidation(
        backend.userWorkspaceDirectory.countSettledByUser(userId(1), 101),
        "INVALID_PAGINATION",
      );
    });
  });
}
