import type { ObjectStorage } from "../../../../application/ports/objectStorage";
import type { LocalNoteProjectionWriter } from "../../../../domain/note/ports/localNoteProjectionWriter";
import type { LocalNoteQueryService } from "../../../../domain/note/ports/localNoteQueryService";
import type { NoteProjectionRevisionStore } from "../../../../domain/note/ports/noteProjectionRevisionStore";
import type { NoteProjectionSnapshotReader } from "../../../../domain/note/ports/noteProjectionSnapshotReader";
import type { PublicNoteProjectionWriter } from "../../../../domain/note/ports/publicNoteProjectionWriter";
import type { PublicNoteQueryService } from "../../../../domain/note/ports/publicNoteQueryService";
import { createD1PublicNoteProjectionWriter } from "../../d1/repositories/publicNoteProjection";
import { createD1PublicNoteQueryService } from "../../d1/repositories/publicNoteQueryService";
import { createScopeLocalNoteQueryService } from "../../do/repositories/localNoteQueryService";
import {
  createScopeLocalNoteProjectionWriter,
  createScopeNoteProjectionRevisionStore,
  createScopeNoteProjectionSnapshotReader,
} from "../../do/repositories/noteProjection";
import { createR2ObjectStorage } from "../../r2/objectStorage";
import { port } from "../pendingPorts";
import type { GlobalPortDeps, ScopePortDeps } from "./deps";

/**
 * Stand-in for the bucket's public domain. The contract only asks that
 * the URL carry the key and stay stable, so the deployment's real domain
 * (ADR 049) is a configuration value the conformance run does not have.
 */
const PUBLIC_OBJECT_BASE_URL = "https://objects.hollow.test";

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
  deps: ScopePortDeps,
): ScopeProjectionPorts {
  return {
    localNoteProjectionWriter: port<LocalNoteProjectionWriter>(
      "LocalNoteProjectionWriter",
      () => createScopeLocalNoteProjectionWriter(deps.session),
    ),
    noteProjectionSnapshotReader: port<NoteProjectionSnapshotReader>(
      "NoteProjectionSnapshotReader",
      () => createScopeNoteProjectionSnapshotReader(deps.session),
    ),
    noteProjectionRevisionStore: port<NoteProjectionRevisionStore>(
      "NoteProjectionRevisionStore",
      () => createScopeNoteProjectionRevisionStore(deps.session),
    ),
    localNoteQueryService: port<LocalNoteQueryService>(
      "LocalNoteQueryService",
      () => createScopeLocalNoteQueryService(deps.session),
    ),
  };
}

export function createGlobalProjectionPorts(
  deps: GlobalPortDeps,
): GlobalProjectionPorts {
  return {
    publicNoteProjectionWriter: port<PublicNoteProjectionWriter>(
      "PublicNoteProjectionWriter",
      () => createD1PublicNoteProjectionWriter(deps.session),
    ),
    publicNoteQueryService: port<PublicNoteQueryService>(
      "PublicNoteQueryService",
      () => createD1PublicNoteQueryService(deps.session),
    ),
    objectStorage: port<ObjectStorage>("ObjectStorage", () =>
      createR2ObjectStorage({
        bucket: deps.bucket,
        publicBaseUrl: PUBLIC_OBJECT_BASE_URL,
        keyPrefix: deps.objectKeyPrefix,
      }),
    ),
  };
}
