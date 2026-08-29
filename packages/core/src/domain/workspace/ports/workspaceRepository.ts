import type { TransactionalRepository } from "@repo/core/domain/common/transactionalRepository";
import type { WorkspaceId } from "../valueObject";
import type { Workspace } from "../workspace";

/**
 * OCC-enforced persistence for the `Workspace` aggregate, bound to the
 * current workspace scope — the scope holds exactly its own workspace, so
 * a `WorkspaceId` other than the bound one resolves to `null` and no call
 * ever reaches another scope's row.
 *
 * The port carries no listing method on purpose. "Which workspaces does
 * this user belong to?", "which workspaces are published?" and "who owns
 * this slug?" are answered by the global directories
 * (`UserWorkspaceDirectory`, `PublicWorkspaceDirectoryReader`,
 * `WorkspaceDirectoryBatchReader`); giving a scope-bound repository a
 * whole-service scan would be unimplementable once scopes are physically
 * sharded.
 *
 * `findById` returns `null` for an absent row — including after the
 * deletion saga has removed it, which is what makes the saga's forward
 * recovery re-entrant. `delete` is the saga's last local write: the
 * children (`Membership` / `Invitation`) go first via their repositories'
 * `deleteByIds`, and the workspace row only after they are gone
 * (spec/usecases/workspace.md `deleteWorkspace`).
 *
 * Deletion admission itself is not this port's concern. Whether a write
 * may happen at all while `lifecycle.state === "deleting"` is decided by
 * `WorkspaceOperationLockStore.assertWritable` at the scope entry point,
 * so this repository does not re-check the lifecycle and will happily
 * persist the continuation writes the deletion owner makes.
 *
 * Global slug uniqueness is likewise outside this port. The claim on a
 * slug is taken in the global slug reservation before the scope UoW runs,
 * so `ConflictError("SLUG_ALREADY_USED")` — listed in the group's error
 * contract in spec/domains/workspace.md#ポート — reaches a caller from
 * that claim, never from `insert` / `save` here. A scope-bound row has no
 * global view and must not pretend to enforce a service-wide invariant.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")` when the
 * supplied token no longer matches the persisted version,
 * `SystemError(DatabaseError)` otherwise.
 */
export interface WorkspaceRepository
  extends TransactionalRepository<Workspace, WorkspaceId> {}
