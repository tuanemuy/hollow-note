import type { UserId } from "@repo/core/domain/identity/valueObject";
import type {
  NoteHtml,
  NoteId,
  NoteOwner,
} from "@repo/core/domain/note/valueObject";
import { StorageUrlPolicy } from "@repo/core/domain/storage/services/storageUrlPolicy";
import { ObjectKey } from "@repo/core/domain/storage/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import type { ScopeUnitOfWorkContext } from "../execution/unitOfWork";

/**
 * The `JobScope` of a job registered for a note: the note's *owning*
 * context, never the requester's. A workspace note whose references
 * another member imported has to be cancelled when that workspace is
 * deleted, which only holds if the job hangs off the owner
 * (spec/domains/job.md「`scope` の導出」).
 */
export type NoteJobScope =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;

export const jobScopeOf = (owner: NoteOwner): NoteJobScope => owner;

/**
 * One unterminated job targeting a note, as `listActiveByTarget`
 * answers. `kind` stays the open `Job.kind` vocabulary rather than the
 * three the editing paths read: narrowing it here would make the seam
 * lie about what the Job aggregate can return.
 */
export type ActiveNoteJob = Readonly<{ jobId: string; kind: string }>;

/**
 * Seam for the Job half of note editing.
 *
 * The Job aggregate belongs to a later slice, so this one ships the call
 * sites and no implementation — the same way `moveNote` carries
 * `NoteMoveTagRelocation` and `application/cleanup/participants.ts`
 * records the Job gap for account deletion. The two members are exactly
 * the two steps the spec puts on the editing paths
 * (spec/usecases/note.md#updateNoteBody steps 2 and 8): the read that
 * decides whether a running conversion / regeneration locks the note, and
 * the registration of the reference-import job a new external reference
 * calls for.
 *
 * `requestReferenceImport` answers the job id, or `null` when the
 * deployment has nothing to register one with. `null` rather than a throw
 * because the body save has already committed by then: refusing here
 * would fail a request whose whole effect is durable, and the DTO already
 * models "no import job" as `referenceImportJobId: null`.
 */
export interface NoteEditingJobs {
  /** `JobRepository.listActiveByTarget({ type: "note", noteId })`. */
  listActiveForNote(
    container: RequestContainer,
    noteId: NoteId,
  ): Promise<readonly ActiveNoteJob[]>;
  /**
   * `Job.enqueue({ target: { type: "note", noteId }, payload: { kind:
   * "referenceImport" }, scope, kind: "referenceImport", requestedBy,
   * parentId: null })`.
   */
  requestReferenceImport(
    container: RequestContainer,
    params: Readonly<{
      noteId: NoteId;
      scope: NoteJobScope;
      requestedBy: UserId;
    }>,
  ): Promise<string | null>;
}

/** The seam's only implementation until the Job slice lands. */
export const noNoteEditingJobs: NoteEditingJobs = {
  async listActiveForNote(): Promise<readonly ActiveNoteJob[]> {
    return [];
  },
  async requestReferenceImport(): Promise<string | null> {
    return null;
  },
};

/**
 * Cap on one forced-termination sweep, shared by all nine paths
 * (spec/usecases/job.md「共通: 強制終端の後始末」). A sweep that comes
 * back full leaves the rest to a continuation rather than growing one
 * transaction without bound.
 */
export const ACTIVE_JOB_SWEEP_LIMIT = 100;

/**
 * Seam for the Job half of the trash path, split from
 * {@link NoteEditingJobs} because both of its members belong **inside**
 * the transaction that trashes the note (spec/usecases/note.md#trashnote:
 * 「手順 2 の `listActiveByTarget` も UoW の内側で引く」). A
 * `JobRepository` is scope-local, so the seam takes the scope's unit-of-
 * work context rather than the request container.
 *
 * The recovery of a `processing` body is *not* a member: it rewrites the
 * `Note`, which the caller owns and which it must sequence before
 * `Note.trash`. Neither is the artifact reclamation of the shared
 * cleanup's step 2, which is provably empty on this path —
 * `listActiveByTarget({ type: "note" })` never returns a batch parent.
 */
export interface NoteTrashJobs {
  /** `JobRepository.listActiveByTarget({ type: "note", noteId }, limit: 100)`. */
  listActiveForNote(
    ctx: ScopeUnitOfWorkContext,
    noteId: NoteId,
  ): Promise<readonly ActiveNoteJob[]>;
  /** `Job.cancel` applied to each of `jobs`, saved in the same transaction. */
  cancelAll(
    ctx: ScopeUnitOfWorkContext,
    params: Readonly<{ jobs: readonly ActiveNoteJob[]; now: Date }>,
  ): Promise<void>;
}

/** The seam's only implementation until the Job slice lands. */
export const noNoteTrashJobs: NoteTrashJobs = {
  async listActiveForNote(): Promise<readonly ActiveNoteJob[]> {
    return [];
  },
  async cancelAll(): Promise<void> {},
};

/** Jobs that hold the body still while they rewrite it. */
const BODY_LOCKING_KINDS: ReadonlySet<string> = new Set([
  "conversion",
  "regeneration",
]);

export const bodyLockingJob = (
  jobs: readonly ActiveNoteJob[],
): ActiveNoteJob | null =>
  jobs.find((job) => BODY_LOCKING_KINDS.has(job.kind)) ?? null;

export const pendingReferenceImport = (
  jobs: readonly ActiveNoteJob[],
): ActiveNoteJob | null =>
  jobs.find((job) => job.kind === "referenceImport") ?? null;

/**
 * Any object key at all: `publicUrl` is contracted to carry the key it
 * was given (`adapters/conformance/objectStorage.ts` ADP-storage-024), so
 * cutting the key back out of one answer yields the prefix every stored
 * object's URL shares — which is all `StorageUrlPolicy` needs, and is
 * read from the adapter rather than spelled in a usecase (ADR 049).
 */
const DELIVERY_PROBE_KEY = ObjectKey.create("storage-url-probe");

export const storageUrlPolicyOf = (
  container: RequestContainer,
): StorageUrlPolicy => {
  const probe = container.objectStorage.publicUrl(DELIVERY_PROBE_KEY);
  const at = probe.lastIndexOf(DELIVERY_PROBE_KEY);
  return StorageUrlPolicy.create({
    appUrl: container.config.appUrl,
    deliveryBaseUrl: at < 0 ? probe : probe.slice(0, at),
  });
};

/**
 * Whether the body holds at least one reference something would have to
 * fetch. `extractExternalReferences` reports internal storage URLs too,
 * so filtering is what keeps a fully imported body from registering a
 * fresh import job on every autosave.
 */
export const hasImportableReference = (
  container: RequestContainer,
  html: NoteHtml,
): boolean => {
  const policy = storageUrlPolicyOf(container);
  return container.htmlProcessor
    .extractExternalReferences(html)
    .some((reference) => !policy.isInternal(reference.url));
};

/**
 * Step 8 of `updateNoteBody`, shared with `restoreNoteRevision` step 7.
 *
 * Registration needs both an importable reference and the absence of an
 * unterminated `referenceImport` for the same note. The duplicate is
 * *not* refused with `DuplicateJob`: it is a side effect of autosave
 * rather than a mistake the user made, so the save stands and the
 * existing job id is reported instead.
 */
export async function requestReferenceImportIfNeeded(
  container: RequestContainer,
  jobs: NoteEditingJobs,
  params: Readonly<{
    noteId: NoteId;
    owner: NoteOwner;
    html: NoteHtml;
    requestedBy: UserId;
    activeJobs: readonly ActiveNoteJob[];
  }>,
): Promise<string | null> {
  if (!hasImportableReference(container, params.html)) {
    return null;
  }
  const pending = pendingReferenceImport(params.activeJobs);
  if (pending !== null) {
    return pending.jobId;
  }
  return jobs.requestReferenceImport(container, {
    noteId: params.noteId,
    scope: jobScopeOf(params.owner),
    requestedBy: params.requestedBy,
  });
}
