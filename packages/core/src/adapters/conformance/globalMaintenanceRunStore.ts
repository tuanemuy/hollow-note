import { beforeEach, describe, expect, it } from "vitest";
import type {
  GlobalMaintenanceRunStore,
  MaintenanceLane,
} from "../../application/ports/globalMaintenanceRunStore";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";

/**
 * The key a caller re-derives for a lane position when it checkpoints
 * (`application/identity/pruneExpiredAuthState.ts`). A store must mint the
 * same string for the same position, or the Queue outbox sees one logical
 * command under two keys.
 */
const commandKeyOf = (runId: string, lane: MaintenanceLane): string =>
  `${runId}:${lane.generation}:${lane.shardId}:${lane.table}:${lane.cursor ?? ""}`;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 10 * MINUTE_MS;

/**
 * Shared conformance suite for `GlobalMaintenanceRunStore`
 * (ADP-common-026..031): single running run per kind with resume-at-the-
 * original-asOf, lane claim / checkpoint / advance atomicity under a
 * 10-minute lease, and completed-run retention.
 *
 * The suite pins the lane topology: one generation ("g1"), two shards
 * ("s1", "s2"), two sweep tables ("t1", "t2") for `authStatePrune`.
 */
export function describeGlobalMaintenanceRunStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`GlobalMaintenanceRunStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let store: GlobalMaintenanceRunStore;

    beforeEach(async () => {
      backend = await makeBackend({
        maintenanceShardIds: ["s1", "s2"],
        maintenanceTablesByKind: { authStatePrune: ["t1", "t2"] },
      });
      store = backend.globalMaintenanceRunStore;
    });

    const begin = (
      candidateRunId: string,
      leaseOwner: string,
      candidateAsOf = backend.clock.now(),
    ) =>
      store.beginOrResumeKind({
        candidateRunId,
        kind: "authStatePrune",
        candidateAsOf,
        generations: ["g1"],
        leaseOwner,
        leaseUntil: new Date(backend.clock.now().getTime() + LEASE_MS),
      });

    const completeLane = async (
      runId: string,
      leaseOwner: string,
      generation: string,
      shardId: string,
    ): Promise<
      Awaited<ReturnType<GlobalMaintenanceRunStore["advanceOrAck"]>>
    > => {
      // Two tables per shard: advance past t1, then ack t2.
      await store.advanceOrAck({
        runId,
        leaseOwner,
        generation,
        shardId,
        completed: true,
      });
      return store.advanceOrAck({
        runId,
        leaseOwner,
        generation,
        shardId,
        completed: true,
      });
    };

    it("ADP-common-026: starts a run, resumes it with the original asOf, reports live foreign leases", async () => {
      const originalAsOf = backend.clock.now();
      const started = await begin("run-1", "owner-a", originalAsOf);
      expect(started).toEqual({
        runId: "run-1",
        asOf: originalAsOf,
        result: "started",
      });

      // A live foreign lease blocks a second worker.
      const blocked = await begin("run-2", "owner-b");
      expect(blocked.result).toBe("leased");
      expect(blocked.runId).toBe("run-1");

      // After the lease lapses the next cron resumes the same run —
      // original (oldest) asOf, not the new candidate's.
      backend.clock.advance(LEASE_MS + 1);
      const resumed = await begin("run-3", "owner-b", backend.clock.now());
      expect(resumed).toEqual({
        runId: "run-1",
        asOf: originalAsOf,
        result: "resumed",
      });
    });

    it("ADP-common-027: claimLanes hands out pending lanes with their sweep table and command key", async () => {
      await begin("run-1", "owner-a");
      const lanes = await store.claimLanes("run-1", "owner-a", 6);
      expect(lanes).toHaveLength(2);
      expect(lanes.map((lane) => lane.shardId).sort()).toEqual(["s1", "s2"]);
      for (const lane of lanes) {
        expect(lane.generation).toBe("g1");
        expect(lane.table).toBe("t1");
        expect(lane.cursor).toBeNull();
        expect(lane.commandKey.length).toBeGreaterThan(0);
      }
      // Already-claimed lanes are not handed out twice.
      expect(await store.claimLanes("run-1", "owner-a", 6)).toHaveLength(0);
    });

    it("ADP-common-027: a lane's commandKey matches the key its position re-derives", async () => {
      await begin("run-1", "owner-a");
      const lanes = await store.claimLanes("run-1", "owner-a", 6);
      expect(lanes).toHaveLength(2);
      for (const lane of lanes) {
        expect(lane.commandKey).toBe(commandKeyOf("run-1", lane));
      }

      const [first] = lanes;
      if (first === undefined) {
        throw new Error("expected a claimed lane");
      }
      // Advancing to the next table re-mints the key at the new position.
      await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: first.generation,
        shardId: first.shardId,
        completed: true,
      });
      await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: first.generation,
        shardId: first.shardId,
        completed: false,
      });
      const advanced = (await store.claimLanes("run-1", "owner-a", 6)).find(
        (lane) => lane.shardId === first.shardId,
      );
      if (advanced === undefined) {
        throw new Error("expected the advanced lane back");
      }
      expect(advanced.table).toBe("t2");
      expect(advanced.commandKey).toBe(commandKeyOf("run-1", advanced));
    });

    it("ADP-common-027: only the lease owner may claim", async () => {
      await begin("run-1", "owner-a");
      await expectConflict(store.claimLanes("run-1", "owner-b", 6));
    });

    it("ADP-common-028: checkpointLane persists the keyset cursor for the lane's current table", async () => {
      await begin("run-1", "owner-a");
      const [lane] = await store.claimLanes("run-1", "owner-a", 1);
      if (lane === undefined) {
        throw new Error("expected a claimed lane");
      }
      await store.checkpointLane({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        table: "t1",
        cursor: "cursor-100",
        asOf: lane.asOf,
        nextCommandKey: "command-2",
      });

      // A mismatched table is a state violation.
      await expectConflict(
        store.checkpointLane({
          runId: "run-1",
          leaseOwner: "owner-a",
          generation: lane.generation,
          shardId: lane.shardId,
          table: "t2",
          cursor: "cursor-1",
          asOf: lane.asOf,
          nextCommandKey: "command-3",
        }),
      );

      // A released lane resumes from the checkpointed cursor.
      await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: false,
      });
      const reclaimed = await store.claimLanes("run-1", "owner-a", 6);
      const resumedLane = reclaimed.find(
        (candidate) => candidate.shardId === lane.shardId,
      );
      expect(resumedLane?.cursor).toBe("cursor-100");
      expect(resumedLane?.commandKey).toBe("command-2");
    });

    it("ADP-common-029: advanceOrAck walks tables, then shards, then completes the run", async () => {
      await begin("run-1", "owner-a");
      const [lane] = await store.claimLanes("run-1", "owner-a", 1);
      if (lane === undefined) {
        throw new Error("expected a claimed lane");
      }

      const afterTable = await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: true,
      });
      expect(afterTable).toEqual({
        next: { generation: lane.generation, shardId: lane.shardId },
        runCompleted: false,
      });

      // Shard done → the other shard is claimed atomically.
      const afterShard = await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: true,
      });
      expect(afterShard.runCompleted).toBe(false);
      expect(afterShard.next).not.toBeNull();
      expect(afterShard.next?.shardId).not.toBe(lane.shardId);

      const secondShard = afterShard.next;
      if (secondShard === null) {
        throw new Error("expected a next shard");
      }
      const finished = await completeLane(
        "run-1",
        "owner-a",
        secondShard.generation,
        secondShard.shardId,
      );
      expect(finished).toEqual({ next: null, runCompleted: true });

      // Only after completion does a candidate run start fresh.
      const fresh = await begin("run-2", "owner-a");
      expect(fresh.result).toBe("started");
      expect(fresh.runId).toBe("run-2");
    });

    it("ADP-common-030: recoverLease reclaims only a lapsed foreign lease", async () => {
      await begin("run-1", "owner-a");
      expect(
        await store.recoverLease(
          "run-1",
          "owner-b",
          new Date(backend.clock.now().getTime() + LEASE_MS),
        ),
      ).toBe(false);

      backend.clock.advance(LEASE_MS + 1);
      expect(
        await store.recoverLease(
          "run-1",
          "owner-b",
          new Date(backend.clock.now().getTime() + LEASE_MS),
        ),
      ).toBe(true);
      // The previous owner lost the lease.
      await expectConflict(store.claimLanes("run-1", "owner-a", 6));
      expect(await store.claimLanes("run-1", "owner-b", 6)).toHaveLength(2);
    });

    it("ADP-common-030: a lapsed lease returns the previous owner's claimed lanes to the claimable pool", async () => {
      await begin("run-1", "owner-a");
      const [first] = await store.claimLanes("run-1", "owner-a", 6);
      if (first === undefined) {
        throw new Error("expected a claimed lane");
      }
      await store.checkpointLane({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: first.generation,
        shardId: first.shardId,
        table: first.table,
        cursor: "cursor-42",
        asOf: first.asOf,
        nextCommandKey: "command-2",
      });

      // While the lease is live the lanes stay with their owner, even for
      // that same owner's next invocation.
      expect((await begin("run-2", "owner-a")).result).toBe("resumed");
      expect(await store.claimLanes("run-1", "owner-a", 6)).toHaveLength(0);

      // owner-a is gone (crash / invocation timeout) and its lease lapses:
      // the lanes must become claimable again, or the run can never
      // complete.
      backend.clock.advance(LEASE_MS + 1);
      expect((await begin("run-3", "owner-b")).result).toBe("resumed");
      const reclaimed = await store.claimLanes("run-1", "owner-b", 6);
      expect(reclaimed.map((lane) => lane.shardId).sort()).toEqual([
        "s1",
        "s2",
      ]);
      // The reclaimed lane resumes from the checkpointed keyset.
      const resumedLane = reclaimed.find(
        (lane) => lane.shardId === first.shardId,
      );
      expect(resumedLane?.cursor).toBe("cursor-42");
      expect(resumedLane?.table).toBe(first.table);
    });

    it("ADP-common-030: recoverLease also returns the lapsed owner's claimed lanes", async () => {
      await begin("run-1", "owner-a");
      expect(await store.claimLanes("run-1", "owner-a", 6)).toHaveLength(2);

      backend.clock.advance(LEASE_MS + 1);
      expect(
        await store.recoverLease(
          "run-1",
          "owner-b",
          new Date(backend.clock.now().getTime() + LEASE_MS),
        ),
      ).toBe(true);
      expect(await store.claimLanes("run-1", "owner-b", 6)).toHaveLength(2);
    });

    it("ADP-common-031: pruneCompleted reclaims runs after the 30-day retention, by keyset", async () => {
      await begin("run-1", "owner-a");
      const lanes = await store.claimLanes("run-1", "owner-a", 6);
      for (const lane of lanes) {
        // Each shard was claimed up front, so `next` never re-claims here.
        await completeLane("run-1", "owner-a", lane.generation, lane.shardId);
      }

      const early = await store.pruneCompleted(backend.clock.now(), null, 100);
      expect(early.removed).toBe(0);

      backend.clock.advance(30 * DAY_MS);
      const swept = await store.pruneCompleted(backend.clock.now(), null, 100);
      expect(swept.removed).toBe(1);
      expect(swept.nextCursor).toBeNull();
    });

    it("ADP-common-031: pruneCompleted caps a page at 100 runs (spec/domains/index.md 最大100件)", async () => {
      for (let i = 0; i < 101; i++) {
        const runId = `run-${String(i).padStart(3, "0")}`;
        await begin(runId, "owner-a");
        for (const lane of await store.claimLanes(runId, "owner-a", 6)) {
          await completeLane(runId, "owner-a", lane.generation, lane.shardId);
        }
      }

      backend.clock.advance(30 * DAY_MS);
      const first = await store.pruneCompleted(
        backend.clock.now(),
        null,
        1_000,
      );
      expect(first.removed).toBe(100);
      expect(first.nextCursor).not.toBeNull();
      const second = await store.pruneCompleted(
        backend.clock.now(),
        first.nextCursor,
        1_000,
      );
      expect(second).toEqual({ removed: 1, nextCursor: null });
    });
  });
}
