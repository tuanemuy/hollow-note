import type { ScopeKey } from "../scope";

export type DueScopeTask = Readonly<{
  scope: ScopeKey;
  kind: string;
  operationId: string;
}>;

/**
 * Scope-spanning read over the scheduled tasks of every scope — the one
 * way a central runner can find out **which scopes** have work due.
 * `ScopeTaskScheduler` is only reachable through
 * `scopeUnitOfWorkProvider.run(scope, …)`, which needs the scope up
 * front, and nothing else enumerates scopes.
 *
 * Read-only on purpose: it neither claims nor processes. The runner
 * opens a scope unit of work per row and claims there, so the
 * serialization rule (claim inside the scope transaction) is unchanged.
 *
 * `listDue` is required of every backend, not an optional index: it
 * returns the tasks already due at `now` across all scopes, ordered by
 * `dueAt` ascending, and never more than `limit`. A restarted process
 * has no other way to find the continuations it left behind, so a
 * backend that answers with an empty array has not implemented the port.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface ScopeTaskQueue {
  listDue(now: Date, limit: number): Promise<readonly DueScopeTask[]>;
}
