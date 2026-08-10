import { NotFoundError } from "../../application/errors";
import type { NoteRouteStore } from "../../application/ports/noteRouteStore";
import type {
  ScopeHandle,
  ScopeRouter,
} from "../../application/ports/scopeRouter";
import {
  type ScopeKey,
  ScopeKey as ScopeKeyOps,
} from "../../application/scope";
import type { NoteId } from "../../domain/note/valueObject";
import { createMemoryNoteRouteStore } from "./repositories/noteRouteStore";
import type { MemoryBackend } from "./store";

export function createMemoryScopeRouter(backend: MemoryBackend): ScopeRouter {
  const routeStore: NoteRouteStore = createMemoryNoteRouteStore(backend);
  return {
    forScope(scope: ScopeKey): ScopeHandle {
      return { scope, key: ScopeKeyOps.serialize(scope) };
    },

    async resolveNote(
      noteId: NoteId,
    ): Promise<Readonly<{ scope: ScopeKey; routeVersion: number }>> {
      const route = await routeStore.resolve(noteId);
      if (route === null) {
        throw new NotFoundError(
          "NOTE_NOT_FOUND",
          `No externally resolvable route for note ${noteId}`,
        );
      }
      return { scope: route.scope, routeVersion: route.routeVersion };
    },
  };
}
