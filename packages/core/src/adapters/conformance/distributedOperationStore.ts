import { beforeEach, describe, expect, it } from "vitest";
import type { DistributedOperationPayload } from "../../application/ports/distributedOperationStore";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { userId } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shared conformance suite for `DistributedOperationStore`: one running
 * operation per partition, replay by request key, a payload fixed at
 * creation, and terminal-row counting.
 */
export function describeDistributedOperationStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`DistributedOperationStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    const begin = (
      requestKey: string,
      payload: DistributedOperationPayload = { email: "a@example.com" },
      partitionKey: string = userId(1),
    ) =>
      backend.distributedOperationStore.beginOrResume({
        kind: "accountDeletion",
        partitionKey,
        requestKey,
        payload,
      });

    it("creates one operation and resumes it for the same request key", async () => {
      const created = await begin("request-1");
      expect(created.resumed).toBe(false);
      expect(created.operation.state).toBe("running");

      const replayed = await begin("request-1");
      expect(replayed.resumed).toBe(true);
      expect(replayed.operation.id).toBe(created.operation.id);
    });

    it("returns the running operation for a different request key", async () => {
      const created = await begin("request-1");

      const other = await begin("request-2");
      expect(other.resumed).toBe(true);
      expect(other.operation.id).toBe(created.operation.id);
      expect(other.operation.requestKey).toBe("request-1");
    });

    it("keeps the payload fixed at creation across resumes", async () => {
      const created = await begin("request-1", { email: "first@example.com" });

      const replayed = await begin("request-1", {
        email: "rewritten@example.com",
      });
      expect(replayed.operation.payload).toEqual(created.operation.payload);
      expect(
        (await begin("request-2", { email: "rewritten@example.com" })).operation
          .payload,
      ).toEqual({ email: "first@example.com" });
    });

    it("lets only a new request key start a new operation after a terminal one", async () => {
      const first = await begin("request-1");
      await backend.distributedOperationStore.markState(
        first.operation.id,
        "rejected",
        backend.clock.now(),
      );

      const replayed = await begin("request-1");
      expect(replayed.operation.id).toBe(first.operation.id);
      expect(replayed.operation.state).toBe("rejected");

      const second = await begin("request-2");
      expect(second.resumed).toBe(false);
      expect(second.operation.id).not.toBe(first.operation.id);
    });

    it("separates partitions", async () => {
      const mine = await begin("request-1", {}, userId(1));
      const theirs = await begin("request-1", {}, userId(2));
      expect(theirs.operation.id).not.toBe(mine.operation.id);
    });

    it("counts retained terminal rows of the partition since an instant", async () => {
      const older = await begin("request-1");
      await backend.distributedOperationStore.markState(
        older.operation.id,
        "rejected",
        backend.clock.now(),
      );
      backend.clock.advance(10 * DAY_MS);
      const since = backend.clock.now();
      backend.clock.advance(DAY_MS);
      const newer = await begin("request-2");
      await backend.distributedOperationStore.markState(
        newer.operation.id,
        "rejected",
        backend.clock.now(),
      );
      const running = await begin("request-3");

      expect(
        await backend.distributedOperationStore.countTerminalSince(
          "accountDeletion",
          userId(1),
          since,
        ),
      ).toBe(1);
      expect(
        await backend.distributedOperationStore.countTerminalSince(
          "accountDeletion",
          userId(1),
          new Date(0),
        ),
      ).toBe(2);
      expect(
        await backend.distributedOperationStore.countTerminalSince(
          "accountDeletion",
          userId(2),
          new Date(0),
        ),
      ).toBe(0);
      expect(running.operation.state).toBe("running");
    });

    it("reads an operation back by id and rejects an unknown one on markState", async () => {
      const created = await begin("request-1");

      const found = await backend.distributedOperationStore.findByOperationId(
        created.operation.id,
      );
      expect(found?.requestKey).toBe("request-1");
      expect(
        await backend.distributedOperationStore.findByOperationId("absent"),
      ).toBeNull();

      await expectConflict(
        backend.distributedOperationStore.markState(
          "absent",
          "completed",
          backend.clock.now(),
        ),
      );
    });

    it("deletes a terminal operation and refuses to delete a running one", async () => {
      const created = await begin("request-1");

      await expectConflict(
        backend.distributedOperationStore.deleteTerminal(created.operation.id),
      );

      await backend.distributedOperationStore.markState(
        created.operation.id,
        "completed",
        backend.clock.now(),
      );
      await backend.distributedOperationStore.deleteTerminal(
        created.operation.id,
      );
      expect(
        await backend.distributedOperationStore.findByOperationId(
          created.operation.id,
        ),
      ).toBeNull();
      // A pruned row is gone, so the prune retry is a no-op.
      await backend.distributedOperationStore.deleteTerminal(
        created.operation.id,
      );
    });
  });
}
