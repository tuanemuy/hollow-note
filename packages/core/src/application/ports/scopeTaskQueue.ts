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
 * A runtime where each scope wakes itself (a Durable Object alarm)
 * returns an empty array — there is nothing for a central enumerator to
 * do, and that is a complete implementation of this port, not a stub.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface ScopeTaskQueue {
  listDue(now: Date, limit: number): Promise<readonly DueScopeTask[]>;
}
