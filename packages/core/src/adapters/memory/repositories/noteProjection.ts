import type {
  LocalNoteProjectionWriter,
  NoteProjectionEntry,
  ProjectedTagName,
  ProjectionVersion,
  ProjectionWriteResult,
} from "../../../domain/note/ports/localNoteProjectionWriter";
import type { NoteProjectionRevisionStore } from "../../../domain/note/ports/noteProjectionRevisionStore";
import type { NoteProjectionSnapshotReader } from "../../../domain/note/ports/noteProjectionSnapshotReader";
import type { PublicNoteProjectionWriter } from "../../../domain/note/ports/publicNoteProjectionWriter";
import type { NoteId } from "../../../domain/note/valueObject";
import type { MemoryBackend, ScopeStore } from "../store";
import { clone } from "../support";

type Vector = Readonly<{
  projectionRevision: number;
  authorVersion: number;
  workspaceVersion: number;
}>;

// `written` when every component is >= the stored value and at least one
// is greater; `stale` when every component is <=; anything else is a
// read-write race (`incomparable`).
const compareVectors = (
  next: Vector,
  stored: Vector,
): ProjectionWriteResult => {
  const deltas = [
    next.projectionRevision - stored.projectionRevision,
    next.authorVersion - stored.authorVersion,
    next.workspaceVersion - stored.workspaceVersion,
  ];
  if (
    deltas.every((delta) => delta >= 0) &&
    deltas.some((delta) => delta > 0)
  ) {
    return "written";
  }
  if (deltas.every((delta) => delta <= 0)) {
    return "stale";
  }
  return "incomparable";
};

export function createMemoryLocalNoteProjectionWriter(
  scope: ScopeStore,
): LocalNoteProjectionWriter {
  const table = scope.localProjection;
  return {
    async replaceSnapshotIfNewer(
      entry: NoteProjectionEntry,
      tags: readonly ProjectedTagName[],
      version: ProjectionVersion,
    ): Promise<ProjectionWriteResult> {
      const stored = table.get(entry.noteId);
      if (stored !== undefined) {
        const verdict = compareVectors(version, stored);
        if (verdict !== "written") {
          return verdict;
        }
      }
      table.set(entry.noteId, {
        noteId: entry.noteId,
        entry: clone(entry),
        tags: clone(tags),
        projectionRevision: version.projectionRevision,
        authorVersion: version.authorVersion,
        workspaceVersion: version.workspaceVersion,
      });
      return "written";
    },

    async remove(noteId: NoteId): Promise<void> {
      table.delete(noteId);
    },
  };
}

export function createMemoryNoteProjectionSnapshotReader(
  scope: ScopeStore,
): NoteProjectionSnapshotReader {
  return {
    async read(noteId: NoteId) {
      const stored = scope.localProjection.get(noteId);
      if (stored === undefined) {
        return null;
      }
      return {
        entry: clone(stored.entry),
        tags: clone(stored.tags),
        projectionRevision: stored.projectionRevision,
      };
    },
  };
}

export function createMemoryNoteProjectionRevisionStore(
  scope: ScopeStore,
): NoteProjectionRevisionStore {
  return {
    async bump(noteId: NoteId): Promise<number> {
      const next = (scope.projectionRevisions.get(noteId) ?? 0) + 1;
      scope.projectionRevisions.set(noteId, next);
      return next;
    },
  };
}

export function createMemoryPublicNoteProjectionWriter(
  backend: MemoryBackend,
): PublicNoteProjectionWriter {
  const table = backend.publicProjection;
  return {
    async replaceSnapshotIfNewer(
      entry: NoteProjectionEntry,
      tags: readonly ProjectedTagName[],
      version: ProjectionVersion & Readonly<{ routeVersion: number }>,
    ): Promise<ProjectionWriteResult> {
      const stored = table.get(entry.noteId);
      if (stored !== undefined && version.routeVersion <= stored.routeVersion) {
        if (version.routeVersion < stored.routeVersion) {
          return "stale";
        }
        // Same generation: fall back to the vector comparison. A greater
        // routeVersion resets the stored vector instead, which keeps
        // workspace→personal moves from becoming incomparable.
        const verdict = compareVectors(version, stored);
        if (verdict !== "written") {
          return verdict;
        }
      }
      table.set(entry.noteId, {
        noteId: entry.noteId,
        entry: clone(entry),
        tags: clone(tags),
        routeVersion: version.routeVersion,
        projectionRevision: version.projectionRevision,
        authorVersion: version.authorVersion,
        workspaceVersion: version.workspaceVersion,
      });
      return "written";
    },

    async removeIfNewer(
      noteId: NoteId,
      routeVersion: number,
      projectionRevision: number,
    ): Promise<boolean> {
      const stored = table.get(noteId);
      if (stored === undefined) {
        return false;
      }
      const newer =
        routeVersion > stored.routeVersion ||
        (routeVersion === stored.routeVersion &&
          projectionRevision >= stored.projectionRevision);
      if (!newer) {
        return false;
      }
      table.delete(noteId);
      return true;
    },

    async removeForPurge(input): Promise<void> {
      backend.publicPurgeAcks.set(`${input.operationId} ${input.noteId}`, true);
      table.delete(input.noteId);
    },
  };
}
