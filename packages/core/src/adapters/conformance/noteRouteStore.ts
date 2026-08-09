import { beforeEach, describe, expect, it } from "vitest";
import type { NoteRouteStore } from "../../application/ports/noteRouteStore";
import { ScopeKey } from "../../application/scope";
import { expectConflict, expectNotFound } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { noteId, scopeOf, userId } from "./fixtures";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Shared conformance suite for the `NoteRouteStore` saga
 * (ADP-note-035..045): reserve → activate → abandon with per-operation
 * idempotency and TTL reclaim, move with routeVersion CAS, and the
 * forward-only purge path.
 */
export function describeNoteRouteStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`NoteRouteStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let store: NoteRouteStore;

    beforeEach(async () => {
      backend = await makeBackend();
      store = backend.noteRouteStore;
    });

    const reserve = (operationId = "op-1", n = 1) =>
      store.reserveCreate({
        noteId: noteId(n),
        scope: scopeOf(1),
        createdBy: userId(1),
        operationId,
        expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
      });

    const activated = async (n = 1) => {
      await reserve(`op-${n}`, n);
      return store.activateCreate({
        noteId: noteId(n),
        operationId: `op-${n}`,
      });
    };

    it("ADP-note-035/037: a reserved route does not resolve; activation makes it active", async () => {
      const reserved = await reserve();
      expect(reserved.state).toBe("reserved");
      expect(await store.resolve(noteId(1))).toBeNull();

      const active = await store.activateCreate({
        noteId: noteId(1),
        operationId: "op-1",
      });
      expect(active.state).toBe("active");
      expect(await store.resolve(noteId(1))).toEqual(active);
      expect(ScopeKey.equals(active.scope, scopeOf(1))).toBe(true);
    });

    it("ADP-note-037/038/039: reserve, activate, and abandon are idempotent per operation", async () => {
      await reserve();
      await reserve();
      await store.activateCreate({ noteId: noteId(1), operationId: "op-1" });
      const again = await store.activateCreate({
        noteId: noteId(1),
        operationId: "op-1",
      });
      expect(again.state).toBe("active");

      await reserve("op-2", 2);
      await store.abandonCreate({ noteId: noteId(2), operationId: "op-2" });
      await store.abandonCreate({ noteId: noteId(2), operationId: "op-2" });
      expect(await store.resolve(noteId(2))).toBeNull();
    });

    it("ADP-note-037: a foreign operation cannot touch an unexpired reservation", async () => {
      await reserve("op-1");
      await expectConflict(reserve("op-2"));
      await expectConflict(
        store.activateCreate({ noteId: noteId(1), operationId: "op-2" }),
      );
      await expectConflict(
        store.abandonCreate({ noteId: noteId(1), operationId: "op-2" }),
      );
    });

    it("ADP-note-037: an expired reservation is reclaimable by a new operation", async () => {
      await reserve("op-1");
      backend.clock.advance(HOUR_MS + 1);
      const reclaimed = await reserve("op-2");
      expect(reclaimed.state).toBe("reserved");
      const active = await store.activateCreate({
        noteId: noteId(1),
        operationId: "op-2",
      });
      expect(active.state).toBe("active");
    });

    it("ADP-note-038: activating a reclaimed (vanished) reservation reports NOTE_NOT_FOUND", async () => {
      await expectNotFound(
        store.activateCreate({ noteId: noteId(9), operationId: "op-9" }),
        "NOTE_NOT_FOUND",
      );
    });

    it("ADP-note-040: beginMove CAS-checks the route version", async () => {
      const active = await activated();
      await expectConflict(
        store.beginMove({
          noteId: noteId(1),
          expectedRouteVersion: active.routeVersion + 1,
          target: scopeOf(2),
          migrationId: "migration-1",
        }),
        "STALE_SCOPE_ROUTE",
      );

      const moving = await store.beginMove({
        noteId: noteId(1),
        expectedRouteVersion: active.routeVersion,
        target: scopeOf(2),
        migrationId: "migration-1",
      });
      expect(moving.state).toBe("moving");
      expect(moving.target).toEqual(scopeOf(2));
      expect(ScopeKey.equals(moving.scope, scopeOf(1))).toBe(true);
    });

    it("ADP-note-041/042: abortMove returns to the source; switchMove flips scope and bumps the version", async () => {
      const active = await activated();
      await store.beginMove({
        noteId: noteId(1),
        expectedRouteVersion: active.routeVersion,
        target: scopeOf(2),
        migrationId: "migration-1",
      });
      const aborted = await store.abortMove({
        noteId: noteId(1),
        migrationId: "migration-1",
        expectedRouteVersion: active.routeVersion,
      });
      expect(aborted.state).toBe("active");
      expect(ScopeKey.equals(aborted.scope, scopeOf(1))).toBe(true);

      await store.beginMove({
        noteId: noteId(1),
        expectedRouteVersion: active.routeVersion,
        target: scopeOf(2),
        migrationId: "migration-2",
      });
      const switched = await store.switchMove({
        noteId: noteId(1),
        migrationId: "migration-2",
        expectedRouteVersion: active.routeVersion,
      });
      expect(switched.state).toBe("active");
      expect(ScopeKey.equals(switched.scope, scopeOf(2))).toBe(true);
      expect(switched.routeVersion).toBe(active.routeVersion + 1);

      // abort after switch must be rejected — the move already happened.
      await expectConflict(
        store.abortMove({
          noteId: noteId(1),
          migrationId: "migration-2",
          expectedRouteVersion: switched.routeVersion,
        }),
      );
    });

    it("ADP-note-043/044/045: purge closes external reach, aborts pre-delete, then tombstones", async () => {
      const active = await activated();
      await store.beginPurge({
        noteId: noteId(1),
        scope: scopeOf(1),
        expectedRouteVersion: active.routeVersion,
        operationId: "purge-1",
      });
      expect(await store.resolve(noteId(1))).toBeNull();

      const reopened = await store.abortPurge({
        noteId: noteId(1),
        operationId: "purge-1",
        expectedRouteVersion: active.routeVersion,
      });
      expect(reopened.state).toBe("active");

      await store.beginPurge({
        noteId: noteId(1),
        scope: scopeOf(1),
        expectedRouteVersion: active.routeVersion,
        operationId: "purge-2",
      });
      const tombstone = await store.finishPurge({
        noteId: noteId(1),
        operationId: "purge-2",
        expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
      });
      expect(tombstone.state).toBe("tombstone");

      expect((await store.resolve(noteId(1)))?.state).toBe("tombstone");
      backend.clock.advance(HOUR_MS + 1);
      expect(await store.resolve(noteId(1))).toBeNull();

      // Recovery after finish is forward-only.
      await expectConflict(
        store.abortPurge({
          noteId: noteId(1),
          operationId: "purge-2",
          expectedRouteVersion: active.routeVersion,
        }),
      );
    });

    it("ADP-note-036: resolveMany returns externally readable routes only", async () => {
      await activated(1);
      await reserve("op-2", 2);

      const resolved = await store.resolveMany([
        noteId(1),
        noteId(2),
        noteId(3),
      ]);
      expect(resolved.size).toBe(1);
      expect(resolved.get(noteId(1))?.state).toBe("active");
    });
  });
}
