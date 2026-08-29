import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";

/**
 * Application-level normalization of an ownership context (`NoteOwner`,
 * later `TagScope` / `JobScope` / `QuotaSubject`). `ScopeKey` is the
 * infrastructure sharding key — domain entities never learn about the
 * storage object behind it.
 */
export type ScopeKey =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;

export const ScopeKey = {
  user: (userId: UserId): ScopeKey => ({ type: "user", userId }),
  workspace: (workspaceId: WorkspaceId): ScopeKey => ({
    type: "workspace",
    workspaceId,
  }),
  /** Canonical name: `user:{id}` / `workspace:{id}`. */
  serialize: (scope: ScopeKey): string =>
    scope.type === "user"
      ? `user:${scope.userId}`
      : `workspace:${scope.workspaceId}`,
  /**
   * Inverse of `serialize`, value-object construction included. Returns
   * `null` for anything that is not a canonical name, so the caller — not
   * this module — decides which error a name it stored itself deserves.
   */
  parse: (raw: string): ScopeKey | null => {
    const separator = raw.indexOf(":");
    if (separator < 0) {
      return null;
    }
    const kind = raw.slice(0, separator);
    const id = raw.slice(separator + 1).trim();
    if (id.length === 0) {
      return null;
    }
    if (kind === "user") {
      return ScopeKey.user(UserId.create(id));
    }
    if (kind === "workspace") {
      return ScopeKey.workspace(WorkspaceId.create(id));
    }
    return null;
  },
  equals: (a: ScopeKey, b: ScopeKey): boolean =>
    a.type === "user"
      ? b.type === "user" && a.userId === b.userId
      : b.type === "workspace" && a.workspaceId === b.workspaceId,
};
