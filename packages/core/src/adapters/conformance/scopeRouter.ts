import { beforeEach, describe, expect, it } from "vitest";
import { ScopeKey } from "../../application/scope";
import { WorkspaceId } from "../../domain/workspace/valueObject";
import { expectNotFound } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { noteId, scopeOf, userId } from "./fixtures";

const HOUR_MS = 60 * 60 * 1000;

/** Shared conformance suite for `ScopeRouter` (ADP-common-001..002). */
export function describeScopeRouterContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`ScopeRouter conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-common-001: forScope returns a handle carrying the canonical scope name", () => {
      const userHandle = backend.scopeRouter.forScope(scopeOf(1));
      expect(userHandle.key).toBe("user:user-1");
      expect(ScopeKey.equals(userHandle.scope, scopeOf(1))).toBe(true);

      const workspaceScope = ScopeKey.workspace(WorkspaceId.create("ws-1"));
      expect(backend.scopeRouter.forScope(workspaceScope).key).toBe(
        "workspace:ws-1",
      );
    });

    it("ADP-common-002: resolveNote resolves through the route store", async () => {
      await backend.noteRouteStore.reserveCreate({
        noteId: noteId(1),
        scope: scopeOf(1),
        createdBy: userId(1),
        operationId: "op-1",
        expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
      });

      // Creation in flight — not externally resolvable yet.
      await expectNotFound(
        backend.scopeRouter.resolveNote(noteId(1)),
        "NOTE_NOT_FOUND",
      );

      await backend.noteRouteStore.activateCreate({
        noteId: noteId(1),
        operationId: "op-1",
      });
      const resolved = await backend.scopeRouter.resolveNote(noteId(1));
      expect(ScopeKey.equals(resolved.scope, scopeOf(1))).toBe(true);
      expect(resolved.routeVersion).toBeGreaterThan(0);
    });

    it("ADP-common-002: an unknown note reports NOTE_NOT_FOUND", async () => {
      await expectNotFound(
        backend.scopeRouter.resolveNote(noteId(9)),
        "NOTE_NOT_FOUND",
      );
    });
  });
}
