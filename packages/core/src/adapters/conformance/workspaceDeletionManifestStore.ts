import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceDeletionManifestItem } from "../../domain/workspace/ports/workspaceDeletionManifestStore";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import {
  invitationId,
  invitationTokenHash,
  makeInvitation,
  makeMembership,
  makeWorkspace,
  membershipId,
  userId,
  workspaceId,
  workspaceScopeOf,
} from "./fixtures";

const OPERATION = "deletion-1";

/**
 * Shared conformance suite for `WorkspaceDeletionManifestStore`
 * (ADP-workspace-052..060): the four phases of a workspace deletion, each
 * bounded to one page, each idempotent for its operation.
 *
 * Item keys are opaque, so every case names an item by the key the store
 * itself handed out and never builds one.
 */
export function describeWorkspaceDeletionManifestStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`WorkspaceDeletionManifestStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;
    const store =
      (): ScopedConformancePorts["workspaceDeletionManifestStore"] =>
        scoped.workspaceDeletionManifestStore;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(workspaceScopeOf(1));
      const now = backend.clock.now();
      await scoped.workspaceRepository.insert(makeWorkspace(1, userId(1), now));
      for (const n of [1, 2, 3]) {
        await scoped.membershipRepository.insert(
          makeMembership(n, workspaceId(1), userId(n), "editor", now),
        );
      }
      for (const n of [1, 2]) {
        await scoped.invitationRepository.insert(
          makeInvitation(n, workspaceId(1), userId(1), now),
        );
      }
      await scoped.workspaceOperationLockStore.beginDeletion({
        workspaceId: workspaceId(1),
        operationId: OPERATION,
        expectedWorkspaceVersion: 0,
      });
    });

    const allItems = async (): Promise<
      readonly WorkspaceDeletionManifestItem[]
    > => {
      const collected: WorkspaceDeletionManifestItem[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await store().listItems(OPERATION, cursor, 100);
        collected.push(...page.items);
        if (page.nextCursor === null) {
          return collected;
        }
        cursor = page.nextCursor;
      }
    };

    const fixEverything = async (): Promise<void> => {
      await store().appendMembershipPage(OPERATION, null, 100);
      await store().appendInvitationPage(OPERATION, null, 100);
    };

    const keysOf = (
      items: readonly WorkspaceDeletionManifestItem[],
    ): readonly string[] => items.map((item) => item.key);

    it("ADP-workspace-052: memberships are fixed one keyset page at a time", async () => {
      const first = await store().appendMembershipPage(OPERATION, null, 2);
      expect(first).toEqual({ next: membershipId(2), count: 2 });

      const second = await store().appendMembershipPage(
        OPERATION,
        first.next,
        2,
      );
      expect(second).toEqual({ next: null, count: 1 });

      const items = await allItems();
      expect(items).toHaveLength(3);
      expect(
        items.map((item) =>
          item.kind === "membership" ? item.membershipId : null,
        ),
      ).toEqual([membershipId(1), membershipId(2), membershipId(3)]);
      expect(
        items.map((item) => (item.kind === "membership" ? item.userId : null)),
      ).toEqual([userId(1), userId(2), userId(3)]);
    });

    it("ADP-workspace-053: invitations are fixed with the token hash that routes them", async () => {
      const page = await store().appendInvitationPage(OPERATION, null, 1);
      expect(page).toEqual({ next: invitationId(1), count: 1 });

      const [item] = await allItems();
      if (item === undefined || item.kind !== "invitation") {
        throw new Error("an invitation item is fixed");
      }
      expect(item.invitationId).toBe(invitationId(1));
      expect(item.tokenHash).toBe(invitationTokenHash(1));
      expect(item.localDeletedAt).toBeNull();
      expect(item.globalAckedAt).toBeNull();
    });

    it("ADP-workspace-052/053: re-walking from a stale cursor fixes nothing new", async () => {
      await fixEverything();
      const fixed = keysOf(await allItems());
      expect(fixed).toHaveLength(5);

      // A caller that lost both the response and its cursor re-walks from
      // the start; the closed scope can only ever answer the same set.
      await store().appendMembershipPage(OPERATION, null, 100);
      await store().appendMembershipPage(OPERATION, membershipId(1), 100);
      await store().appendInvitationPage(OPERATION, null, 100);

      expect(keysOf(await allItems())).toEqual(fixed);
    });

    it("ADP-workspace-054: markReady is refused until both walks reached their end", async () => {
      await store().appendMembershipPage(OPERATION, null, 2);
      await expectConflict(store().markReady(OPERATION));

      await store().appendMembershipPage(OPERATION, membershipId(2), 2);
      // The invitation walk has not run at all yet.
      await expectConflict(store().markReady(OPERATION));

      await store().appendInvitationPage(OPERATION, null, 100);
      await store().markReady(OPERATION);
      await store().markReady(OPERATION);
    });

    it("ADP-workspace-054/060: a completed manifest is terminal", async () => {
      const other = backend.forScope(workspaceScopeOf(2));
      await other.workspaceRepository.insert(
        makeWorkspace(2, userId(1), backend.clock.now()),
      );
      await other.workspaceOperationLockStore.beginDeletion({
        workspaceId: workspaceId(2),
        operationId: "deletion-2",
        expectedWorkspaceVersion: 0,
      });
      await other.workspaceDeletionManifestStore.markCompleted("deletion-2");
      // Idempotent: a lost response cannot stamp the tombstone twice.
      await other.workspaceDeletionManifestStore.markCompleted("deletion-2");

      await expectConflict(
        other.workspaceDeletionManifestStore.markReady("deletion-2"),
      );
      await expectConflict(
        other.workspaceDeletionManifestStore.appendMembershipPage(
          "deletion-2",
          null,
          100,
        ),
      );
    });

    it("ADP-workspace-055/056: local acknowledgement retires items from the pending list", async () => {
      await fixEverything();
      const pending = await store().listLocalPending(OPERATION, 2);
      expect(pending).toHaveLength(2);
      // Repeating the read returns the same items until they are acked.
      expect(keysOf(await store().listLocalPending(OPERATION, 2))).toEqual(
        keysOf(pending),
      );

      await store().acknowledgeLocal(OPERATION, keysOf(pending));
      const next = await store().listLocalPending(OPERATION, 100);
      expect(next).toHaveLength(3);
      expect(keysOf(next)).not.toContain(pending[0]?.key);
    });

    it("ADP-workspace-056: the first local timestamp wins and unknown keys are ignored", async () => {
      await fixEverything();
      const [first] = await store().listLocalPending(OPERATION, 1);
      if (first === undefined) {
        throw new Error("a pending item exists");
      }
      await store().acknowledgeLocal(OPERATION, [first.key]);
      const stamped = (await allItems()).find(
        (item) => item.key === first.key,
      )?.localDeletedAt;
      expect(stamped).not.toBeNull();

      backend.clock.advance(60_000);
      await store().acknowledgeLocal(OPERATION, [first.key, "no-such-key"]);
      expect(
        (await allItems()).find((item) => item.key === first.key)
          ?.localDeletedAt,
      ).toEqual(stamped);
    });

    it("ADP-workspace-057: listItems walks the whole key order, acknowledged items included", async () => {
      await fixEverything();
      const everything = keysOf(await allItems());
      expect(everything).toHaveLength(5);
      expect(new Set(everything).size).toBe(5);

      await store().acknowledgeLocal(OPERATION, everything);
      await store().acknowledge(OPERATION, everything.slice(0, 2));

      const paged: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await store().listItems(OPERATION, cursor, 2);
        paged.push(...keysOf(page.items));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null);
      // Unfiltered: the acknowledged items are still walked.
      expect(paged).toEqual(everything);
      expect(pages).toBe(3);
    });

    it("ADP-workspace-058/059: only doubly acknowledged items are compacted, one page per turn", async () => {
      await fixEverything();
      const everything = keysOf(await allItems());

      // A global ack alone is not enough to reclaim an item.
      await store().acknowledge(OPERATION, everything);
      expect(await store().compactAcknowledged(OPERATION, 100)).toEqual({
        removed: 0,
        remaining: true,
      });

      await store().acknowledgeLocal(OPERATION, everything.slice(0, 4));
      expect(await store().compactAcknowledged(OPERATION, 2)).toEqual({
        removed: 2,
        remaining: true,
      });
      // `remaining` reports any item at all, not just a compactable one.
      expect(await store().compactAcknowledged(OPERATION, 100)).toEqual({
        removed: 2,
        remaining: true,
      });
      expect(await store().compactAcknowledged(OPERATION, 100)).toEqual({
        removed: 0,
        remaining: true,
      });

      await store().acknowledgeLocal(OPERATION, everything.slice(4));
      expect(await store().compactAcknowledged(OPERATION, 100)).toEqual({
        removed: 1,
        remaining: false,
      });
      expect(await allItems()).toEqual([]);
    });

    it("ADP-workspace-060: markCompleted needs an empty manifest", async () => {
      await fixEverything();
      const everything = keysOf(await allItems());
      await expectConflict(store().markCompleted(OPERATION));

      await store().acknowledgeLocal(OPERATION, everything);
      await store().acknowledge(OPERATION, everything);
      // Items that are merely acknowledged still block completion.
      await expectConflict(store().markCompleted(OPERATION));

      await store().compactAcknowledged(OPERATION, 100);
      await store().markCompleted(OPERATION);
      await store().markCompleted(OPERATION);
    });

    it("ADP-workspace-052/055/060: an operation with no manifest is rejected everywhere", async () => {
      await expectConflict(
        store().appendMembershipPage("deletion-unknown", null, 100),
      );
      await expectConflict(store().listLocalPending("deletion-unknown", 100));
      await expectConflict(store().listItems("deletion-unknown", null, 100));
      await expectConflict(
        store().compactAcknowledged("deletion-unknown", 100),
      );
      await expectConflict(store().markReady("deletion-unknown"));
      await expectConflict(store().markCompleted("deletion-unknown"));
    });
  });
}
