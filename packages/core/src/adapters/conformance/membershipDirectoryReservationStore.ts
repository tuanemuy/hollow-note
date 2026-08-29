import { beforeEach, describe, expect, it } from "vitest";
import { User } from "../../domain/identity/user";
import type { UserId } from "../../domain/identity/valueObject";
import type {
  WorkspaceId,
  WorkspaceRole,
} from "../../domain/workspace/valueObject";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { makeActiveUser, membershipId, userId, workspaceId } from "./fixtures";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Shared conformance suite for `MembershipDirectoryReservationStore`
 * (ADP-workspace-033..040 / 069 / 070 / 073): the join saga's claim, the
 * account-deletion prepare lock that serializes against it, the two-phase
 * removal, and the role projection ordered by Membership version.
 *
 * A `pending` edge is the deletion half's only subject, and no method of
 * this port leaves one behind (`reserveAndClaimActivation` inserts and
 * claims in one transaction), so those cases seed the edge through
 * `seedMembershipEdges` and skip themselves on a backend that cannot.
 */
export function describeMembershipDirectoryReservationStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`MembershipDirectoryReservationStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    const store = () => backend.membershipDirectoryReservationStore;

    beforeEach(async () => {
      backend = await makeBackend();
      await backend.userRepository.insert(
        makeActiveUser(1, backend.clock.now()),
      );
      await backend.userRepository.insert(
        makeActiveUser(2, backend.clock.now()),
      );
    });

    const claim = (
      operationId: string,
      owner: UserId = userId(1),
      workspace: WorkspaceId = workspaceId(1),
      membership = 1,
    ): Promise<void> =>
      store().reserveAndClaimActivation({
        operationId,
        userId: owner,
        workspaceId: workspace,
        membershipId: membershipId(membership),
        role: "editor",
        expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
      });

    /** Answers `false` when the backend cannot seed a `pending` edge. */
    const seedPendingEdge = async (
      edgeKey: string,
      owner: UserId = userId(2),
      workspace: WorkspaceId = workspaceId(3),
    ): Promise<boolean> => {
      const seed = backend.seedMembershipEdges;
      if (seed === undefined) {
        return false;
      }
      await seed(owner, [
        {
          edgeKey,
          workspaceId: workspace,
          edgeState: "pending",
          membershipId: null,
        },
      ]);
      return true;
    };

    const activeWorkspaces = async (
      owner: UserId = userId(1),
    ): Promise<readonly WorkspaceId[]> => {
      const page = await backend.userWorkspaceDirectory.listActiveByUser(
        owner,
        null,
        20,
      );
      return page.items.map((item) => item.workspaceId);
    };

    /** The role the workspace list renders for one edge. */
    const listedRole = async (
      owner: UserId = userId(1),
      workspace: WorkspaceId = workspaceId(1),
    ): Promise<WorkspaceRole | null> => {
      const page = await backend.userWorkspaceDirectory.listActiveByUser(
        owner,
        null,
        20,
      );
      return (
        page.items.find((item) => item.workspaceId === workspace)?.role ?? null
      );
    };

    const applyRole = (
      role: WorkspaceRole,
      sourceVersion: number,
      owner: UserId = userId(1),
      workspace: WorkspaceId = workspaceId(1),
    ): Promise<boolean> =>
      store().applyRoleIfNewer({
        userId: owner,
        workspaceId: workspace,
        role,
        sourceVersion,
      });

    const activatingKeys = async (
      owner: UserId = userId(1),
      limit = 20,
    ): Promise<readonly string[]> =>
      (await store().listActivatingByUser(owner, limit)).map(
        (edge) => edge.operationId,
      );

    const prepare = (
      edgeOperationId: string,
      deletionOperationId: string,
    ): Promise<void> =>
      store().prepareAccountDeletion({
        edgeOperationId,
        deletionOperationId,
        expiresAt: new Date(backend.clock.now().getTime() + 10 * MINUTE_MS),
      });

    const renew = (
      edgeOperationId: string,
      deletionOperationId: string,
    ): Promise<void> =>
      store().renewAccountDeletion(
        edgeOperationId,
        deletionOperationId,
        new Date(backend.clock.now().getTime() + HOUR_MS),
      );

    it("ADP-workspace-033/034/040: a claimed edge is activating until the local commit settles it", async () => {
      await claim("op-1");
      expect(await activatingKeys()).toEqual(["op-1"]);
      expect(await activeWorkspaces()).toEqual([]);

      await store().activate("op-1");
      expect(await activatingKeys()).toEqual([]);
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
    });

    it("ADP-workspace-033/034: reserve and activate are idempotent per operation (lost response)", async () => {
      await claim("op-1");
      await claim("op-1");
      await store().activate("op-1");
      await store().activate("op-1");
      // A second row would show up as a second active workspace edge.
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
    });

    it("ADP-workspace-033: another operation for the same pair is MEMBERSHIP_ALREADY_EXISTS", async () => {
      await claim("op-1");
      await expectConflict(claim("op-2"), "MEMBERSHIP_ALREADY_EXISTS");

      await store().activate("op-1");
      await expectConflict(claim("op-3"), "MEMBERSHIP_ALREADY_EXISTS");

      // Only the pair is taken — the same user may still join elsewhere.
      await claim("op-4", userId(1), workspaceId(2), 2);
      await store().activate("op-4");
      expect(await activeWorkspaces()).toContain(workspaceId(2));
    });

    it("ADP-workspace-033: a user that is not active leaves no row at all", async () => {
      const found = await backend.userRepository.findById(userId(1));
      if (found === null || found.entity.status !== "active") {
        throw new Error("seeded user missing");
      }
      await backend.userRepository.save(
        User.beginDeletion(found.entity, "deletion-1", backend.clock.now()),
        found.expectedVersion,
      );

      await expectConflict(claim("op-1"));
      // No row slipped in behind the deletion's manifest cursor: neither
      // this port nor the directory can see one.
      expect(await activatingKeys()).toEqual([]);
      expect(await activeWorkspaces()).toEqual([]);
      await expectConflict(store().activate("op-1"));
    });

    it("ADP-workspace-034: activating an edge that abandon already dropped conflicts", async () => {
      await claim("op-1");
      await store().abandon("op-1");

      await expectConflict(store().activate("op-1"));
      expect(await activeWorkspaces()).toEqual([]);
    });

    it("ADP-workspace-035: abandon never touches a settled edge and is safe to repeat", async () => {
      await claim("op-1");
      await store().activate("op-1");
      await store().abandon("op-1");
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);

      await claim("op-2", userId(2), workspaceId(2), 2);
      await store().abandon("op-2");
      await store().abandon("op-2");
      await store().abandon("op-unknown");
      expect(await activatingKeys(userId(2))).toEqual([]);
    });

    it("ADP-workspace-036: only a pending edge can be prepared, and a prepared edge refuses activation", async () => {
      await claim("op-1");
      // An edge a join still holds is not the deletion's business.
      await expectConflict(prepare("op-1", "deletion-1"));

      if (!(await seedPendingEdge("edge-pending"))) {
        return;
      }
      await prepare("edge-pending", "deletion-1");
      await expectConflict(store().activate("edge-pending"));
    });

    it("ADP-workspace-036/037: the prepare lock is idempotent for its deletion and never transfers on expiry", async () => {
      if (!(await seedPendingEdge("edge-pending"))) {
        return;
      }
      await prepare("edge-pending", "deletion-1");
      await prepare("edge-pending", "deletion-1");
      await expectConflict(prepare("edge-pending", "deletion-2"));

      // A lapsed lease is still the holder's: expiry alone never transfers
      // ownership, so the losing deletion keeps losing afterwards.
      backend.clock.advance(HOUR_MS);
      await expectConflict(prepare("edge-pending", "deletion-2"));
      await expectConflict(renew("edge-pending", "deletion-2"));

      await renew("edge-pending", "deletion-1");
      await expectConflict(store().activate("edge-pending"));
    });

    it("ADP-workspace-036/037: preparing or renewing an edge that is absent conflicts", async () => {
      await expectConflict(prepare("edge-missing", "deletion-1"));
      await expectConflict(renew("edge-missing", "deletion-1"));
    });

    it("ADP-workspace-038: commit cancels the prepared edge and is idempotent", async () => {
      if (!(await seedPendingEdge("edge-pending"))) {
        return;
      }
      await prepare("edge-pending", "deletion-1");
      await expectConflict(
        store().commitAccountDeletion("edge-pending", "deletion-2"),
      );

      await store().commitAccountDeletion("edge-pending", "deletion-1");
      // Already gone is the outcome the caller wanted, so a replay wins.
      await store().commitAccountDeletion("edge-pending", "deletion-1");
      await expectConflict(store().activate("edge-pending"));
    });

    it("ADP-workspace-039: release hands the edge back so the join may activate again", async () => {
      if (!(await seedPendingEdge("edge-pending"))) {
        return;
      }
      await prepare("edge-pending", "deletion-1");
      await expectConflict(store().activate("edge-pending"));

      await expectConflict(
        store().releaseAccountDeletion("edge-pending", "deletion-2"),
      );
      await store().releaseAccountDeletion("edge-pending", "deletion-1");
      // An edge with no lock succeeds, which is what lets the recovery
      // loop converge after a lost response.
      await store().releaseAccountDeletion("edge-pending", "deletion-1");

      await store().activate("edge-pending");
      expect(await activeWorkspaces(userId(2))).toEqual([workspaceId(3)]);
    });

    it("ADP-workspace-040: activating edges are enumerated in edge-key order, bounded, per user", async () => {
      await claim("op-c", userId(1), workspaceId(3), 3);
      await claim("op-a", userId(1), workspaceId(1), 1);
      await claim("op-b", userId(1), workspaceId(2), 2);
      await claim("op-d", userId(2), workspaceId(4), 4);

      expect(await activatingKeys(userId(1), 2)).toEqual(["op-a", "op-b"]);
      expect(await activatingKeys(userId(1))).toEqual(["op-a", "op-b", "op-c"]);
      expect(await activatingKeys(userId(2))).toEqual(["op-d"]);

      // The loop terminates as each entry is settled by its own saga.
      await store().activate("op-a");
      await store().abandon("op-b");
      await store().activate("op-c");
      expect(await activatingKeys(userId(1))).toEqual([]);
    });

    it("ADP-workspace-069/070: removal hides the edge at once and drops it after the cleanup ack", async () => {
      await claim("op-1");
      await store().activate("op-1");
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);

      await store().beginRemoval(userId(1), workspaceId(1));
      // The workspace leaves the member's list the moment the removal is
      // announced, while cleanup can still reach the scope through the
      // `removing` edge.
      expect(await activeWorkspaces()).toEqual([]);

      await store().completeRemoval(userId(1), workspaceId(1));
      // The pair is free again, so the same user may be invited back.
      await claim("op-2");
      await store().activate("op-2");
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
    });

    it("ADP-workspace-069/070: both transitions are idempotent and tolerate an absent edge", async () => {
      await claim("op-1");
      await store().activate("op-1");

      await store().beginRemoval(userId(1), workspaceId(1));
      await store().beginRemoval(userId(1), workspaceId(1));
      await store().completeRemoval(userId(1), workspaceId(1));
      await store().completeRemoval(userId(1), workspaceId(1));

      // Nothing to remove is the outcome both calls want.
      await store().beginRemoval(userId(2), workspaceId(9));
      await store().completeRemoval(userId(2), workspaceId(9));
      expect(await activeWorkspaces()).toEqual([]);
    });

    it("ADP-workspace-069: an edge a join still holds is not a removal's to take", async () => {
      await claim("op-1");
      await expectConflict(store().beginRemoval(userId(1), workspaceId(1)));

      if (!(await seedPendingEdge("edge-pending"))) {
        return;
      }
      await expectConflict(store().beginRemoval(userId(2), workspaceId(3)));
      // The join saga is untouched and still settles.
      await store().activate("op-1");
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
    });

    it("ADP-workspace-073: a role change projects onto the settled edge", async () => {
      await claim("op-1");
      await store().activate("op-1");
      expect(await listedRole()).toBe("editor");

      expect(await applyRole("viewer", 1)).toBe(true);
      expect(await listedRole()).toBe("viewer");
      // The role the reservation carried is older than any Membership
      // version, so the first change always lands.
      expect(await listedRole(userId(1), workspaceId(2))).toBeNull();
    });

    it("ADP-workspace-073: a redelivered or late change never rolls the role back", async () => {
      await claim("op-1");
      await store().activate("op-1");

      expect(await applyRole("viewer", 1)).toBe(true);
      expect(await applyRole("owner", 2)).toBe(true);
      // Redelivery of the change that won writes nothing.
      expect(await applyRole("owner", 2)).toBe(false);
      // The demotion arrives after the promotion that followed it.
      expect(await applyRole("viewer", 1)).toBe(false);
      expect(await listedRole()).toBe("owner");
    });

    it("ADP-workspace-073: an edge a join has not settled still takes the role", async () => {
      await claim("op-1");
      expect(await applyRole("owner", 1)).toBe(true);

      await store().activate("op-1");
      expect(await listedRole()).toBe("owner");
    });

    it("ADP-workspace-073: an absent or removed edge is never resurrected", async () => {
      // Nothing was ever reserved for this pair.
      expect(await applyRole("owner", 1)).toBe(false);
      expect(await activeWorkspaces()).toEqual([]);

      await claim("op-1");
      await store().activate("op-1");
      await store().beginRemoval(userId(1), workspaceId(1));
      await store().completeRemoval(userId(1), workspaceId(1));

      expect(await applyRole("owner", 5)).toBe(false);
      expect(await activeWorkspaces()).toEqual([]);
      expect(await listedRole()).toBeNull();
    });

    it("ADP-workspace-070: an edge that never entered removing is not dropped", async () => {
      await claim("op-1");
      await store().activate("op-1");

      await expectConflict(store().completeRemoval(userId(1), workspaceId(1)));
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
    });
  });
}
