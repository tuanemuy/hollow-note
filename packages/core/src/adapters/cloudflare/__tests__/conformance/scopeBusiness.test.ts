import { describe, expect, it } from "vitest";
import { Note } from "../../../../domain/note/note";
import { describeAppliedOperationStoreContract } from "../../../conformance/appliedOperationStore";
import { describeBackupRecordRepositoryContract } from "../../../conformance/backupRecordRepository";
import {
  makeBlankNote,
  noteId,
  scopeOf,
  userId,
} from "../../../conformance/fixtures";
import { describeLlmUsageRepositoryContract } from "../../../conformance/llmUsageRepository";
import { describeNoteRepositoryContract } from "../../../conformance/noteRepository";
import { describeNoteRevisionRepositoryContract } from "../../../conformance/noteRevisionRepository";
import { describeStorageQuotaRepositoryContract } from "../../../conformance/storageQuotaRepository";
import { describeStoredFileRepositoryContract } from "../../../conformance/storedFileRepository";
import { describeTagAssignmentRepositoryContract } from "../../../conformance/tagAssignmentRepository";
import { makeCloudflareConformanceBackend } from "../conformanceBackend";

// Suites for the scope Durable Object business ports
// (`../ports/scopeBusiness.ts`).
const BACKEND = "cloudflare";

describeStoredFileRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeNoteRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeStorageQuotaRepositoryContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeNoteRevisionRepositoryContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeLlmUsageRepositoryContract(BACKEND, makeCloudflareConformanceBackend);
describeAppliedOperationStoreContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeTagAssignmentRepositoryContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);
describeBackupRecordRepositoryContract(
  BACKEND,
  makeCloudflareConformanceBackend,
);

/**
 * The staged-session half of `findNextPurgeDeadline`, which the shared
 * suite cannot reach: its cases read through an autocommit session, and
 * the overlay rule this pins only exists inside a unit of work
 * (`spec/database/index.md` の「同一 UoW の読み」(3)).
 */
describe("NoteRepository staged reads [cloudflare]", () => {
  it("ADP-note-057: findNextPurgeDeadline answers the deadline of a note trashed in the same unit of work", async () => {
    const backend = await makeCloudflareConformanceBackend();
    const scope = scopeOf(1);
    const now = backend.clock.now();
    await backend
      .forScope(scope)
      .noteRepository.insert(makeBlankNote(1, userId(1), now));

    const observed = await backend.scopeUnitOfWork.run(scope, async (ctx) => {
      const stored = await ctx.noteRepository.findById(noteId(1));
      if (stored === null || stored.entity.lifecycle !== "active") {
        throw new Error("seeded note missing");
      }
      const trashed = Note.trash(stored.entity, now).entity;
      await ctx.noteRepository.save(trashed, stored.expectedVersion);
      return {
        expected: trashed.purgeAfter,
        deadline: await ctx.noteRepository.findNextPurgeDeadline(),
      };
    });

    expect(observed.deadline).toEqual(observed.expected);
  });
});
