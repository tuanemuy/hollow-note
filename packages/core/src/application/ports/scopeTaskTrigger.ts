/**
 * Best-effort kick of the scope-task runner so a continuation stored by
 * a just-committed unit of work is picked up without waiting for the
 * next interval tick.
 *
 * Same contract as `RelayTrigger`: fire-and-forget, never throwing,
 * never blocking the caller, and idempotent — a kick that races a run
 * already in flight collapses into it. Dropping a kick costs latency
 * (the interval tick still finds the row), never correctness.
 *
 * A runtime where each scope wakes itself — a Durable Object alarm — has
 * nothing to kick and uses the no-op.
 */
export interface ScopeTaskTrigger {
  kick(): void;
}

export const NoopScopeTaskTrigger: ScopeTaskTrigger = {
  kick: () => {},
};
