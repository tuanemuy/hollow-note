import { beforeEach, describe, expect, it } from "vitest";
import { Membership } from "../../domain/workspace/membership";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import {
  makeMembership,
  userId,
  workspaceId,
  workspaceScopeOf,
} from "./fixtures";

const MINUTE_MS = 60 * 1000;
const LEASE_MS = 10 * MINUTE_MS;

/**
 * Shared conformance suite for `MembershipRemovalPreparationStore`
 * (ADP-workspace-041..045): the version-conditional prepare, the
 * monotonic lease that never lapses on its own, and the single
 * `release` that reopens the membership.
 */
export function describeMembershipRemovalPreparationStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`MembershipRemovalPreparationStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;
    const store =
      (): ScopedConformancePorts["membershipRemovalPreparationStore"] =>
        scoped.membershipRemovalPreparationStore;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(workspaceScopeOf(1));
      await scoped.membershipRepository.insert(
        makeMembership(
          1,
          workspaceId(1),
          userId(1),
          "owner",
          backend.clock.now(),
        ),
      );
      await scoped.membershipRepository.insert(
        makeMembership(
          2,
          workspaceId(1),
          userId(2),
          "editor",
          backend.clock.now(),
        ),
      );
    });

    const prepare = (
      operationId: string,
      member = userId(1),
      expectedMembershipVersion = 0,
    ): Promise<void> =>
      store().prepare({
        operationId,
        userId: member,
        expectedMembershipVersion,
        expiresAt: new Date(backend.clock.now().getTime() + LEASE_MS),
      });

    it("ADP-workspace-041/045: a prepared lock is a conflict for its member alone", async () => {
      expect(await store().hasConflict(userId(1))).toBe(false);

      await prepare("op-1");
      expect(await store().hasConflict(userId(1))).toBe(true);
      expect(await store().hasConflict(userId(2))).toBe(false);
    });

    it("ADP-workspace-041: prepare is conditional on the observed Membership version", async () => {
      const found = await scoped.membershipRepository.findByWorkspaceAndUser(
        workspaceId(1),
        userId(1),
      );
      if (found === null) {
        throw new Error("seeded membership missing");
      }
      await scoped.membershipRepository.save(
        Membership.changeRole(found.entity, "editor", backend.clock.now())
          .entity,
        found.expectedVersion,
      );

      await expectConflict(
        prepare("op-1", userId(1), 0),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      expect(await store().hasConflict(userId(1))).toBe(false);

      await prepare("op-1", userId(1), 1);
      expect(await store().hasConflict(userId(1))).toBe(true);
    });

    it("ADP-workspace-041: a membership that is gone reports the same conflict", async () => {
      await expectConflict(
        prepare("op-1", userId(3), 0),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      expect(await store().hasConflict(userId(3))).toBe(false);
    });

    it("ADP-workspace-041/045: another operation's lock holds even after its lease lapses", async () => {
      await prepare("op-1");

      await expectConflict(prepare("op-2"));
      backend.clock.advance(LEASE_MS + 1);
      // Fail-safe: a lapsed lease neither frees the membership nor stops
      // answering `hasConflict`. Only `release` does.
      await expectConflict(prepare("op-2"));
      expect(await store().hasConflict(userId(1))).toBe(true);

      await store().release("op-1");
      expect(await store().hasConflict(userId(1))).toBe(false);
      await prepare("op-2");
      expect(await store().hasConflict(userId(1))).toBe(true);
    });

    it("ADP-workspace-041/042: prepare and renew are idempotent for the holder", async () => {
      await prepare("op-1");
      await prepare("op-1");
      await store().renew(
        "op-1",
        new Date(backend.clock.now().getTime() + LEASE_MS),
      );
      // An out-of-order replay quoting an older instant is harmless.
      await store().renew("op-1", new Date(backend.clock.now().getTime()));
      expect(await store().hasConflict(userId(1))).toBe(true);
    });

    it("ADP-workspace-042: renewing a lock that does not exist conflicts", async () => {
      await expectConflict(
        store().renew(
          "op-unknown",
          new Date(backend.clock.now().getTime() + LEASE_MS),
        ),
      );
      expect(await store().hasConflict(userId(1))).toBe(false);
    });

    it("ADP-workspace-042/043: a committed lock renews without effect and commits idempotently", async () => {
      await prepare("op-1");
      await store().commit("op-1");
      await store().commit("op-1");
      // A renewal that raced the commit must not fail the recovery loop.
      await store().renew(
        "op-1",
        new Date(backend.clock.now().getTime() + LEASE_MS),
      );

      backend.clock.advance(LEASE_MS * 10);
      // A committed lock carries no expiry and never lapses back.
      expect(await store().hasConflict(userId(1))).toBe(true);
    });

    it("ADP-workspace-043: committing what was never prepared conflicts", async () => {
      await expectConflict(store().commit("op-unknown"));
      expect(await store().hasConflict(userId(1))).toBe(false);
    });

    it("ADP-workspace-044: release removes the lock in either state and is a no-op afterwards", async () => {
      await prepare("op-1");
      await store().release("op-1");
      await store().release("op-1");
      expect(await store().hasConflict(userId(1))).toBe(false);

      await prepare("op-2");
      await store().commit("op-2");
      await store().release("op-2");
      expect(await store().hasConflict(userId(1))).toBe(false);
      await store().release("op-unknown");
    });

    it("ADP-workspace-041/045: the lock is bound to its own scope", async () => {
      await prepare("op-1");

      const other = backend.forScope(workspaceScopeOf(2));
      expect(
        await other.membershipRemovalPreparationStore.hasConflict(userId(1)),
      ).toBe(false);
    });
  });
}
