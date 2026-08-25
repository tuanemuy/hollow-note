import type { AppliedOperationStore } from "../../../../application/ports/appliedOperationStore";
import type { NoteRepository } from "../../../../domain/note/ports/noteRepository";
import type { NoteRevisionRepository } from "../../../../domain/note/ports/noteRevisionRepository";
import type { StoredFileRepository } from "../../../../domain/storage/ports/storedFileRepository";
import type { LlmUsageRepository } from "../../../../domain/usage/ports/llmUsageRepository";
import type { StorageQuotaRepository } from "../../../../domain/usage/ports/storageQuotaRepository";
import { port } from "../pendingPorts";
import type { ScopePortDeps } from "./deps";

/**
 * Step 8 — the scope Durable Object business bundle.
 *
 * Every port here gets `deps.scope` and owes the `scope 検証` rule of
 * `spec/database/index.md` の「共通の規約」: `owner_type` / `owner_id`
 * must match the object's own `ScopeKey` on both restore and save.
 *
 * Suites: `conformance/scopeBusiness.test.ts`.
 */
export type ScopeBusinessPorts = Readonly<{
  noteRepository: NoteRepository;
  noteRevisionRepository: NoteRevisionRepository;
  storedFileRepository: StoredFileRepository;
  storageQuotaRepository: StorageQuotaRepository;
  llmUsageRepository: LlmUsageRepository;
  appliedOperationStore: AppliedOperationStore;
}>;

export function createScopeBusinessPorts(
  _deps: ScopePortDeps,
): ScopeBusinessPorts {
  return {
    noteRepository: port<NoteRepository>("NoteRepository"),
    noteRevisionRepository: port<NoteRevisionRepository>(
      "NoteRevisionRepository",
    ),
    storedFileRepository: port<StoredFileRepository>("StoredFileRepository"),
    storageQuotaRepository: port<StorageQuotaRepository>(
      "StorageQuotaRepository",
    ),
    llmUsageRepository: port<LlmUsageRepository>("LlmUsageRepository"),
    appliedOperationStore: port<AppliedOperationStore>("AppliedOperationStore"),
  };
}
