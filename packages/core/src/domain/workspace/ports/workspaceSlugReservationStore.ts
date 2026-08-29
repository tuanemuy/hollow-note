import type { WorkspaceId, WorkspaceSlug } from "../valueObject";

/**
 * Global uniqueness reservation for workspace slugs
 * (`workspace_slug_reservations` of spec/database/index.md), held on the
 * control plane. `WorkspaceRepository` is bound to one workspace scope
 * and sees a single row, so the slug's service-wide uniqueness — and
 * therefore `ConflictError("SLUG_ALREADY_USED")` — belongs here rather
 * than to the aggregate's repository.
 *
 * A `WorkspaceSlug` is lower-cased by its own constructor, so the value
 * passed here *is* the table's `normalized_slug`; this port never
 * normalizes again.
 *
 * Creating a slug is a two-phase saga per `operationId`: `reserve` writes
 * the row `reserved`, the workspace-local `Workspace.create` /
 * `Workspace.changeSlug` commits, and `activate` flips the row to
 * `active`. A local commit that failed compensates with `abandon`.
 * Changing a slug is the paired form: the same `activate` takes the slug
 * being left behind as `releasing` and frees it in the same transaction,
 * so no window exists in which both slugs resolve or neither does — the
 * old public URL keeps working until the new one is live.
 *
 * `release` is the standalone teardown, used where a slug is given up
 * without a replacement: workspace deletion frees the key after the
 * directory tombstone is acknowledged, so the tombstone does not block
 * re-use of the same slug, and `changeWorkspaceSlug` frees it when the
 * slug is cleared to `null` — there is no successor to hand the key to,
 * so the `activate(releasing)` exchange does not apply.
 *
 * Both forms of freeing are conditional on the workspace still holding
 * the key, and callers rely on that: which slug a workspace holds here
 * cannot be read back, so a caller giving one up names every value that
 * could be it and lets the ones that are not write nothing.
 *
 * Idempotency is keyed on `(slug, operationId)` throughout: every method
 * may be re-issued any number of times for the same operation and
 * converges on the same row. The one exception is deliberate and is what
 * the spec's "same operation id **or** the workspace's own current slug
 * may re-use an existing reservation" clause asks for: a row already
 * `active` for the same `workspaceId` is re-keyed to the reserving
 * operation and stays `active`, so a workspace re-reserving a slug it
 * already holds succeeds without the key ever ceasing to resolve.
 *
 * An operation id may name a *rename* rather than a single request —
 * `changeWorkspaceSlug` derives its id from `(workspaceId, slug)` so a
 * retry after a lost response lands on the row its predecessor took — and
 * then two concurrent attempts share one row. `attemptId` is what tells
 * them apart, and it exists for `abandon` alone: the row is held by the
 * attempt that reserved it last, and only that attempt may compensate.
 * Idempotency is unaffected, since every other method converges on the
 * row whoever calls it.
 *
 * Ownership never transfers on expiry alone: only a `reserved` row
 * carries an expiry, and only such a lapsed row may be taken over by
 * another operation. An `active` row has no expiry and is freed only by
 * `activate(releasing)` or `release`.
 *
 * Error contract: `ConflictError("SLUG_ALREADY_USED")` (the slug is held
 * by another operation or another workspace), `ConflictError`
 * (activating a row that no longer exists), `SystemError(DatabaseError)`.
 */
export interface WorkspaceSlugReservationStore {
  /**
   * The only externally readable form: the workspace an `active`
   * reservation points at. A `reserved` row (a create / change still in
   * flight) and an absent row both resolve to `null`, which is what lets
   * the public workspace page answer `WORKSPACE_NOT_FOUND` uniformly.
   *
   * A pure read — it never lapses a row or collects an expired one.
   */
  resolveActive(slug: WorkspaceSlug): Promise<WorkspaceId | null>;
  /**
   * Claims the slug as `reserved` for `operationId`, before the
   * workspace-local commit.
   *
   * Idempotent for the same `(slug, operationId)`: a row this operation
   * already reserved or activated answers success, with a `reserved`
   * row's expiry extended to `expiresAt`, so a lost response is repaired
   * by repeating the call.
   *
   * A row already `active` for the same `workspaceId` is re-keyed to
   * this operation and attempt and left `active` — the workspace already
   * owns the key, and dropping it back to `reserved` would make its own
   * public URL stop resolving mid-saga.
   *
   * Any other row held by another operation is
   * `ConflictError("SLUG_ALREADY_USED")`, unless it is a `reserved` row
   * whose expiry has lapsed, which this call takes over.
   *
   * Every `reserved` row the call comes away with is held by `attemptId`:
   * reserving is what claims the right to compensate, and the latest
   * attempt is the one that holds it. A row this operation has already
   * activated is the exception and is left exactly as it stands — nothing
   * compensates an `active` row, so there is no claim for a later attempt
   * to take.
   */
  reserve(
    input: Readonly<{
      slug: WorkspaceSlug;
      workspaceId: WorkspaceId;
      operationId: string;
      attemptId: string;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  /**
   * Flips this operation's row to `active` after the local commit
   * landed, and — when `releasing` names the slug the workspace is
   * leaving behind — frees that slug in the same transaction. The
   * exchange is atomic because a partial application would either strand
   * a slug nobody can re-use or leave two slugs resolving to one
   * workspace.
   *
   * Idempotent: a row already `active` under the same operation succeeds,
   * and the release of `releasing` is skipped once that row is gone.
   *
   * A row that is absent (an `abandon` already ran) or held by another
   * operation is a `ConflictError` — checked **before** anything is
   * released, so a stale replay of an earlier change cannot free the slug
   * the workspace holds today.
   *
   * `releasing` is freed only while it is `active` for the same
   * `workspaceId`; a slug already re-taken by someone else is left alone.
   */
  activate(
    input: Readonly<{
      slug: WorkspaceSlug;
      workspaceId: WorkspaceId;
      operationId: string;
      releasing: WorkspaceSlug | null;
    }>,
  ): Promise<void>;
  /**
   * Compensation for a local commit that did not land: drops the
   * operation's `reserved` row.
   *
   * Only `reserved` rows are dropped, and only this operation's — an
   * `active` row is left untouched, so abandoning a change whose
   * activation actually succeeded cannot take a live public URL down. A
   * no-op when there is nothing to drop, so it is safe to call blindly on
   * any failure path and safe to repeat.
   *
   * `attemptId` narrows it further, and that is the whole point of the
   * field: a row a later attempt at the same operation has taken over is
   * left alone. Otherwise an attempt that failed for a reason of its own
   * — a role lost between two reads, a barrier that refused it — would
   * drop the row a still-running attempt is about to activate, leaving a
   * scope holding a slug the global plane has no reservation for.
   */
  abandon(
    input: Readonly<{
      slug: WorkspaceSlug;
      operationId: string;
      attemptId: string;
    }>,
  ): Promise<void>;
  /**
   * Frees the slug a workspace gives up without taking another —
   * workspace deletion after the directory tombstone is acknowledged, and
   * `changeWorkspaceSlug` clearing the slug to `null`.
   *
   * Conditional on `workspaceId`, not on an operation id: the operation
   * that reserved the slug is long past and its id cannot be re-derived
   * by the one freeing it. A row held by another workspace is left alone,
   * so a delayed release can never take a key away from its successor.
   *
   * Only an `active` row is freed. This workspace's own `reserved` row —
   * a change still in flight — is left standing and reclaimed by its
   * expiry instead: with no operation id to judge by, dropping it would
   * take the reservation out from under the change about to activate it,
   * and callers name candidates rather than the key they hold, so they
   * reach `reserved` rows routinely.
   *
   * Idempotent by target state: an absent row succeeds, because the only
   * obligation is that the slug stops resolving and it already does not.
   */
  release(
    input: Readonly<{ slug: WorkspaceSlug; workspaceId: WorkspaceId }>,
  ): Promise<void>;
}
