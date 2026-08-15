import { beforeEach, describe, expect, it } from "vitest";
import type { PersonalCleanupComponent } from "../../application/ports/scopeCleanupAdmissionStore";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { scopeOf, userId } from "./fixtures";

/**
 * The declaration this suite drives the backend with. It is a strict
 * subset of the enum on purpose: the contract is "every declared
 * component and nothing else", so a backend that quietly demands the
 * full enum fails here.
 */
const DECLARED_COMPONENTS: readonly PersonalCleanupComponent[] = [
  "storage",
  "usage",
];

const UNDECLARED_COMPONENT: PersonalCleanupComponent = "note";

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
      backend = await makeBackend({
        requiredCleanupComponents: DECLARED_COMPONENTS,
      });
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

      for (const component of DECLARED_COMPONENTS) {
        await store.acknowledgePersonalComponent("op-1", component);
      }
      await store.markCompleted(
        "op-1",
        new Date(backend.clock.now().getTime() + 120 * DAY_MS),
      );
      // Ownership is the right to keep cleaning, so it lapses on
      // completion even though a late ack stays idempotent
      // (ADP-common-009/010).
      await expectConflict(store.assertOwner("op-1"));
    });

    it("ADP-common-007: abort by the running owner reopens writes", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      await expectConflict(store.abortPersonalAccountDeletion("op-2"));
      await store.abortPersonalAccountDeletion("op-1");
      await store.assertWritable();
    });

    it("ADP-common-009/010: markCompleted requires every declared component ack", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      const retainUntil = new Date(
        backend.clock.now().getTime() + 120 * DAY_MS,
      );

      await expectConflict(store.markCompleted("op-1", retainUntil));

      for (const component of DECLARED_COMPONENTS.slice(0, -1)) {
        await store.acknowledgePersonalComponent("op-1", component);
      }
      // One declared component short is still not complete, and a
      // component nothing declares cannot stand in for it.
      await store.acknowledgePersonalComponent("op-1", UNDECLARED_COMPONENT);
      await expectConflict(store.markCompleted("op-1", retainUntil));

      const last = DECLARED_COMPONENTS.at(-1);
      if (last === undefined) {
        throw new Error("the suite declares at least one component");
      }
      await store.acknowledgePersonalComponent("op-1", last);
      // Duplicate acks inside the retention window no-op safely.
      await store.acknowledgePersonalComponent("op-1", last);

      await store.markCompleted("op-1", retainUntil);
      await store.markCompleted("op-1", retainUntil);
      // As does one that arrives after completion: a late ack must not
      // walk the receipt back to `running`, which would leave
      // `pruneCompleted` nothing to reclaim.
      await store.acknowledgePersonalComponent("op-1", last);
      expect((await store.describePersonalCleanup("op-1"))?.status).toBe(
        "completed",
      );

      // Completion never reopens the scope.
      await expectConflict(store.assertWritable(), "ACCOUNT_DELETING");
    });

    it("ADP-common-009: describePersonalCleanup reports what a re-driven turn still owes", async () => {
      expect(await store.describePersonalCleanup("op-1")).toBeNull();

      await store.beginPersonalAccountDeletion("op-1", userId(1));
      expect(await store.describePersonalCleanup("op-1")).toEqual({
        status: "running",
        acknowledged: [],
      });
      // A foreign operation reads nothing at all.
      expect(await store.describePersonalCleanup("op-2")).toBeNull();

      const retainUntil = new Date(
        backend.clock.now().getTime() + 120 * DAY_MS,
      );
      for (const component of DECLARED_COMPONENTS) {
        await store.acknowledgePersonalComponent("op-1", component);
      }
      expect(
        (await store.describePersonalCleanup("op-1"))?.acknowledged,
      ).toEqual(expect.arrayContaining([...DECLARED_COMPONENTS]));

      await store.markCompleted("op-1", retainUntil);
      expect((await store.describePersonalCleanup("op-1"))?.status).toBe(
        "completed",
      );
    });

    it("ADP-common-011: pruneCompleted reclaims only after retainUntil", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      for (const component of DECLARED_COMPONENTS) {
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

    it("ADP-common-011: pruneCompleted accepts an over-cap limit (one scope holds at most one receipt, so no page cap can bind)", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      for (const component of DECLARED_COMPONENTS) {
        await store.acknowledgePersonalComponent("op-1", component);
      }
      const retainUntil = new Date(
        backend.clock.now().getTime() + 120 * DAY_MS,
      );
      await store.markCompleted("op-1", retainUntil);

      // One receipt per scope leaves `limit` nothing to truncate, so a
      // limit-ignoring backend is indistinguishable here. All this pins
      // is that an over-cap limit is accepted rather than rejected: the
      // port contract names no page cap, so there is no clamp to verify.
      expect(await store.pruneCompleted(retainUntil, 1_000)).toBe(1);
    });

    it("ADP-common-011: a running receipt has no expiry and is never pruned", async () => {
      await store.beginPersonalAccountDeletion("op-1", userId(1));
      backend.clock.advance(365 * DAY_MS);
      expect(await store.pruneCompleted(backend.clock.now(), 100)).toBe(0);
      await expectConflict(store.assertWritable(), "ACCOUNT_DELETING");
    });
  });
}
