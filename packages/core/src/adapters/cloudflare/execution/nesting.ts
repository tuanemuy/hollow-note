import { AsyncLocalStorage } from "node:async_hooks";

export type UnitOfWorkPlane = "global" | "scope";

/**
 * Enforcement of the shared rule on `GlobalUnitOfWorkProvider`: **never
 * nest `run`** — not inside another unit of work on the same plane, not
 * across planes. One transactional step runs in exactly one transaction
 * on one plane.
 *
 * The open unit travels with the callback's async context rather than
 * with a module-level flag, so two units of work running concurrently in
 * the same isolate do not see each other. `nodejs_compat` is what makes
 * `AsyncLocalStorage` available on workerd.
 */
const openUnit = new AsyncLocalStorage<UnitOfWorkPlane>();

export function runInUnitOfWork<T>(
  plane: UnitOfWorkPlane,
  fn: () => Promise<T>,
): Promise<T> {
  const current = openUnit.getStore();
  if (current !== undefined) {
    return Promise.reject(
      new Error(
        `Unit-of-work nesting is forbidden: a ${plane}-plane run was called inside an open ${current}-plane unit of work`,
      ),
    );
  }
  return openUnit.run(plane, fn);
}
