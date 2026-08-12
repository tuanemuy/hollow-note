import { beforeEach, describe, expect, it } from "vitest";
import type { AccountDeletionReceipt } from "../../application/ports/accountDeletionManifestStore";
import { WorkspaceId } from "../../domain/workspace/valueObject";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { noteId, userId } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The declaration this suite drives the backend with. It is a strict
 * subset of the receipt enum on purpose: finalize waits for what
 * the deployment declares, so a backend that hard-codes the full set
 * fails here.
 */
const FINALIZE_RECEIPTS: readonly AccountDeletionReceipt[] = [
  "personalCleanup",
  "authResidue",
  "uniquenessRelease",
];

const UNDECLARED_RECEIPT: AccountDeletionReceipt = "jobHistory";

/**
 * Shared conformance suite for `AccountDeletionManifestStore`
 * (ADP-common-012..025): header state machine, idempotent target fixing,
 * command-key claiming, and terminal retention.
 *
 * Membership-page content cases run only when the backend provides
 * `seedMembershipEdges`; the Workspace domain does not exist yet.
 */
export function describeAccountDeletionManifestStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`AccountDeletionManifestStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend({
        requiredFinalizeReceipts: FINALIZE_RECEIPTS,
      });
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

    it("ADP-common-012: a replayed begin preserves everything already recorded", async () => {
      await beginWithRoutes();
      await store().markBuilt("op-1");
      await finalizeAll();
      expect(await store().allRequiredAcknowledged("op-1")).toBe(true);

      // A lost response replays begin. An `INSERT OR REPLACE` style begin
      // would reopen the header as `building` and wipe the receipts and
      // cursors, so assert the recorded state directly.
      await store().begin("op-1", userId(1));

      await expectConflict(
        store().appendAuthorRoutePage(
          "op-1",
          [{ noteId: noteId(3), routeVersion: 1 }],
          null,
        ),
      );
      expect(await store().allRequiredAcknowledged("op-1")).toBe(true);
      const terminalAt = backend.clock.now();
      await store().markCompleted(
        "op-1",
        terminalAt,
        new Date(terminalAt.getTime() + 120 * DAY_MS),
      );
    });

    it("ADP-common-012: describe reports the header a continuation resumes from", async () => {
      expect(await store().describe("op-1")).toBeNull();

      await beginWithRoutes();
      const building = await store().describe("op-1");
      expect(building).toMatchObject({
        operationId: "op-1",
        userId: userId(1),
        status: "building",
        membershipCursor: null,
        authorRouteCursor: null,
        receipts: [],
        terminalAt: null,
        retainUntil: null,
      });

      await store().markBuilt("op-1");
      await finalizeAll();
      const built = await store().describe("op-1");
      expect(built?.status).toBe("built");
      expect(built?.receipts).toEqual(
        expect.arrayContaining([...FINALIZE_RECEIPTS]),
      );
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
      expect(claimed).toHaveLength(2);
      expect(new Set(claimed.map((item) => item.key)).size).toBe(2);
      expect(
        claimed
          .map((item) => (item.kind === "authorRoute" ? item.noteId : null))
          .sort(),
      ).toEqual([noteId(1), noteId(2)]);
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

      // A receipt nothing declares does not move finalize forward.
      await store().acknowledgeReceipt("op-1", UNDECLARED_RECEIPT);
      expect(await store().allRequiredAcknowledged("op-1")).toBe(false);

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
      expect(early.operationIds).toEqual([]);

      backend.clock.advance(120 * DAY_MS);
      const first = await store().pruneTerminal(backend.clock.now(), null, 1);
      expect(first.operationIds).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await store().pruneTerminal(
        backend.clock.now(),
        first.nextCursor,
        100,
      );
      // Naming what it reclaimed is the contract: the caller drops each
      // operation's control-plane row in the same transaction.
      expect([...first.operationIds, ...second.operationIds].sort()).toEqual([
        "op-1",
        "op-2",
      ]);
      expect(second.nextCursor).toBeNull();

      // The live manifest survives.
      await store().appendMembershipPage("op-live", null, 100);
    });

    it("ADP-common-017/022: claimPending and compactItems cap a page at 100 items (spec/domains/index.md 最大100件)", async () => {
      await store().begin("op-1", userId(1));
      await store().appendAuthorRoutePage(
        "op-1",
        Array.from({ length: 101 }, (_, i) => ({
          noteId: noteId(i + 1),
          routeVersion: 1,
        })),
        null,
      );
      await store().markBuilt("op-1");

      expect(
        await store().claimPending("op-1", "redaction", 1_000),
      ).toHaveLength(100);

      for (;;) {
        const pending = await store().claimPending("op-1", "redaction", 1_000);
        if (pending.length === 0) break;
        const keys = pending.map((item) => item.key);
        await store().acknowledge("op-1", keys, "localRedaction");
        await store().acknowledge("op-1", keys, "publicRedaction");
      }
      for (const receipt of FINALIZE_RECEIPTS) {
        await store().acknowledgeReceipt("op-1", receipt);
      }

      expect(await store().compactItems("op-1", 1_000)).toEqual({
        removed: 100,
        remaining: true,
      });
      expect(await store().compactItems("op-1", 1_000)).toEqual({
        removed: 1,
        remaining: false,
      });
    });

    it("ADP-common-025: pruneTerminal caps a page at 100 manifests (spec/domains/index.md 最大100件)", async () => {
      for (let i = 0; i < 101; i++) {
        const operationId = `op-${String(i).padStart(3, "0")}`;
        await store().begin(operationId, userId(1));
        await store().markBuilt(operationId);
        for (const receipt of FINALIZE_RECEIPTS) {
          await store().acknowledgeReceipt(operationId, receipt);
        }
        const terminalAt = backend.clock.now();
        await store().markCompleted(
          operationId,
          terminalAt,
          new Date(terminalAt.getTime() + 120 * DAY_MS),
        );
      }
      backend.clock.advance(120 * DAY_MS);

      const first = await store().pruneTerminal(
        backend.clock.now(),
        null,
        1_000,
      );
      expect(first.operationIds).toHaveLength(100);
      expect(first.nextCursor).not.toBeNull();
      const second = await store().pruneTerminal(
        backend.clock.now(),
        first.nextCursor,
        1_000,
      );
      expect(second).toEqual({ operationIds: ["op-100"], nextCursor: null });
    });

    it("ADP-common-013: appendMembershipPage caps a page at 100 edges (seeded backend)", async (ctx) => {
      const seed = backend.seedMembershipEdges;
      if (seed === undefined) {
        ctx.skip();
        return;
      }
      await seed.call(
        backend,
        userId(1),
        Array.from({ length: 101 }, (_, i) => ({
          edgeKey: `edge-${String(i).padStart(3, "0")}`,
          workspaceId: WorkspaceId.create(`ws-${i}`),
          edgeState: "active" as const,
          membershipId: `membership-${i}`,
        })),
      );
      await store().begin("op-1", userId(1));

      const first = await store().appendMembershipPage("op-1", null, 1_000);
      expect(first.count).toBe(100);
      expect(first.nextCursor).toBe("edge-099");
      const second = await store().appendMembershipPage(
        "op-1",
        first.nextCursor,
        1_000,
      );
      expect(second).toEqual({ count: 1, nextCursor: null });
    });

    it("ADP-common-013/017/020: membership pages fix edges and drive prepare/release (seeded backend)", async (ctx) => {
      const seed = backend.seedMembershipEdges;
      if (seed === undefined) {
        // Report as skipped, not passed: a backend that cannot seed
        // membership edges has not verified this contract.
        ctx.skip();
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

    it("ADP-common-017/019/021: the cleanup lane is what finalizes membership items (seeded backend)", async (ctx) => {
      const seed = backend.seedMembershipEdges;
      if (seed === undefined) {
        ctx.skip();
        return;
      }
      await seed.call(backend, userId(1), [
        {
          edgeKey: "edge-a",
          workspaceId: WorkspaceId.create("ws-1"),
          edgeState: "active",
          membershipId: "membership-1",
        },
      ]);
      await store().begin("op-1", userId(1));
      await store().appendMembershipPage("op-1", null, 100);
      await store().markBuilt("op-1");

      const prepared = await store().claimPending("op-1", "prepare", 100);
      expect(
        prepared.map((item) =>
          item.kind === "membership" ? item.membershipId : null,
        ),
      ).toEqual(["membership-1"]);
      await store().acknowledge(
        "op-1",
        prepared.map((item) => item.key),
        "prepare",
      );
      expect(await store().claimPending("op-1", "prepare", 100)).toEqual([]);

      for (const receipt of FINALIZE_RECEIPTS) {
        await store().acknowledgeReceipt("op-1", receipt);
      }
      // Prepare ack plus every receipt is still not enough: a membership
      // item is only fully acked once the cleanup lane has run.
      expect(await store().allRequiredAcknowledged("op-1")).toBe(false);

      const cleanup = await store().claimPending("op-1", "cleanup", 100);
      // The very item the prepare lane acked is what the cleanup lane
      // sees, whatever the backend encodes its key as.
      expect(cleanup.map((item) => item.key)).toEqual(
        prepared.map((item) => item.key),
      );
      await store().acknowledge(
        "op-1",
        cleanup.map((item) => item.key),
        "cleanup",
      );
      expect(await store().claimPending("op-1", "cleanup", 100)).toEqual([]);

      expect(await store().allRequiredAcknowledged("op-1")).toBe(true);
      const terminalAt = backend.clock.now();
      await store().markCompleted(
        "op-1",
        terminalAt,
        new Date(terminalAt.getTime() + 120 * DAY_MS),
      );
      expect(await store().compactItems("op-1", 100)).toEqual({
        removed: 1,
        remaining: false,
      });
    });
  });
}
