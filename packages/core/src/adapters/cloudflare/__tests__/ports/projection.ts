import type { ObjectStorage } from "../../../../application/ports/objectStorage";
import type { LocalNoteProjectionWriter } from "../../../../domain/note/ports/localNoteProjectionWriter";
import type { LocalNoteQueryService } from "../../../../domain/note/ports/localNoteQueryService";
import type { NoteProjectionRevisionStore } from "../../../../domain/note/ports/noteProjectionRevisionStore";
import type { NoteProjectionSnapshotReader } from "../../../../domain/note/ports/noteProjectionSnapshotReader";
import type { PublicNoteProjectionWriter } from "../../../../domain/note/ports/publicNoteProjectionWriter";
import type { PublicNoteQueryService } from "../../../../domain/note/ports/publicNoteQueryService";
import { port } from "../pendingPorts";
import type { GlobalPortDeps, ScopePortDeps } from "./deps";

/**
 * Step 10 — the projection / full-text / R2 bundle, the one that spans
 * both planes.
 *
 * The bigram preprocessing (`spec/database/index.md#bigram-前処理`,
 * ADR 011) is a single pure function shared by the write side and the
 * query side; put it in `../../search/bigram.ts` so both writers and both
 * query services import the same one. `ObjectStorage` prefixes every key
 * with `deps.objectKeyPrefix`, which is how one R2 bucket serves many
 * conformance backends (ADR 004), and `publicUrl` keeps the deployment's
 * URL shape inside the adapter (ADR 049).
 *
 * Suites: `conformance/projection.test.ts`.
 */
export type ScopeProjectionPorts = Readonly<{
  localNoteProjectionWriter: LocalNoteProjectionWriter;
  noteProjectionSnapshotReader: NoteProjectionSnapshotReader;
  noteProjectionRevisionStore: NoteProjectionRevisionStore;
  localNoteQueryService: LocalNoteQueryService;
}>;

export type GlobalProjectionPorts = Readonly<{
  publicNoteProjectionWriter: PublicNoteProjectionWriter;
  publicNoteQueryService: PublicNoteQueryService;
  objectStorage: ObjectStorage;
}>;

export function createScopeProjectionPorts(
  _deps: ScopePortDeps,
): ScopeProjectionPorts {
  return {
    localNoteProjectionWriter: port<LocalNoteProjectionWriter>(
      "LocalNoteProjectionWriter",
    ),
    noteProjectionSnapshotReader: port<NoteProjectionSnapshotReader>(
      "NoteProjectionSnapshotReader",
    ),
    noteProjectionRevisionStore: port<NoteProjectionRevisionStore>(
      "NoteProjectionRevisionStore",
    ),
    localNoteQueryService: port<LocalNoteQueryService>("LocalNoteQueryService"),
  };
}

export function createGlobalProjectionPorts(
  _deps: GlobalPortDeps,
): GlobalProjectionPorts {
  return {
    publicNoteProjectionWriter: port<PublicNoteProjectionWriter>(
      "PublicNoteProjectionWriter",
    ),
    publicNoteQueryService: port<PublicNoteQueryService>(
      "PublicNoteQueryService",
    ),
    objectStorage: port<ObjectStorage>("ObjectStorage"),
  };
}
