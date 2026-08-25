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
import type { GlobalPortDeps, ScopePortDeps } from "./deps";

/**
 * Stand-in for the bucket's public domain. The contract only asks that
 * the URL carry the key and stay stable, so the deployment's real domain
 * (ADR 049) is a configuration value the conformance run does not have.
 */
const PUBLIC_OBJECT_BASE_URL = "https://objects.hollow.test";

/**
 * The projection / full-text / R2 bundle, the one that spans both planes.
 *
 * `ObjectStorage` prefixes every key with `deps.objectKeyPrefix`, which is
 * how one R2 bucket serves many conformance backends, and
 * `publicUrl` keeps the deployment's URL shape inside the adapter
 * (ADR 049).
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
    localNoteProjectionWriter: createScopeLocalNoteProjectionWriter(
      deps.session,
    ),
    noteProjectionSnapshotReader: createScopeNoteProjectionSnapshotReader(
      deps.session,
    ),
    noteProjectionRevisionStore: createScopeNoteProjectionRevisionStore(
      deps.session,
    ),
    localNoteQueryService: createScopeLocalNoteQueryService(deps.session),
  };
}

export function createGlobalProjectionPorts(
  deps: GlobalPortDeps,
): GlobalProjectionPorts {
  return {
    publicNoteProjectionWriter: createD1PublicNoteProjectionWriter(
      deps.session,
    ),
    publicNoteQueryService: createD1PublicNoteQueryService(deps.session),
    objectStorage: createR2ObjectStorage({
      bucket: deps.bucket,
      publicBaseUrl: PUBLIC_OBJECT_BASE_URL,
      keyPrefix: deps.objectKeyPrefix,
    }),
  };
}
