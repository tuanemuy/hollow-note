export type MaintenanceKind =
  | "authStatePrune"
  | "jobTombstonePrune"
  | "accountManifestPrune";

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
  ): Promise<
    Readonly<{
      next: Readonly<{ generation: string; shardId: string }> | null;
      runCompleted: boolean;
    }>
  >;
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
