import { NotFoundError } from "../../application/errors";
import type { Clock } from "../../application/ports/clock";
import type {
  ScopeHandle,
  ScopeRouter,
} from "../../application/ports/scopeRouter";
import {
  type ScopeKey,
  ScopeKey as ScopeKeyOps,
} from "../../application/scope";
import type { NoteId } from "../../domain/note/valueObject";
import { createD1NoteRouteStore } from "./d1/repositories/noteRouteStore";
import type { ScopeObjectNamespace } from "./do/scopeStub";
import { createScopeStubExecutor } from "./do/scopeStub";
import type { ScopeSqlExecutor } from "./sql/executor";
import type { SqlSession } from "./sql/session";

/**
 * The Cloudflare `ScopeHandle`: the portable `key` the port defines, plus
 * the executor for the object that backs the scope. The port leaves the
 * handle's contents adapter-defined, and this is what makes the handle
 * worth passing around — the caller holds the storage, not just its name.
 */
export type CloudflareScopeHandle = ScopeHandle &
  Readonly<{ executor: ScopeSqlExecutor }>;

/**
 * Routing across the two planes: a scope name resolves to a Durable
 * Object, a NoteId resolves through `note_routes` in the global D1.
 *
 * `resolveNote` reads the primary key of the routing table and answers
 * only for routes an external read may reach, which is why a creation
 * still in flight (`reserved`) and a purge in progress (`purging`) both
 * surface as `NOTE_NOT_FOUND` rather than a scope the caller would then
 * write into.
 *
 * `objectNamespace` is empty in production and set by the conformance
 * factory, whose backends need genuinely empty scope storage per test:
 * a new namespace yields a new object name, and a new name is a new
 * object.
 */
export function createCloudflareScopeRouter(
  deps: Readonly<{
    session: SqlSession;
    clock: Clock;
    scopeObjects: ScopeObjectNamespace;
    namespace: string;
  }>,
): ScopeRouter {
  const routeStore = createD1NoteRouteStore(deps);

  return {
    forScope(scope: ScopeKey): CloudflareScopeHandle {
      return {
        scope,
        key: ScopeKeyOps.serialize(scope),
        executor: createScopeStubExecutor(
          deps.scopeObjects,
          scope,
          deps.namespace,
        ),
      };
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
