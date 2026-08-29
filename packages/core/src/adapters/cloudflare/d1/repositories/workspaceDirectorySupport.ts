import { ValidationError } from "../../../../application/errors";
import type { WorkspaceId } from "../../../../domain/workspace/valueObject";
import type { SqlSession } from "../../sql/session";

/**
 * What the two `workspace_directory` readers are built over.
 *
 * `unreadableWorkspaceIds` is an induced-outage seam, the counterpart of
 * `MemoryBackend.workspaceDirectoryOutages`. Both halves of the
 * directory contracts hang on a shard that cannot be read — the batch
 * reader degrades only the affected ids to `unavailable` while the public
 * enumeration must fail rather than return a short page — and a
 * deployment that keeps the whole projection in one D1 database has no
 * way to produce that condition on its own. The set is empty in
 * production and nothing on a write path ever adds to it; it is read by
 * WorkspaceId rather than by shard because this deployment's single
 * database is one shard, so an id is the finest outage this backend can
 * express.
 */
export type WorkspaceDirectoryDeps = Readonly<{
  session: SqlSession;
  unreadableWorkspaceIds?: ReadonlySet<string>;
}>;

export const isUnreadable = (
  deps: WorkspaceDirectoryDeps,
  id: WorkspaceId,
): boolean => deps.unreadableWorkspaceIds?.has(id) ?? false;

export const hasOutage = (deps: WorkspaceDirectoryDeps): boolean =>
  (deps.unreadableWorkspaceIds?.size ?? 0) > 0;

export const invalidPagination = (message: string): ValidationError =>
  new ValidationError("INVALID_PAGINATION", message);

/**
 * Keyset position of an `(instant, id)` order, in the one encoding both
 * directory readers use. The instant comes first so the cursor reads in
 * the same order as the `ORDER BY` it resumes.
 */
export type KeysetPosition = Readonly<{ at: number; id: string }>;

export const encodePosition = (position: KeysetPosition): string =>
  `${position.at}:${position.id}`;

export const decodePosition = (after: string): KeysetPosition => {
  const separator = after.indexOf(":");
  const at = separator < 0 ? Number.NaN : Number(after.slice(0, separator));
  if (!Number.isFinite(at)) {
    throw invalidPagination("Tampered or retired pagination cursor");
  }
  return { at, id: after.slice(separator + 1) };
};
