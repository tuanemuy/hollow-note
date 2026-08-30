import type { AppliedOperationStore } from "../../../../application/ports/appliedOperationStore";
import type { BackupRecordRepository } from "../../../../domain/integration/ports/backupRecordRepository";
import type { NoteRepository } from "../../../../domain/note/ports/noteRepository";
import type { NoteRevisionRepository } from "../../../../domain/note/ports/noteRevisionRepository";
import type { StoredFileRepository } from "../../../../domain/storage/ports/storedFileRepository";
import type { TagAssignmentRepository } from "../../../../domain/tag/ports/tagAssignmentRepository";
import type { LlmUsageRepository } from "../../../../domain/usage/ports/llmUsageRepository";
import type { StorageQuotaRepository } from "../../../../domain/usage/ports/storageQuotaRepository";
import { createCloudflareAppliedOperationStore } from "../../do/repositories/appliedOperationStore";
import { createCloudflareBackupRecordRepository } from "../../do/repositories/backupRecordRepository";
import { createCloudflareLlmUsageRepository } from "../../do/repositories/llmUsageRepository";
import { createCloudflareNoteRepository } from "../../do/repositories/noteRepository";
import { createCloudflareNoteRevisionRepository } from "../../do/repositories/noteRevisionRepository";
import { createCloudflareStorageQuotaRepository } from "../../do/repositories/storageQuotaRepository";
import { createCloudflareStoredFileRepository } from "../../do/repositories/storedFileRepository";
import { createCloudflareTagAssignmentRepository } from "../../do/repositories/tagAssignmentRepository";
import type { ScopePortDeps } from "./deps";

/**
 * The scope Durable Object business bundle.
 *
 * `notes` is the only table of the bundle carrying a scope key, so
 * `noteRepository` is the only port handed `deps.scope` and the only one
 * that checks `owner_type` / `owner_id` against the object's own
 * `ScopeKey` on restore and save (`spec/database/index.md` の
 * 「共通の規約」). The owner and subject columns of the others are
 * accounting attribution, which may legitimately name a different party
 * from the object holding the row; physical separation is carried by the
 * `_scope_identity` pin, not by those columns.
 *
 * Suites: `conformance/scopeBusiness.test.ts`.
 */
export type ScopeBusinessPorts = Readonly<{
  noteRepository: NoteRepository;
  noteRevisionRepository: NoteRevisionRepository;
  storedFileRepository: StoredFileRepository;
  tagAssignmentRepository: TagAssignmentRepository;
  backupRecordRepository: BackupRecordRepository;
  storageQuotaRepository: StorageQuotaRepository;
  llmUsageRepository: LlmUsageRepository;
  appliedOperationStore: AppliedOperationStore;
}>;

export function createScopeBusinessPorts(
  deps: ScopePortDeps,
): ScopeBusinessPorts {
  return {
    noteRepository: createCloudflareNoteRepository({
      session: deps.session,
      scope: deps.scope,
    }),
    noteRevisionRepository: createCloudflareNoteRevisionRepository({
      session: deps.session,
    }),
    storedFileRepository: createCloudflareStoredFileRepository({
      session: deps.session,
    }),
    tagAssignmentRepository: createCloudflareTagAssignmentRepository({
      session: deps.session,
    }),
    backupRecordRepository: createCloudflareBackupRecordRepository({
      session: deps.session,
    }),
    storageQuotaRepository: createCloudflareStorageQuotaRepository({
      session: deps.session,
    }),
    llmUsageRepository: createCloudflareLlmUsageRepository({
      session: deps.session,
    }),
    appliedOperationStore: createCloudflareAppliedOperationStore({
      session: deps.session,
      clock: deps.clock,
    }),
  };
}
