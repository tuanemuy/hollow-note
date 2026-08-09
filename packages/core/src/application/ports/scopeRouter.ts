import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { ScopeKey } from "../scope";

/**
 * Opaque handle to the storage object backing a scope. The spec leaves
 * the handle's contents adapter-defined; the canonical `key` (the
 * serialized `ScopeKey`) is the only portable field.
 */
export type ScopeHandle = Readonly<{
  scope: ScopeKey;
  /** Canonical scope name (`user:{id}` / `workspace:{id}`). */
  key: string;
}>;

/**
 * Routing between ids and scopes. `resolveNote` resolves through the
 * `NoteRouteStore` and returns the note's current scope with its route
 * version; mutations carrying a stale `routeVersion` surface as
 * `ConflictError("STALE_SCOPE_ROUTE")` from adapters, and the
 * application re-resolves the route exactly once before giving up.
 *
 * Error contract: `NotFoundError("NOTE_NOT_FOUND")` when no externally
 * resolvable route exists, `SystemError(DatabaseError)`.
 */
export interface ScopeRouter {
  forScope(scope: ScopeKey): ScopeHandle;
  resolveNote(
    noteId: NoteId,
  ): Promise<Readonly<{ scope: ScopeKey; routeVersion: number }>>;
}
