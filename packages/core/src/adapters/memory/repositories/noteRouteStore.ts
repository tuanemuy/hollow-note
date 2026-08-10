import {
  ConflictError,
  NotFoundError,
  SystemError,
  SystemErrorCode,
} from "../../../application/errors";
import type {
  NoteRoute,
  NoteRouteStore,
} from "../../../application/ports/noteRouteStore";
import { NoteId } from "../../../domain/note/valueObject";
import type { MemoryBackend, NoteRouteRow } from "../store";
import { clone } from "../support";

const MAX_RESOLVE_MANY = 500;

const notFound = (noteId: string): NotFoundError =>
  new NotFoundError("NOTE_NOT_FOUND", `No route for note ${noteId}`);

const staleRoute = (noteId: string): ConflictError =>
  new ConflictError(
    "STALE_SCOPE_ROUTE",
    `Route version mismatch for note ${noteId}`,
  );

const stateViolation = (noteId: string, detail: string): ConflictError =>
  new ConflictError(
    "NOTE_ROUTE_STATE_VIOLATION",
    `Route for note ${noteId}: ${detail}`,
  );

export function createMemoryNoteRouteStore(
  backend: MemoryBackend,
): NoteRouteStore {
  const table = backend.noteRoutes;

  const toRoute = (row: NoteRouteRow): NoteRoute => ({
    noteId: NoteId.create(row.noteId),
    scope: clone(row.scope),
    createdBy: row.createdBy,
    routeVersion: row.routeVersion,
    state: row.state,
    target: row.target === null ? null : clone(row.target),
    migrationId: row.migrationId,
  });

  const readableRow = (noteId: string): NoteRouteRow | null => {
    const row = table.get(noteId);
    if (row === undefined) {
      return null;
    }
    if (row.state === "reserved" || row.state === "purging") {
      return null;
    }
    if (
      row.state === "tombstone" &&
      row.expiresAt !== null &&
      row.expiresAt.getTime() <= backend.clock.now().getTime()
    ) {
      return null;
    }
    return row;
  };

  const requireRow = (noteId: string): NoteRouteRow => {
    const row = table.get(noteId);
    if (row === undefined) {
      throw notFound(noteId);
    }
    return row;
  };

  const checkVersion = (row: NoteRouteRow, expected: number): void => {
    if (row.routeVersion !== expected) {
      throw staleRoute(row.noteId);
    }
  };

  return {
    async resolve(noteId): Promise<NoteRoute | null> {
      const row = readableRow(noteId);
      return row === null ? null : toRoute(row);
    },

    async resolveMany(noteIds): Promise<ReadonlyMap<NoteId, NoteRoute>> {
      // Exceeding the batch cap is a caller programming error, not a
      // concurrent-state conflict — same contract as
      // `UserBatchReader.resolveMany`.
      if (noteIds.length > MAX_RESOLVE_MANY) {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          `resolveMany accepts at most ${MAX_RESOLVE_MANY} ids`,
        );
      }
      const result = new Map<NoteId, NoteRoute>();
      for (const noteId of noteIds) {
        const row = readableRow(noteId);
        if (row !== null) {
          result.set(noteId, toRoute(row));
        }
      }
      return result;
    },

    async reserveCreate(input): Promise<NoteRoute> {
      const existing = table.get(input.noteId);
      if (existing !== undefined) {
        if (
          existing.state === "reserved" &&
          existing.operationId === input.operationId
        ) {
          return toRoute(existing);
        }
        const reservationLapsed =
          existing.state === "reserved" &&
          existing.expiresAt !== null &&
          existing.expiresAt.getTime() <= backend.clock.now().getTime();
        if (!reservationLapsed) {
          throw stateViolation(
            input.noteId,
            "already routed by another operation",
          );
        }
      }
      const row: NoteRouteRow = {
        noteId: input.noteId,
        scope: clone(input.scope),
        createdBy: input.createdBy,
        routeVersion: 1,
        state: "reserved",
        target: null,
        migrationId: null,
        lastMigrationId: null,
        operationId: input.operationId,
        expiresAt: input.expiresAt,
      };
      table.set(input.noteId, row);
      return toRoute(row);
    },

    async activateCreate(input): Promise<NoteRoute> {
      const row = requireRow(input.noteId);
      if (row.operationId !== input.operationId) {
        throw stateViolation(input.noteId, "foreign creation operation");
      }
      if (row.state === "active") {
        return toRoute(row);
      }
      if (row.state !== "reserved") {
        throw stateViolation(input.noteId, `cannot activate ${row.state}`);
      }
      const next: NoteRouteRow = { ...row, state: "active", expiresAt: null };
      table.set(input.noteId, next);
      return toRoute(next);
    },

    async abandonCreate(input): Promise<void> {
      const row = table.get(input.noteId);
      if (row === undefined) {
        return;
      }
      if (row.operationId !== input.operationId) {
        throw stateViolation(input.noteId, "foreign creation operation");
      }
      if (row.state !== "reserved") {
        throw stateViolation(input.noteId, `cannot abandon ${row.state}`);
      }
      table.delete(input.noteId);
    },

    async beginMove(input): Promise<NoteRoute> {
      const row = requireRow(input.noteId);
      if (row.state === "moving" && row.migrationId === input.migrationId) {
        return toRoute(row);
      }
      if (row.state !== "active") {
        throw stateViolation(input.noteId, `cannot move ${row.state}`);
      }
      checkVersion(row, input.expectedRouteVersion);
      const next: NoteRouteRow = {
        ...row,
        state: "moving",
        target: clone(input.target),
        migrationId: input.migrationId,
      };
      table.set(input.noteId, next);
      return toRoute(next);
    },

    async abortMove(input): Promise<NoteRoute> {
      const row = requireRow(input.noteId);
      if (row.state !== "moving" || row.migrationId !== input.migrationId) {
        throw stateViolation(input.noteId, "no matching move to abort");
      }
      checkVersion(row, input.expectedRouteVersion);
      const next: NoteRouteRow = {
        ...row,
        state: "active",
        target: null,
        migrationId: null,
      };
      table.set(input.noteId, next);
      return toRoute(next);
    },

    async switchMove(input): Promise<NoteRoute> {
      const row = requireRow(input.noteId);
      if (
        row.state === "active" &&
        row.routeVersion === input.expectedRouteVersion + 1 &&
        row.lastMigrationId === input.migrationId
      ) {
        // Lost-response retry after a completed switch.
        return toRoute(row);
      }
      if (row.state !== "moving" || row.migrationId !== input.migrationId) {
        throw stateViolation(input.noteId, "no matching move to switch");
      }
      checkVersion(row, input.expectedRouteVersion);
      if (row.target === null) {
        throw stateViolation(input.noteId, "moving row without a target");
      }
      const next: NoteRouteRow = {
        ...row,
        scope: row.target,
        state: "active",
        target: null,
        migrationId: null,
        lastMigrationId: input.migrationId,
        routeVersion: row.routeVersion + 1,
      };
      table.set(input.noteId, next);
      return toRoute(next);
    },

    async beginPurge(input): Promise<NoteRoute> {
      const row = requireRow(input.noteId);
      if (row.state === "purging" && row.operationId === input.operationId) {
        return toRoute(row);
      }
      if (row.state !== "active") {
        throw stateViolation(input.noteId, `cannot purge ${row.state}`);
      }
      checkVersion(row, input.expectedRouteVersion);
      const next: NoteRouteRow = {
        ...row,
        state: "purging",
        operationId: input.operationId,
      };
      table.set(input.noteId, next);
      return toRoute(next);
    },

    async abortPurge(input): Promise<NoteRoute> {
      const row = requireRow(input.noteId);
      if (row.state !== "purging" || row.operationId !== input.operationId) {
        throw stateViolation(input.noteId, "no matching purge to abort");
      }
      checkVersion(row, input.expectedRouteVersion);
      const next: NoteRouteRow = { ...row, state: "active" };
      table.set(input.noteId, next);
      return toRoute(next);
    },

    async finishPurge(input): Promise<NoteRoute> {
      const row = requireRow(input.noteId);
      if (row.operationId !== input.operationId) {
        throw stateViolation(input.noteId, "foreign purge operation");
      }
      if (row.state === "tombstone") {
        return toRoute(row);
      }
      if (row.state !== "purging") {
        throw stateViolation(
          input.noteId,
          `cannot finish purge on ${row.state}`,
        );
      }
      const next: NoteRouteRow = {
        ...row,
        state: "tombstone",
        expiresAt: input.expiresAt,
      };
      table.set(input.noteId, next);
      return toRoute(next);
    },
  };
}
