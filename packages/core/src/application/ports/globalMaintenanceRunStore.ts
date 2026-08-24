export type MaintenanceKind =
  | "authStatePrune"
  | "jobTombstonePrune"
  | "accountManifestPrune";

/**
 * A lane's current position, shared by `claimLanes` and `advanceOrAck`.
 *
 * `generation` is the UserId **routing** reshard generation — old and new
 * routings are worked as separate lanes — not a version of the sweep
 * table set. The table set is versioned by the run that snapshotted it.
 */
export type MaintenanceLane = Readonly<{
  generation: string;
  shardId: string;
  table: string;
  cursor: string | null;
  asOf: Date;
  commandKey: string;
}>;

/**
 * Shared run bookkeeping for the auth / job pruners, placed on the
 * routing catalog shard.
 *
 * Exactly one running run exists per kind: the next hour's cron resumes
 * an unfinished run with its original (oldest) `asOf`
 * (`result: "resumed"`), and only after completion does a candidate run
 * start fresh (`"started"`); a run leased by a live foreign owner
 * returns `"leased"`. Lane claim, page checkpoint (+ next Queue outbox),
 * shard ack + next claim, and whole-run completion detection are each
 * atomic; at most 6 lanes are active per kind. The target shard's
 * DELETE shares no transaction with this store, so on a lost response
 * the caller re-runs the DELETE idempotently with the same input cursor
 * before checkpointing. Only the holder of the 10-minute lease may
 * advance progress; `recoverLease` lets an owner reclaim a lapsed lease.
 * Since `claimLanes` only ever hands out `pending` lanes, reclaiming a
 * *lapsed* lease — through `recoverLease` or the `"resumed"` branch of
 * `beginOrResumeKind` — must also return that run's `claimed` lanes to
 * `pending`, keeping each lane's table and cursor so the new owner
 * resumes from the same keyset; otherwise the dead owner's lanes stay
 * claimed forever and the run can never complete. A lease that is still
 * live is being renewed by its working owner, so its lanes keep their
 * claim in both paths.
 * Completed runs are retained 30 days, then reclaimed via the
 * `(expiresAt, runId)` keyset in pages of at most 100.
 *
 * Table walk order (contract 1): the **ordered table set fixed when the
 * run was created** is the single source of truth. The run row holds that
 * set, a lane's position is an index into it, and the set does not move
 * while the run is resumed even if the deployment's configuration
 * changed in between. Callers hold no table order of their own.
 * (Contracts 1–4: spec/adr/061.)
 *
 * Advancing returns the position it advanced to (contract 2):
 * `advanceOrAck` hands back the lane with its `table` / `cursor` /
 * `asOf` / `commandKey`. Stepping the same lane to its next table yields
 * `cursor: null` — a new table starts at the head of the keyset. Acking
 * a lane's last table auto-claims another pending lane and returns *that
 * lane's persisted position*, wherever that lane stands: the head of the
 * run's first table for one never claimed, the checkpointed table and
 * cursor for one already worked and released. `next` is `null` in two
 * situations. A release (`completed: false`) only puts the lane back to
 * `pending` and never claims a new one, even while other lanes are
 * pending. An ack that finds no pending lane to hand over returns none
 * either — which covers both the ack that finishes the run and an ack
 * with lanes still `claimed` by their owners, so `next === null` never
 * by itself means the run is over. `runCompleted` answers that
 * separately and is true only once every lane is done.
 *
 * `commandKey` is minted by whichever side created the position
 * (contract 3). (a) Every position the **store** creates — the head
 * position each lane starts at when the run is created, and the position
 * a lane is stepped to at its next table — carries the key the caller
 * derives from that position
 * (`${runId}:${generation}:${shardId}:${table}:${cursor ?? ""}`), so a
 * Queue outbox folds the store's mint and the caller's re-derivation
 * into one key. (b) When the store hands back an **existing** position —
 * the auto-claimed lane above — it returns that lane's persisted
 * `commandKey` unchanged and does **not** re-mint it. For a lane already
 * worked that value came from the caller's `checkpointLane`
 * `nextCommandKey`, whose rule only the caller knows, and re-minting it
 * would part it from the continuation request already queued under it.
 *
 * A non-null `next` is claimed (contract 4). The caller that **drives**
 * lanes — the cron path — owes it either processing or a release. A
 * single continuation turn instead hands the lane on to the next turn
 * still claimed; each usecase's Runtime wiring note says what that means
 * until the queue producer exists.
 *
 * Error contract: `ConflictError` (foreign lease), `SystemError(DatabaseError)`.
 */
export interface GlobalMaintenanceRunStore {
  beginOrResumeKind(
    input: Readonly<{
      candidateRunId: string;
      kind: MaintenanceKind;
      candidateAsOf: Date;
      generations: readonly string[];
      leaseOwner: string;
      leaseUntil: Date;
    }>,
  ): Promise<
    Readonly<{
      runId: string;
      asOf: Date;
      result: "started" | "resumed" | "leased";
    }>
  >;
  claimLanes(
    runId: string,
    leaseOwner: string,
    limit: number,
  ): Promise<readonly MaintenanceLane[]>;
  checkpointLane(
    input: Readonly<{
      runId: string;
      leaseOwner: string;
      generation: string;
      shardId: string;
      table: string;
      cursor: string | null;
      asOf: Date;
      nextCommandKey: string;
    }>,
  ): Promise<void>;
  advanceOrAck(
    input: Readonly<{
      runId: string;
      leaseOwner: string;
      generation: string;
      shardId: string;
      completed: boolean;
    }>,
  ): Promise<Readonly<{ next: MaintenanceLane | null; runCompleted: boolean }>>;
  /** Returns whether the lapsed lease was reclaimed by `leaseOwner`. */
  recoverLease(
    runId: string,
    leaseOwner: string,
    leaseUntil: Date,
  ): Promise<boolean>;
  pruneCompleted(
    expiresAtOrBefore: Date,
    cursor: string | null,
    limit: number,
  ): Promise<Readonly<{ removed: number; nextCursor: string | null }>>;
}
