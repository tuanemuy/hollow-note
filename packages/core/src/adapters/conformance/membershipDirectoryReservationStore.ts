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
 * (ADP-workspace-033..040 / 069 / 070 / 073 / 074): the join saga's
 * claim, the account-deletion prepare lock that serializes against it,
 * the removal and its compensation, and the role projection ordered by
 * membership generation and Membership version.
 *
 * A `pending` edge is the deletion half's only subject, and no method of
 * this port leaves one behind (`reserveAndClaimActivation` inserts and
 * claims in one transaction), so those cases seed the edge through
 * `seedMembershipEdges`.
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

    /**
     * The one state the port itself never leaves behind, so the deletion
     * half's cases start from a seeded row.
     */
    const seedPendingEdge = (
      edgeKey: string,
      owner: UserId = userId(2),
      workspace: WorkspaceId = workspaceId(3),
    ): Promise<void> =>
      backend.seedMembershipEdges(owner, [
        {
          edgeKey,
          workspaceId: workspace,
          edgeState: "pending",
          membershipId: null,
        },
      ]);

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
      membership = 1,
    ): Promise<void> =>
      store().applyRoleIfNewer({
        userId: owner,
        workspaceId: workspace,
        membershipId: membershipId(membership),
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

      await seedPendingEdge("edge-pending");
      await prepare("edge-pending", "deletion-1");
      await expectConflict(store().activate("edge-pending"));
    });

    it("ADP-workspace-035/036: a join's compensation cannot cancel an edge a deletion has prepared", async () => {
      await seedPendingEdge("edge-pending");
      await prepare("edge-pending", "deletion-1");

      // The join lost its `activate` to the lock and compensates blindly.
      // Dropping the row here would take the deletion's subject out from
      // under it and free the pair for a join behind its cursor.
      await store().abandon("edge-pending");

      await expectConflict(store().activate("edge-pending"));
      await store().releaseAccountDeletion("edge-pending", "deletion-1");
      // Still there, and still the edge the join reserved.
      await store().activate("edge-pending");
      expect(await activeWorkspaces(userId(2))).toEqual([workspaceId(3)]);
    });

    it("ADP-workspace-036/037: the prepare lock is idempotent for its deletion and never transfers on expiry", async () => {
      await seedPendingEdge("edge-pending");
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
      await seedPendingEdge("edge-pending");
      await prepare("edge-pending", "deletion-1");
      await expectConflict(
        store().commitAccountDeletion("edge-pending", "deletion-2"),
      );

      await store().commitAccountDeletion("edge-pending", "deletion-1");
      // Already gone is the outcome the caller wanted, so a replay wins.
      await store().commitAccountDeletion("edge-pending", "deletion-1");
      await expectConflict(store().activate("edge-pending"));
    });

    it("ADP-workspace-038: commit removes the edge, so the pair is free to join again", async () => {
      await seedPendingEdge("edge-pending");
      await prepare("edge-pending", "deletion-1");
      await store().commitAccountDeletion("edge-pending", "deletion-1");

      // The only transition that *removes* an edge. Marking the row and
      // leaving it would hold `(userId, workspaceId)` forever, so the
      // deleted account's workspace could never take the user back.
      await claim("op-rejoin", userId(2), workspaceId(3), 5);
      await store().activate("op-rejoin");
      expect(await activeWorkspaces(userId(2))).toEqual([workspaceId(3)]);
    });

    it("ADP-workspace-039: release hands the edge back so the join may activate again", async () => {
      await seedPendingEdge("edge-pending");
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

    it("ADP-workspace-069: an edge whose activation never landed is still the removal's to take", async () => {
      await claim("op-1");

      // The join lost its `activate`, so the edge never settled — but the
      // workspace scope says the membership is gone, and a removal that
      // could not proceed here would strand both this pair and the
      // deletion that walks it.
      await store().beginRemoval(userId(1), workspaceId(1));
      await expectConflict(store().activate("op-1"));
      // The join's own compensation cannot undo the removal: the pair is
      // still taken, so a fresh claim loses.
      await store().abandon("op-1");
      await expectConflict(claim("op-2"), "MEMBERSHIP_ALREADY_EXISTS");

      await store().completeRemoval(userId(1), workspaceId(1));
      expect(await activeWorkspaces()).toEqual([]);
      // Only now is the pair free again.
      await claim("op-3");
      await store().activate("op-3");
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
    });

    it("ADP-workspace-069: an edge a deletion may still prepare is not a removal's to take", async () => {
      await seedPendingEdge("edge-pending");
      await expectConflict(store().beginRemoval(userId(2), workspaceId(3)));
      // The edge is untouched, so the deletion half still decides it.
      await prepare("edge-pending", "deletion-1");
      await store().commitAccountDeletion("edge-pending", "deletion-1");
    });

    it("ADP-workspace-074: an abandoned removal puts the workspace back in the list", async () => {
      await claim("op-1");
      await store().activate("op-1");
      await store().beginRemoval(userId(1), workspaceId(1));
      expect(await activeWorkspaces()).toEqual([]);

      // The removal's second guard refused, so the announcement is taken
      // back and the member keeps the workspace they never lost.
      await store().abandonRemoval(userId(1), workspaceId(1));
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);

      // The edge is settled again, so a later removal announces anew.
      await store().beginRemoval(userId(1), workspaceId(1));
      await store().completeRemoval(userId(1), workspaceId(1));
      expect(await activeWorkspaces()).toEqual([]);
    });

    it("ADP-workspace-074: abandoning a removal is idempotent and tolerates an absent edge", async () => {
      await claim("op-1");
      await store().activate("op-1");
      await store().beginRemoval(userId(1), workspaceId(1));

      await store().abandonRemoval(userId(1), workspaceId(1));
      // Already `active` is the outcome the caller wants.
      await store().abandonRemoval(userId(1), workspaceId(1));
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);

      // A removal that already completed leaves nothing to restore.
      await store().abandonRemoval(userId(2), workspaceId(9));
      expect(await activeWorkspaces(userId(2))).toEqual([]);
    });

    it("ADP-workspace-074: an edge no removal announced is not restorable", async () => {
      await claim("op-1");
      await expectConflict(store().abandonRemoval(userId(1), workspaceId(1)));

      // The join is untouched and still settles.
      await store().activate("op-1");
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
    });

    it("ADP-workspace-073: a role change projects onto the settled edge", async () => {
      await claim("op-1");
      await store().activate("op-1");
      expect(await listedRole()).toBe("editor");

      await applyRole("viewer", 1);
      expect(await listedRole()).toBe("viewer");
      // The role the reservation carried is older than any Membership
      // version, so the first change always lands.
      expect(await listedRole(userId(1), workspaceId(2))).toBeNull();
    });

    it("ADP-workspace-073: a redelivered or late change never rolls the role back", async () => {
      await claim("op-1");
      await store().activate("op-1");

      await applyRole("viewer", 1);
      await applyRole("owner", 2);
      // Redelivery of the change that won writes nothing.
      await applyRole("owner", 2);
      // The demotion arrives after the promotion that followed it.
      await applyRole("viewer", 1);
      expect(await listedRole()).toBe("owner");
    });

    it("ADP-workspace-073: an edge a join has not settled still takes the role", async () => {
      await claim("op-1");
      await applyRole("owner", 1);

      await store().activate("op-1");
      expect(await listedRole()).toBe("owner");
    });

    it("ADP-workspace-073: an edge that names no membership takes no projection", async () => {
      await backend.seedMembershipEdges(userId(2), [
        {
          edgeKey: "edge-pending",
          workspaceId: workspaceId(3),
          edgeState: "pending",
          membershipId: null,
          role: "viewer",
        },
      ]);

      // Every reservation writes its `membershipId`, so an edge naming
      // none is not the generation this change belongs to and the match
      // fails closed. Writing anyway would give the row a version and
      // then refuse the first change of whatever membership settles it.
      await applyRole("owner", 1, userId(2), workspaceId(3), 1);

      await store().activate("edge-pending");
      expect(await listedRole(userId(2), workspaceId(3))).toBe("viewer");
    });

    it("ADP-workspace-073: an absent or removed edge is never resurrected", async () => {
      // Nothing was ever reserved for this pair.
      await applyRole("owner", 1);
      expect(await activeWorkspaces()).toEqual([]);

      await claim("op-1");
      await store().activate("op-1");
      await store().beginRemoval(userId(1), workspaceId(1));
      await store().completeRemoval(userId(1), workspaceId(1));

      await applyRole("owner", 5);
      expect(await activeWorkspaces()).toEqual([]);
      expect(await listedRole()).toBeNull();
    });

    it("ADP-workspace-073: a change of the membership a rejoin replaced leaves the new edge alone", async () => {
      await claim("op-1");
      await store().activate("op-1");
      // The member is removed while a change of membership 1 is still in
      // flight, and rejoins under a second membership.
      await store().beginRemoval(userId(1), workspaceId(1));
      await store().completeRemoval(userId(1), workspaceId(1));
      await claim("op-2", userId(1), workspaceId(1), 2);
      await store().activate("op-2");

      // The late change names the membership that is gone. Its version
      // would otherwise win, since the new edge has never been projected.
      await applyRole("owner", 1);
      expect(await listedRole()).toBe("editor");

      // And the new membership's own first change still lands, which the
      // stale write would have blocked by claiming version 1 first.
      await applyRole("viewer", 1, userId(1), workspaceId(1), 2);
      expect(await listedRole()).toBe("viewer");
    });

    it("ADP-workspace-070: an edge that never entered removing is not dropped", async () => {
      await claim("op-1");
      await store().activate("op-1");

      await expectConflict(store().completeRemoval(userId(1), workspaceId(1)));
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
    });

    it("ADP-workspace-070/074: neither tear-down transition takes an edge a join or a deletion still holds", async () => {
      // `activating` is the join's claim: no removal announced it, so
      // dropping it would lose the pair while the join still expects to
      // settle, and restoring it would settle a join nobody activated.
      await claim("op-1");
      await expectConflict(store().completeRemoval(userId(1), workspaceId(1)));
      await expectConflict(store().abandonRemoval(userId(1), workspaceId(1)));

      // `pending` is the state a deletion's prepare lock owns, so either
      // call would decide against a deletion that has already decided.
      await seedPendingEdge("edge-pending");
      await expectConflict(store().completeRemoval(userId(2), workspaceId(3)));
      await expectConflict(store().abandonRemoval(userId(2), workspaceId(3)));

      // Both edges are untouched, so each half still settles its own.
      await store().activate("op-1");
      expect(await activeWorkspaces()).toEqual([workspaceId(1)]);
      await prepare("edge-pending", "deletion-1");
      await store().commitAccountDeletion("edge-pending", "deletion-1");
    });
  });
}
