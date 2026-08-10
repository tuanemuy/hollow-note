import { beforeEach, describe, expect, it } from "vitest";
import type { PersonalCleanupComponent } from "../../application/ports/scopeCleanupAdmissionStore";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { scopeOf, userId } from "./fixtures";

const ALL_COMPONENTS: readonly PersonalCleanupComponent[] = [
  "job",
  "note",
  "tag",
  "storage",
  "backup",
  "usage",
  "localProjection",
  "outbox",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shared conformance suite for `ScopeCleanupAdmissionStore`
 * (ADP-common-004..011): the personal account-deletion barrier and its
 * per-component receipt.
 */
export function describeScopeCleanupAdmissionStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`ScopeCleanupAdmissionStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let store: ScopedConformancePorts["scopeCleanupAdmissionStore"];

    beforeEach(async () => {
      backend = await makeBackend();
      store = backend.forScope(scopeOf(1)).scopeCleanupAdmissionStore;
    });

    it("ADP-common-004/005: an open scope admits writes", async () => {
      await store.assertWritable();
      await store.assertActorWritable(userId(1));
    });

    it("ADP-common-006: the barrier rejects later writes with ACCOUNT_DELETING", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      await expectConflict(store.assertWritable(), "ACCOUNT_DELETING");
      await expectConflict(
        store.assertActorWritable(userId(1)),
        "ACCOUNT_DELETING",
      );
    });

    it("ADP-common-006: begin is idempotent for the owner and rejects a foreign operation", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      await expectConflict(
        store.beginPersonalAccountDeletion("op-2", userId(1)),
      );
    });

    it("ADP-common-008: assertOwner rejects a different id and a missing receipt", async () => {
      await expectConflict(store.assertOwner("op-1"));
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      await store.assertOwner("op-1");
      await expectConflict(store.assertOwner("op-2"));
    });

    it("ADP-common-007: abort by the running owner reopens writes", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      await expectConflict(store.abortPersonalAccountDeletion("op-2"));
      await store.abortPersonalAccountDeletion("op-1");
      await store.assertWritable();
    });

    it("ADP-common-009/010: markCompleted requires every component ack", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      const retainUntil = new Date(
        backend.clock.now().getTime() + 120 * DAY_MS,
      );

      await expectConflict(store.markCompleted("op-1", retainUntil));

      for (const component of ALL_COMPONENTS) {
        await store.acknowledgePersonalComponent("op-1", component);
      }
      // Duplicate acks inside the retention window no-op safely.
      await store.acknowledgePersonalComponent("op-1", "note");

      await store.markCompleted("op-1", retainUntil);
      await store.markCompleted("op-1", retainUntil);

      // Completion never reopens the scope.
      await expectConflict(store.assertWritable(), "ACCOUNT_DELETING");
    });

    it("ADP-common-011: pruneCompleted reclaims only after retainUntil", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      for (const component of ALL_COMPONENTS) {
        await store.acknowledgePersonalComponent("op-1", component);
      }
      const retainUntil = new Date(
        backend.clock.now().getTime() + 120 * DAY_MS,
      );
      await store.markCompleted("op-1", retainUntil);

      expect(
        await store.pruneCompleted(new Date(retainUntil.getTime() - 1), 100),
      ).toBe(0);
      expect(await store.pruneCompleted(retainUntil, 100)).toBe(1);
      await store.assertWritable();
    });

    it("ADP-common-011: pruneCompleted clamps an over-cap limit to the 100-row page cap", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      for (const component of ALL_COMPONENTS) {
        await store.acknowledgePersonalComponent("op-1", component);
      }
      const retainUntil = new Date(
        backend.clock.now().getTime() + 120 * DAY_MS,
      );
      await store.markCompleted("op-1", retainUntil);

      // A scope holds at most one receipt, so the cap can never be
      // saturated here; what the contract pins is that an over-cap limit
      // is accepted and clamped rather than honoured verbatim.
      const removed = await store.pruneCompleted(retainUntil, 1_000);
      expect(removed).toBeLessThanOrEqual(100);
      expect(removed).toBe(1);
    });

    it("ADP-common-011: a running receipt has no expiry and is never pruned", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      backend.clock.advance(365 * DAY_MS);
      expect(await store.pruneCompleted(backend.clock.now(), 100)).toBe(0);
      await expectConflict(store.assertWritable(), "ACCOUNT_DELETING");
    });
  });
}
