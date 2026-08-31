import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import type { Note } from "@repo/core/domain/note/note";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import { isConflictError, isNotFoundError, isValidationError } from "../errors";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";
import { jobScopeOf, type NoteJobScope } from "./jobs";
import { purgeNote } from "./purgeNote";
import type { EmptyTrashView } from "./view";

/**
 * Notes one HTTP request purges inline. The bound is about the response
 * time and the `note.purged` fan-out of a single mutation, not about
 * query count — scope-local SQL carries no D1 budget
 * (spec/platform/index.md「実行予算と分割単位」).
 */
export const EMPTY_TRASH_SYNCHRONOUS_LIMIT = 50;

/**
 * Notes one bulk-operation parent job takes on. Children run as separate
 * executions, so the parent may hold ten times what a request may do
 * inline; the two numbers answer different constraints and are not
 * derived from one another.
 */
export const EMPTY_TRASH_JOB_CHUNK_SIZE = 500;

/** One enumeration page of the job path, capped as `listByOwner` is. */
const ENUMERATION_PAGE_SIZE = 100;

export type EmptyTrashOwnerInput =
  | Readonly<{ ownerType?: "user" }>
  | Readonly<{ ownerType: "workspace"; ownerWorkspaceId: string }>;

export type EmptyTrashInput = Readonly<{ userId: string }> &
  EmptyTrashOwnerInput;

/**
 * Seam for the bulk-operation half of emptying a large trash.
 *
 * The Job aggregate belongs to a later slice, so this slice ships the
 * call site and no implementation — the same seam shape
 * `NoteEditingJobs` / `NoteTrashJobs` take. The member is exactly step
 * 2's second branch: `requestBulkNoteOperation` with the internal
 * `{ kind: "purge" }` operation, one call per 500-note chunk, carrying
 * the source scope so parent and children hang off the owning context.
 *
 * `null` answers "this deployment has nothing to register a job with",
 * which is what keeps `jobIds` an accurate list of what was registered
 * rather than a promise nothing kept.
 */
export interface NoteBulkPurgeJobs {
  requestBulkPurge(
    container: RequestContainer,
    params: Readonly<{
      noteIds: readonly string[];
      scope: NoteJobScope;
      requestedBy: UserId;
    }>,
  ): Promise<string | null>;
}

/** The seam's only implementation until the Job slice lands. */
export const noNoteBulkPurgeJobs: NoteBulkPurgeJobs = {
  async requestBulkPurge(): Promise<string | null> {
    return null;
  },
};

export type EmptyTrashArgs = ServiceArgs<EmptyTrashInput> &
  Readonly<{ jobs?: NoteBulkPurgeJobs }>;

/**
 * Empties the current context's trash (UC-note-020, ED-10).
 *
 * Two paths, chosen by size and never both: a small trash is purged
 * inline, a large one is handed to bulk-operation jobs. `mode` is what
 * tells them apart in the response, because `purgedCount` means
 * different things on either side — notes actually destroyed on the
 * inline path, notes merely enrolled on the job path, where nothing has
 * been deleted yet by the time this returns.
 *
 * The inline path **calls** `purgeNote`; it does not repeat its steps.
 * This usecase therefore opens no unit of work of its own: each purge
 * owns its transaction and commits on its own. Batching the 50 into one
 * transaction would buy nothing — the fan-out that follows a purge is
 * eventually consistent by design (ADR 008) — while costing the
 * property that matters here, that an interrupted "empty the trash"
 * leaves a partially emptied trash rather than an unfinished one.
 *
 * A note whose version moved between the enumeration and its purge is
 * skipped and **not** re-read. The overwhelmingly likely cause is a
 * `restoreNote` that just took it out of the trash, and re-reading would
 * destroy the note the user has only now recovered. "Already gone" is
 * skipped for the same reason from the other side: it is not this
 * request's job to report someone else's completed deletion. Those two
 * are the whole of what is skipped; any other failure is reported, so a
 * request that purged nothing because nothing could be reached does not
 * come back as an emptied trash.
 */
export async function emptyTrash({
  container,
  input,
  jobs = noNoteBulkPurgeJobs,
}: EmptyTrashArgs): Promise<EmptyTrashView> {
  const owner = await resolveOwner(container, input);
  const scope =
    owner.type === "user"
      ? ScopeKey.user(owner.userId)
      : ScopeKey.workspace(owner.workspaceId);
  const reader = container.noteReaderFor(scope);
  const total = await reader.countByOwner(owner, "trashed");

  if (total <= EMPTY_TRASH_SYNCHRONOUS_LIMIT) {
    const page = await reader.listByOwner(owner, "trashed", {
      page: 1,
      limit: EMPTY_TRASH_SYNCHRONOUS_LIMIT,
    });
    return {
      mode: "purged",
      purgedCount: await purgeEachNote(container, input.userId, page.items),
      jobIds: [],
    };
  }

  return scheduleBulkPurge(container, jobs, {
    owner,
    scope,
    total,
    requestedBy: UserId.create(input.userId),
  });
}

/**
 * The two refusals this loop is allowed to swallow, and the only two:
 * the note left the trash between the enumeration and its purge
 * (`ConflictError` from the version that moved, `NOTE_NOT_TRASHED` from
 * the barrier) or somebody else finished deleting it first
 * (`NotFoundError`). Both mean "this note is no longer this request's
 * to delete", which is a fact about one note and not about the trash.
 *
 * Everything else — a scope that will not answer, an invariant that
 * broke — says nothing about the note it happened to arrive on, so it
 * is reported rather than counted as a skip. Swallowing it would let a
 * scope that is entirely unreachable return as "0 件を完全に削除しました"
 * (spec/usecases/note.md#emptyTrash のエラーケース).
 */
const isSkippableRefusal = (cause: unknown): boolean =>
  isConflictError(cause) ||
  isNotFoundError(cause) ||
  (isValidationError(cause) && cause.code === "NOTE_NOT_TRASHED");

/**
 * The inline path's loop. A skippable refusal is contained to its own
 * note: the trash is a set of unrelated notes, so one that has left it
 * says nothing about the next, and the shortfall between the count and
 * `purgedCount` is what reports it to the caller. Any other failure ends
 * the request — see {@link isSkippableRefusal}.
 */
async function purgeEachNote(
  container: RequestContainer,
  userId: string,
  notes: readonly Note[],
): Promise<number> {
  let purgedCount = 0;
  for (const note of notes) {
    try {
      await purgeNote({
        container,
        input: {
          kind: "userRequest",
          noteId: note.id,
          userId,
          // The version this enumeration saw, per「対象の版を持たない
          // 呼び出し元は、呼ぶ直前に自分で対象を引いてそのときの版を渡す」.
          expectedVersion: note.version,
        },
      });
      purgedCount += 1;
    } catch (cause) {
      if (!isSkippableRefusal(cause)) {
        throw cause;
      }
      container.logger.warn("[emptyTrash] a note left the trash before it", {
        cause,
        noteId: note.id,
      });
    }
  }
  return purgedCount;
}

/**
 * The job path: enumerate the trash in pages and enrol every 500 notes
 * into one parent job.
 *
 * Nothing is deleted here, which is why the enumeration is stable under
 * offset paging — `listByOwner` orders totally (`updatedAt DESC, id
 * DESC`) and this walk removes nothing from under itself.
 *
 * The walk is bounded by the count the request has already taken rather
 * than by "read until a page comes back short": the sequential reads of
 * one request have to be bounded by something the request knows
 * (spec/platform/index.md「実行予算と分割単位」), and a paging bug would
 * otherwise mean a request that never returns instead of one that
 * returns wrong. A note trashed after the count belongs to the next
 * request, not to this one, which is why the shortfall is left rather
 * than chased.
 */
async function scheduleBulkPurge(
  container: RequestContainer,
  jobs: NoteBulkPurgeJobs,
  params: Readonly<{
    owner: NoteOwner;
    scope: ScopeKey;
    total: number;
    requestedBy: UserId;
  }>,
): Promise<EmptyTrashView> {
  const reader = container.noteReaderFor(params.scope);
  const jobScope = jobScopeOf(params.owner);
  const jobIds: string[] = [];
  let chunk: string[] = [];
  let enrolled = 0;

  const flush = async (): Promise<void> => {
    if (chunk.length === 0) {
      return;
    }
    const jobId = await jobs.requestBulkPurge(container, {
      noteIds: chunk,
      scope: jobScope,
      requestedBy: params.requestedBy,
    });
    if (jobId !== null) {
      jobIds.push(jobId);
    }
    enrolled += chunk.length;
    chunk = [];
  };

  const pageCount = Math.ceil(params.total / ENUMERATION_PAGE_SIZE);
  for (let page = 1; page <= pageCount; page += 1) {
    const result = await reader.listByOwner(params.owner, "trashed", {
      page,
      limit: ENUMERATION_PAGE_SIZE,
    });
    for (const note of result.items) {
      chunk.push(note.id);
      if (chunk.length === EMPTY_TRASH_JOB_CHUNK_SIZE) {
        await flush();
      }
    }
    if (result.items.length < ENUMERATION_PAGE_SIZE) {
      break;
    }
  }
  await flush();

  return { mode: "scheduled", purgedCount: enrolled, jobIds };
}

/**
 * The permission gate, `deleteNote` rather than `viewNote`: emptying the
 * trash is the most destructive operation the screen offers, and a
 * viewer must not reach it (spec/pages/index.md L-01).
 */
async function resolveOwner(
  container: RequestContainer,
  input: EmptyTrashInput,
): Promise<NoteOwner> {
  if (input.ownerType !== "workspace") {
    return NoteOwner.user(UserId.create(input.userId));
  }
  const access = await resolveWorkspaceAccess({
    container,
    input: { workspaceId: input.ownerWorkspaceId, userId: input.userId },
  });
  if (access.role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can empty the trash of this workspace",
    );
  }
  WorkspaceAuthorization.ensureCan(access.role, "deleteNote");
  return NoteOwner.workspace(WorkspaceId.create(access.workspaceId));
}
