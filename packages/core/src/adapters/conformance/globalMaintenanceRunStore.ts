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
 *
 * It also pins where an ack's position comes from: `advanceOrAck` hands
 * back the position it advanced to, and the side that *created* that
 * position is the side that minted its command key — the store when it
 * creates a position (the run's starting one, or a lane's next table;
 * keys the caller re-derives byte-identically), the caller when it
 * checkpointed the lane an ack later auto-claims (returned as stored,
 * never re-minted). Neither a release nor an ack with no pending lane
 * left returns a position at all.
 *
 * Contract 1 — the run's snapshot, not the deployment's configuration,
 * is the walk-order authority — is pinned by replacing the table set
 * under a live run through `setMaintenanceTables` and then resuming that
 * run, so both halves of the contract (the walk and the resume) have an
 * executable form. The same case then completes that run and starts the
 * next one on the replaced set: without that half, a backend whose
 * `setMaintenanceTables` does nothing would pass having never put a
 * deploy in front of the run it claims to ignore.
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

    it("ADP-common-027: claimLanes hands out pending lanes with their sweep table, command key and the run's asOf", async () => {
      const started = await begin("run-1", "owner-a");
      // Move the wall clock off the run's boundary, well inside the
      // lease, so a store that stamps `now()` onto a claimed lane is
      // distinguishable from one that reads the run row back.
      backend.clock.advance(MINUTE_MS);
      const lanes = await store.claimLanes("run-1", "owner-a", 6);
      expect(lanes).toHaveLength(2);
      expect(lanes.map((lane) => lane.shardId).sort()).toEqual(["s1", "s2"]);
      for (const lane of lanes) {
        expect(lane.generation).toBe("g1");
        expect(lane.table).toBe("t1");
        expect(lane.cursor).toBeNull();
        expect(lane.commandKey.length).toBeGreaterThan(0);
        expect(lane.asOf).toEqual(started.asOf);
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

      // A released lane resumes from the checkpointed cursor. What a
      // release hands back is contract 2, pinned under ADP-common-029.
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
      const started = await begin("run-1", "owner-a");
      // Move the wall clock off the run's asOf, well inside the lease, so
      // the asOf assertions below have something to fail against: without
      // this every clock read equals the run's boundary and a store that
      // stamps `now()` onto a lane is indistinguishable from one that
      // reads the run row back.
      backend.clock.advance(MINUTE_MS);
      // Every checkpoint below passes an `asOf` off the run's boundary:
      // it is an input the store records a page under, never a way to
      // move the run's own boundary, so the lanes handed back further
      // down must still carry `started.asOf`.
      const offBoundary = new Date(started.asOf.getTime() + MINUTE_MS);
      const [lane] = await store.claimLanes("run-1", "owner-a", 1);
      if (lane === undefined) {
        throw new Error("expected a claimed lane");
      }

      // Stage the other shard at a persisted position — checkpointed
      // under a command key the caller's rule would never mint, then
      // released — so the auto-claim below has something to hand back.
      const [staged] = await store.claimLanes("run-1", "owner-a", 1);
      if (staged === undefined) {
        throw new Error("expected the second shard");
      }
      await store.checkpointLane({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: staged.generation,
        shardId: staged.shardId,
        table: "t1",
        cursor: "cursor-77",
        asOf: offBoundary,
        nextCommandKey: "command-off-rule",
      });
      await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: staged.generation,
        shardId: staged.shardId,
        completed: false,
      });

      // Leave t1 mid-keyset before acking it, so "a new table starts at
      // the head" is asserted against a lane that actually carries a
      // cursor — a store that dragged the old one along would otherwise
      // look identical.
      await store.checkpointLane({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        table: "t1",
        cursor: "cursor-9",
        asOf: offBoundary,
        nextCommandKey: "command-t1-page-2",
      });

      const afterTable = await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: true,
      });
      expect(afterTable.runCompleted).toBe(false);
      const nextTable = afterTable.next;
      if (nextTable === null) {
        throw new Error("expected the lane's next table");
      }
      // A position the store just created: same lane, next table, head of
      // the keyset, under the key the caller re-derives for it.
      expect(nextTable.generation).toBe(lane.generation);
      expect(nextTable.shardId).toBe(lane.shardId);
      expect(nextTable.table).toBe("t2");
      expect(nextTable.cursor).toBeNull();
      expect(nextTable.asOf).toEqual(started.asOf);
      expect(nextTable.commandKey).toBe(commandKeyOf("run-1", nextTable));

      // Shard done → the other shard is claimed atomically, at the
      // position it was released with and under the key it was stored
      // with.
      const afterShard = await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: true,
      });
      expect(afterShard.runCompleted).toBe(false);
      const secondShard = afterShard.next;
      if (secondShard === null) {
        throw new Error("expected a next shard");
      }
      expect(secondShard.generation).toBe(lane.generation);
      expect(secondShard.shardId).not.toBe(lane.shardId);
      expect(secondShard.table).toBe("t1");
      expect(secondShard.cursor).toBe("cursor-77");
      expect(secondShard.commandKey).toBe("command-off-rule");
      // The run's asOf, read back from the run row — not the wall clock
      // at auto-claim time, which has moved on. A lane carrying a
      // different boundary would sweep a different keyset than the run it
      // belongs to.
      expect(secondShard.asOf).toEqual(started.asOf);
      // It came back claimed, so nothing is left to hand out.
      expect(await store.claimLanes("run-1", "owner-a", 6)).toHaveLength(0);

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

    it("ADP-common-029: the position an ack returns is still claimed", async () => {
      await begin("run-1", "owner-a");
      const [lane] = await store.claimLanes("run-1", "owner-a", 1);
      if (lane === undefined) {
        throw new Error("expected a claimed lane");
      }
      await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: true,
      });
      // The advanced lane stays with the caller that was handed it: a
      // claim can only pick up the shard nobody is driving.
      const claimable = await store.claimLanes("run-1", "owner-a", 6);
      expect(claimable.map((candidate) => candidate.shardId)).not.toContain(
        lane.shardId,
      );
    });

    it("ADP-common-029: acking a lane's last table auto-claims a lane never claimed before, at the head of its first table", async () => {
      const started = await begin("run-1", "owner-a");
      backend.clock.advance(MINUTE_MS);
      const [lane] = await store.claimLanes("run-1", "owner-a", 1);
      if (lane === undefined) {
        throw new Error("expected a claimed lane");
      }

      // The other shard is still exactly as the run created it — no
      // checkpoint, no release. This is what an auto-claim hands back in
      // most of a real run, so the position it carries must be the run's
      // own starting one.
      const advanced = await completeLane(
        "run-1",
        "owner-a",
        lane.generation,
        lane.shardId,
      );
      expect(advanced.runCompleted).toBe(false);
      const virgin = advanced.next;
      if (virgin === null) {
        throw new Error("expected the untouched shard");
      }
      expect(virgin.shardId).not.toBe(lane.shardId);
      expect(virgin.table).toBe("t1");
      expect(virgin.cursor).toBeNull();
      expect(virgin.asOf).toEqual(started.asOf);
      expect(virgin.commandKey).toBe(commandKeyOf("run-1", virgin));
      expect(await store.claimLanes("run-1", "owner-a", 6)).toHaveLength(0);
    });

    it("ADP-common-029: acking a lane's last table auto-claims a released lane at the table it reached, not the run's first", async () => {
      const started = await begin("run-1", "owner-a");
      backend.clock.advance(MINUTE_MS);
      const [lane] = await store.claimLanes("run-1", "owner-a", 1);
      const [staged] = await store.claimLanes("run-1", "owner-a", 1);
      if (lane === undefined || staged === undefined) {
        throw new Error("expected both shards");
      }

      // Walk the other shard off the run's first table before releasing
      // it: stepped to t2, checkpointed there under a command key the
      // caller's rule would never mint, then handed back. A store that
      // carried only the cursor across a release — restarting the lane at
      // the run's first table with t2's cursor — would sweep t1 from the
      // middle of a keyset that is not t1's and silently skip its head.
      await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: staged.generation,
        shardId: staged.shardId,
        completed: true,
      });
      await store.checkpointLane({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: staged.generation,
        shardId: staged.shardId,
        table: "t2",
        cursor: "cursor-77",
        asOf: started.asOf,
        nextCommandKey: "command-off-rule",
      });
      await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: staged.generation,
        shardId: staged.shardId,
        completed: false,
      });

      const advanced = await completeLane(
        "run-1",
        "owner-a",
        lane.generation,
        lane.shardId,
      );
      expect(advanced.runCompleted).toBe(false);
      const resumed = advanced.next;
      if (resumed === null) {
        throw new Error("expected the released shard");
      }
      expect(resumed.shardId).toBe(staged.shardId);
      expect(resumed.table).toBe("t2");
      expect(resumed.cursor).toBe("cursor-77");
      expect(resumed.commandKey).toBe("command-off-rule");
      expect(resumed.asOf).toEqual(started.asOf);
      expect(await store.claimLanes("run-1", "owner-a", 6)).toHaveLength(0);
    });

    it("ADP-common-029: an ack with no pending lane to hand over returns no position and leaves the run running", async () => {
      await begin("run-1", "owner-a");
      const lanes = await store.claimLanes("run-1", "owner-a", 6);
      expect(lanes).toHaveLength(2);
      const [first] = lanes;
      if (first === undefined) {
        throw new Error("expected a claimed lane");
      }

      // Both shards are claimed, so finishing one has nothing to hand
      // back — the everyday case in a cron that claims its lanes up
      // front. `runCompleted` is false because the other lane is still
      // claimed, not done: a store that reads "no pending lanes" as
      // "run finished" would strand it.
      const acked = await completeLane(
        "run-1",
        "owner-a",
        first.generation,
        first.shardId,
      );
      expect(acked).toEqual({ next: null, runCompleted: false });
    });

    it("ADP-common-029: a release hands back no position even while another lane is pending", async () => {
      await begin("run-1", "owner-a");
      const [lane] = await store.claimLanes("run-1", "owner-a", 1);
      if (lane === undefined) {
        throw new Error("expected a claimed lane");
      }

      // The other shard is pending and the release frees capacity, but a
      // release must still claim nothing: every call site drops this
      // return value, so a lane handed back here would stay claimed with
      // nobody driving it until the lease lapses.
      const released = await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: false,
      });
      expect(released).toEqual({ next: null, runCompleted: false });
      expect(await store.claimLanes("run-1", "owner-a", 6)).toHaveLength(2);
    });

    it("ADP-common-029: an ack walks the table set the run was created with, not the deployment's current one, across a resume", async () => {
      await begin("run-1", "owner-a");
      const [lane] = await store.claimLanes("run-1", "owner-a", 1);
      if (lane === undefined) {
        throw new Error("expected a claimed lane");
      }

      // A deploy re-orders and renames the sweep tables mid-run. The run
      // snapshotted its set at creation, so the walk must ignore this.
      await backend.setMaintenanceTables("authStatePrune", ["t9", "t8", "t7"]);

      // The next cron picks the run up again under the new configuration.
      // Resuming must not re-take the snapshot: a store that re-reads the
      // deployment's set here walks the lane onto a table the run never
      // started on, and its cursor points into another table's keyset.
      // The lease is still this owner's, so the claim above survives.
      const resumed = await begin("run-2", "owner-a");
      expect(resumed.runId).toBe("run-1");
      expect(resumed.result).toBe("resumed");

      const afterTable = await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: true,
      });
      const nextTable = afterTable.next;
      if (nextTable === null) {
        throw new Error("expected the lane's next table");
      }
      expect(nextTable.table).toBe("t2");
      expect(nextTable.commandKey).toBe(commandKeyOf("run-1", nextTable));

      // The old set also decides where the lane ends: two tables, then
      // the shard is done and the untouched shard comes back at "t1".
      const afterShard = await store.advanceOrAck({
        runId: "run-1",
        leaseOwner: "owner-a",
        generation: lane.generation,
        shardId: lane.shardId,
        completed: true,
      });
      const secondShard = afterShard.next;
      if (secondShard === null) {
        throw new Error("expected the untouched shard");
      }
      expect(secondShard.table).toBe("t1");

      // Everything above is also true of a backend whose
      // `setMaintenanceTables` did nothing, so the case has to observe
      // that the replacement landed: finish the in-flight run and start
      // the next one, which snapshots the set the deploy installed. Both
      // halves matter — the old run ignored the new set, the new run
      // takes it.
      const finished = await completeLane(
        "run-1",
        "owner-a",
        secondShard.generation,
        secondShard.shardId,
      );
      expect(finished).toEqual({ next: null, runCompleted: true });

      const afterDeploy = await begin("run-3", "owner-a");
      expect(afterDeploy.result).toBe("started");
      const fresh = await store.claimLanes(afterDeploy.runId, "owner-a", 6);
      expect(fresh.map((claimed) => claimed.table)).toEqual(["t9", "t9"]);
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
