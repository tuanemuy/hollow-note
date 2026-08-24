import type { ScopeTaskPriority } from "../../application/ports/scopeTaskScheduler";
import { compareStrings } from "./support";

/** What the selection rule needs of a candidate row, and nothing else. */
export type SelectableScopeTask = Readonly<{
  priority: ScopeTaskPriority;
  dueAt: Date;
  kind: string;
  operationId: string;
}>;

const compareScopeTasks = (
  a: SelectableScopeTask,
  b: SelectableScopeTask,
): number =>
  a.priority - b.priority ||
  a.dueAt.getTime() - b.dueAt.getTime() ||
  compareStrings(a.kind, b.kind) ||
  compareStrings(a.operationId, b.operationId);

/**
 * The selection rule of `ScopeTaskScheduler.claimDue` and
 * `ScopeTaskQueue.listDue`: reserve one slot for each priority present,
 * fill what is left in `(priority, dueAt, kind, operationId)` order, and
 * return in that same order. Which row a priority reserves is decided by
 * the same total order, so the returned **set** is determined even when
 * `limit` cuts into a priority.
 *
 * Callers decide what counts as a candidate — the due predicate is the
 * one part of the rule that depends on how a backend stores state.
 */
export function selectDueScopeTasks<T extends SelectableScopeTask>(
  candidates: readonly T[],
  limit: number,
): readonly T[] {
  if (limit <= 0) {
    return [];
  }
  const ordered = [...candidates].sort(compareScopeTasks);
  const selected = new Set<T>();
  let reservedPriority: ScopeTaskPriority | null = null;
  for (const row of ordered) {
    if (selected.size >= limit) break;
    if (row.priority === reservedPriority) continue;
    reservedPriority = row.priority;
    selected.add(row);
  }
  for (const row of ordered) {
    if (selected.size >= limit) break;
    selected.add(row);
  }
  return ordered.filter((row) => selected.has(row));
}
