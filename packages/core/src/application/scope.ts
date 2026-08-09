import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";

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
  equals: (a: ScopeKey, b: ScopeKey): boolean =>
    a.type === "user"
      ? b.type === "user" && a.userId === b.userId
      : b.type === "workspace" && a.workspaceId === b.workspaceId,
};
