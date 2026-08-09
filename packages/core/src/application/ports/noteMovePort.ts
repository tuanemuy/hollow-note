import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { JobId } from "@repo/core/domain/job/valueObject";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { ScopeKey } from "../scope";

/**
 * Frozen transfer payload of a move: Note / revisions, tag names
 * (display + normalized), source / media / reference StoredFile
 * metadata, BackupRecord, and the Usage delta. R2 bytes never move.
 * Declared opaque here — the concrete field layout is fixed by the move
 * slice together with its adapter; this slice only pins the port
 * signatures (DOM-note-066..070).
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
 * Port definition only in the walking-skeleton slice — implementation
 * ships with the move slice.
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
