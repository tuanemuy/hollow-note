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
 * returns the tasks already due at `now` across all scopes and never
 * more than `limit`. A restarted process has no other way to find the
 * continuations it left behind, so a backend that answers with an empty
 * array has not implemented the port.
 *
 * Candidate rows and their order are the selection rule of
 * `ScopeTaskScheduler` — reservation of one slot per priority, then fill
 * in `(priority, dueAt, kind, operationId)` order, returned in that same
 * order — applied across scopes instead of within one. What the
 * reservation guarantees is that a priority **class** reaches the
 * result, not that any particular scope does: which scope carries the
 * reserved row follows from `(dueAt, kind, operationId)`. That key is
 * not a total order across scopes — `operationId` is derived from the
 * originating operation and is not scoped — so when two scopes tie on
 * all four fields, which of them is offered is unspecified and may
 * differ between backends. Rows under a live lease are not candidates
 * and stay invisible here until it lapses, so a scope whose only work is
 * claimed is not offered to the runner.
 *
 * Input bounds: `limit <= 0` returns an empty array.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface ScopeTaskQueue {
  listDue(now: Date, limit: number): Promise<readonly DueScopeTask[]>;
}
