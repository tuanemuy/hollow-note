import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { JobId } from "@repo/core/domain/job/valueObject";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { ScopeKey } from "../scope";

/**
 * Frozen transfer payload of a move, as this port would take it: Note /
 * revisions, tag names (display + normalized), source / media /
 * reference StoredFile metadata, BackupRecord, and the Usage delta. R2
 * bytes never move. Declared opaque, since a backend that folds a phase
 * into one transaction fixes the field layout together with its
 * adapter.
 *
 * Not the type the shipped move carries: that one is `MoveSnapshot`,
 * local to `application/note/moveNote.ts`, and it holds what this
 * deployment actually transfers (Note, revisions, file metadata, bytes).
 * `TagAssignment` and `BackupRecord` exist only on their delete side, so
 * a move has no write path to carry them across.
 */
export interface NoteMoveSnapshot {
  readonly migrationId: string;
}

/**
 * Cross-scope note transfer. Re-application under the same migration id
 * returns the saved result (all commands are idempotent per migration).
 * Source / target commands re-check the actor and expected Membership
 * version in their local transaction; target prepare holds the move
 * authorization lock, which removal / demotion of the member conflicts
 * with and which `activateTarget` / `abortBeforeSwitch` release. A move
 * may only abort before the route switch — afterwards recovery is
 * forward-only.
 *
 * **Nothing implements this port and nothing calls it.** The move that
 * ships drives the phases from the usecase
 * (`application/note/moveNote.ts`), one scope unit of work per phase,
 * because that is what keeps each phase's `AppliedOperationStore` receipt
 * inside the very transaction whose effects it claims — behind an adapter
 * the phase-to-transaction correspondence stops being something the type
 * can state. The port stays as the contract for the day a backend does
 * fold a phase into one transaction of its own; until then its five
 * signatures are a design intent, not a contract anyone is held to (no
 * conformance suite executes them).
 *
 * Error contract: `ConflictError` (stale membership / lock conflicts),
 * `SystemError(DatabaseError)`.
 */
export interface NoteMovePort {
  freezeSource(
    input: Readonly<{
      migrationId: string;
      noteId: NoteId;
      source: ScopeKey;
      target: ScopeKey;
      actorUserId: UserId;
      sourceMembershipVersion: number | null;
      excludingJobId: JobId | null;
    }>,
  ): Promise<NoteMoveSnapshot>;
  stageTarget(
    input: Readonly<{
      migrationId: string;
      target: ScopeKey;
      actorUserId: UserId;
      targetMembershipVersion: number | null;
      nextRouteVersion: number;
      snapshot: NoteMoveSnapshot;
    }>,
  ): Promise<void>;
  activateTarget(
    input: Readonly<{
      migrationId: string;
      target: ScopeKey;
      routeVersion: number;
    }>,
  ): Promise<void>;
  retireSource(
    input: Readonly<{
      migrationId: string;
      source: ScopeKey;
      routeVersion: number;
    }>,
  ): Promise<void>;
  /**
   * Idempotently reverses the pre-switch effects (target credit reversal,
   * staged data disposal, lock release, source thaw); refused when the
   * route already points at the target.
   */
  abortBeforeSwitch(
    input: Readonly<{
      migrationId: string;
      source: ScopeKey;
      target: ScopeKey;
    }>,
  ): Promise<void>;
}
