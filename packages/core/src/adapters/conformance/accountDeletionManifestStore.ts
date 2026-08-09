import { beforeEach, describe, expect, it } from "vitest";
import type { AccountDeletionReceipt } from "../../application/ports/accountDeletionManifestStore";
import { WorkspaceId } from "../../domain/workspace/valueObject";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { noteId, userId } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

const FINALIZE_RECEIPTS: readonly AccountDeletionReceipt[] = [
  "personalCleanup",
  "authResidue",
  "externalConnections",
  "jobHistory",
  "uniquenessRelease",
];

/**
 * Shared conformance suite for `AccountDeletionManifestStore`
 * (ADP-common-012..025): header state machine, idempotent target fixing,
 * command-key claiming, and terminal retention.
 *
 * Membership-page content cases run only when the backend provides
 * `seedMembershipEdges` (the Workspace domain arrives in slice #3).
 */
export function describeAccountDeletionManifestStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`AccountDeletionManifestStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    const store = () => backend.accountDeletionManifestStore;

    const beginWithRoutes = async (operationId = "op-1"): Promise<void> => {
      await store().begin(operationId, userId(1));
      await store().appendAuthorRoutePage(
        operationId,
        [
          { noteId: noteId(1), routeVersion: 1 },
          { noteId: noteId(2), routeVersion: 1 },
        ],
        null,
      );
    };

    const finalizeAll = async (operationId = "op-1"): Promise<void> => {
      const pending = await store().claimPending(operationId, "redaction", 100);
      const keys = pending.map((item) => item.key);
      await store().acknowledge(operationId, keys, "localRedaction");
      await store().acknowledge(operationId, keys, "publicRedaction");
      for (const receipt of FINALIZE_RECEIPTS) {
        await store().acknowledgeReceipt(operationId, receipt);
      }
    };

    it("ADP-common-012: begin is idempotent", async () => {
      await store().begin("op-1", userId(1));
      await store().begin("op-1", userId(1));
      expect(await store().allRollbackReleased("op-1")).toBe(true);
    });

    it("ADP-common-013: appendMembershipPage on an empty edge source fixes zero targets", async () => {
      await store().begin("op-1", userId(1));
      expect(await store().appendMembershipPage("op-1", null, 100)).toEqual({
        count: 0,
        nextCursor: null,
      });
    });

    it("ADP-common-014: appendAuthorRoutePage is an idempotent append", async () => {
      await beginWithRoutes();
      // A lost response replays the same page without duplicating items.
      await store().appendAuthorRoutePage(
        "op-1",
        [{ noteId: noteId(2), routeVersion: 1 }],
        null,
      );
      await store().markBuilt("op-1");
      const claimed = await store().claimPending("op-1", "redaction", 100);
      expect(claimed.map((item) => item.key).sort()).toEqual([
        "authorRoute:note-001",
        "authorRoute:note-002",
      ]);
    });

    it("ADP-common-015: target fixing is rejected after markBuilt", async () => {
      await beginWithRoutes();
      await store().markBuilt("op-1");
      await store().markBuilt("op-1");
      await expectConflict(
        store().appendAuthorRoutePage(
          "op-1",
          [{ noteId: noteId(3), routeVersion: 1 }],
          null,
        ),
      );
      await expectConflict(store().appendMembershipPage("op-1", null, 100));
    });

    it("ADP-common-017/018: redaction items are claimable until both acks land", async () => {
      await beginWithRoutes();
      await store().markBuilt("op-1");

      const first = await store().claimPending("op-1", "redaction", 1);
      expect(first).toHaveLength(1);

      const all = await store().claimPending("op-1", "redaction", 100);
      expect(all).toHaveLength(2);

      await store().acknowledge(
        "op-1",
        all.map((item) => item.key),
        "localRedaction",
      );
      expect(await store().claimPending("op-1", "redaction", 100)).toHaveLength(
        2,
      );

      await store().acknowledge(
        "op-1",
        all.map((item) => item.key),
        "publicRedaction",
      );
      expect(await store().claimPending("op-1", "redaction", 100)).toHaveLength(
        0,
      );
      // Duplicate acks are safe no-ops.
      await store().acknowledge(
        "op-1",
        all.map((item) => item.key),
        "publicRedaction",
      );
    });

    it("ADP-common-019/021/023: finalize requires item acks plus the receipt set", async () => {
      await beginWithRoutes();
      await store().markBuilt("op-1");
      const terminalAt = backend.clock.now();
      const retainUntil = new Date(terminalAt.getTime() + 120 * DAY_MS);

      expect(await store().allRequiredAcknowledged("op-1")).toBe(false);
      await expectConflict(
        store().markCompleted("op-1", terminalAt, retainUntil),
      );

      await finalizeAll();
      expect(await store().allRequiredAcknowledged("op-1")).toBe(true);
      await store().markCompleted("op-1", terminalAt, retainUntil);
      await store().markCompleted("op-1", terminalAt, retainUntil);
    });

    it("ADP-common-016/020/024: rollback releases and rejects through the release path", async () => {
      await beginWithRoutes();
      await store().markBuilt("op-1");
      await store().beginRollback("op-1");
      await store().beginRollback("op-1");

      // Nothing was prepare-dispatched, so the rollback is trivially released.
      expect(await store().allRollbackReleased("op-1")).toBe(true);
      const terminalAt = backend.clock.now();
      await store().markRejected(
        "op-1",
        terminalAt,
        new Date(terminalAt.getTime() + 120 * DAY_MS),
      );
      await expectConflict(store().markBuilt("op-1"));
    });

    it("ADP-common-022: compaction requires the path's acks and reports remaining work", async () => {
      await beginWithRoutes();
      await store().markBuilt("op-1");

      await expectConflict(store().compactItems("op-1", 100));

      await finalizeAll();
      const first = await store().compactItems("op-1", 1);
      expect(first).toEqual({ removed: 1, remaining: true });
      const second = await store().compactItems("op-1", 100);
      expect(second).toEqual({ removed: 1, remaining: false });
    });

    it("ADP-common-025: pruneTerminal reclaims terminal manifests after retention, by keyset", async () => {
      for (const operationId of ["op-1", "op-2"]) {
        await beginWithRoutes(operationId);
        await store().markBuilt(operationId);
        await finalizeAll(operationId);
        const terminalAt = backend.clock.now();
        await store().markCompleted(
          operationId,
          terminalAt,
          new Date(terminalAt.getTime() + 120 * DAY_MS),
        );
      }
      await store().begin("op-live", userId(2));

      const early = await store().pruneTerminal(backend.clock.now(), null, 100);
      expect(early.removed).toBe(0);

      backend.clock.advance(120 * DAY_MS);
      const first = await store().pruneTerminal(backend.clock.now(), null, 1);
      expect(first.removed).toBe(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await store().pruneTerminal(
        backend.clock.now(),
        first.nextCursor,
        100,
      );
      expect(second.removed).toBe(1);
      expect(second.nextCursor).toBeNull();

      // The live manifest survives.
      await store().appendMembershipPage("op-live", null, 100);
    });

    it("ADP-common-013/017/020: membership pages fix edges and drive prepare/release (seeded backend)", async () => {
      const seed = backend.seedMembershipEdges;
      if (seed === undefined) {
        return;
      }
      await seed.call(backend, userId(1), [
        {
          edgeKey: "edge-a",
          workspaceId: WorkspaceId.create("ws-1"),
          edgeState: "active",
          membershipId: "membership-1",
        },
        {
          edgeKey: "edge-b",
          workspaceId: WorkspaceId.create("ws-2"),
          edgeState: "pending",
          membershipId: null,
        },
      ]);
      await store().begin("op-1", userId(1));

      const firstPage = await store().appendMembershipPage("op-1", null, 1);
      expect(firstPage.count).toBe(1);
      expect(firstPage.nextCursor).toBe("edge-a");
      const secondPage = await store().appendMembershipPage(
        "op-1",
        firstPage.nextCursor,
        100,
      );
      expect(secondPage).toEqual({ count: 1, nextCursor: null });

      await store().markBuilt("op-1");
      const prepared = await store().claimPending("op-1", "prepare", 100);
      expect(prepared).toHaveLength(2);
      for (const item of prepared) {
        if (item.kind !== "membership") {
          throw new Error("expected membership items");
        }
        expect(item.prepareCommandKey).not.toBeNull();
        expect(item.prepareDispatchedAt).not.toBeNull();
      }
      // Claiming again reuses the same deterministic command keys.
      const reclaimed = await store().claimPending("op-1", "prepare", 100);
      expect(
        reclaimed.map((item) =>
          item.kind === "membership" ? item.prepareCommandKey : null,
        ),
      ).toEqual(
        prepared.map((item) =>
          item.kind === "membership" ? item.prepareCommandKey : null,
        ),
      );

      await store().beginRollback("op-1");
      expect(await store().allRollbackReleased("op-1")).toBe(false);

      // Everything prepare-dispatched (acked or not) must be released.
      const releases = await store().claimPending("op-1", "release", 100);
      expect(releases).toHaveLength(2);
      await store().acknowledge(
        "op-1",
        releases.map((item) => item.key),
        "release",
      );
      expect(await store().allRollbackReleased("op-1")).toBe(true);
    });
  });
}
