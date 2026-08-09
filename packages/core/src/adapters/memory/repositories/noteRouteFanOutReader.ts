import type { NoteRouteFanOutReader } from "../../../application/ports/noteRouteFanOutReader";
import type { NoteRoute } from "../../../application/ports/noteRouteStore";
import {
  type ScopeKey,
  ScopeKey as ScopeKeyOps,
} from "../../../application/scope";
import type { ShardPage } from "../../../domain/common/pagination";
import type { UserId } from "../../../domain/identity/valueObject";
import { NoteId } from "../../../domain/note/valueObject";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../cursor";
import type { MemoryBackend, NoteRouteRow } from "../store";
import { clone, compareStrings } from "../support";

const MAX_LIMIT = 200;

export function createMemoryNoteRouteFanOutReader(
  backend: MemoryBackend,
): NoteRouteFanOutReader {
  const toRoute = (row: NoteRouteRow): NoteRoute => ({
    noteId: NoteId.create(row.noteId),
    scope: clone(row.scope),
    createdBy: row.createdBy,
    routeVersion: row.routeVersion,
    state: row.state,
    target: row.target === null ? null : clone(row.target),
    migrationId: row.migrationId,
  });

  const page = (
    fingerprint: string,
    matches: (row: NoteRouteRow) => boolean,
    cursor: string | null,
    limit: number,
  ): ShardPage<NoteRoute> => {
    const after =
      cursor === null ? null : decodeOpaqueCursor(cursor, fingerprint).after;
    const effectiveLimit = Math.min(Math.max(0, limit), MAX_LIMIT);
    const rows = backend.noteRoutes
      .values()
      .filter(
        (row) =>
          row.state !== "reserved" &&
          matches(row) &&
          (after === null || row.noteId > after),
      )
      .sort((a, b) => compareStrings(a.noteId, b.noteId));
    const items = rows.slice(0, effectiveLimit);
    const last = items[items.length - 1];
    return {
      items: items.map(toRoute),
      nextCursor:
        rows.length > items.length && last !== undefined
          ? encodeOpaqueCursor({ fp: fingerprint, after: last.noteId })
          : null,
    };
  };

  return {
    async listByCreatedBy(
      userId: UserId,
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<NoteRoute>> {
      return page(
        `noteRouteFanOut:createdBy:${userId}`,
        (row) => row.createdBy === userId,
        cursor,
        limit,
      );
    },

    async listByScope(
      scope: ScopeKey,
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<NoteRoute>> {
      const key = ScopeKeyOps.serialize(scope);
      return page(
        `noteRouteFanOut:scope:${key}`,
        (row) => ScopeKeyOps.serialize(row.scope) === key,
        cursor,
        limit,
      );
    },
  };
}
