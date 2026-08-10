import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { ScopeKey } from "../scope";

/**
 * Global routing row for a note. `reserved` (creation in flight) and
 * `purging` never resolve for external reads; `tombstone` marks a
 * completed purge until its expiry.
 */
export type NoteRoute = Readonly<{
  noteId: NoteId;
  scope: ScopeKey;
  createdBy: UserId;
  routeVersion: number;
  state: "reserved" | "active" | "moving" | "purging" | "tombstone";
  target: ScopeKey | null;
  migrationId: string | null;
}>;

/**
 * Saga-style routing store (application port — it deals in `ScopeKey`,
 * which domain entities never see; spec/domains/note.md places it here).
 *
 * Creation: `reserveCreate` (TTL'd) → scope UoW commit → `activateCreate`;
 * a failed commit calls `abandonCreate`, a lost activate response retries
 * with the same `operationId` (all three are idempotent per operation).
 * Move: `beginMove` (CAS on `expectedRouteVersion`) → `switchMove` flips
 * to the target, or `abortMove` (pre-switch only) returns to the source.
 * Purge: `beginPurge` closes external reach; before the local delete only
 * the same operation's `abortPurge` may reopen (`purging → active`);
 * after it, recovery is forward-only through `finishPurge`, which leaves
 * an expiring tombstone.
 *
 * Error contract: `ConflictError("STALE_SCOPE_ROUTE")` (routeVersion CAS
 * miss), `ConflictError` (state-machine violation / foreign operation),
 * `NotFoundError("NOTE_NOT_FOUND")`, `SystemError(DatabaseError)` — the
 * latter also covers a `resolveMany` batch over the 500-id cap, which is
 * a caller programming error rather than a concurrent-state conflict
 * (same contract as `UserBatchReader.resolveMany`).
 */
export interface NoteRouteStore {
  /** Externally readable routes only (`reserved` / `purging` do not resolve). */
  resolve(noteId: NoteId): Promise<NoteRoute | null>;
  /**
   * Max 500 ids, grouped per shard and read in bounded waves; during a
   * cutover both generations are read and the higher routeVersion wins.
   */
  resolveMany(
    noteIds: readonly NoteId[],
  ): Promise<ReadonlyMap<NoteId, NoteRoute>>;
  reserveCreate(
    input: Readonly<{
      noteId: NoteId;
      scope: ScopeKey;
      createdBy: UserId;
      operationId: string;
      expiresAt: Date;
    }>,
  ): Promise<NoteRoute>;
  activateCreate(
    input: Readonly<{ noteId: NoteId; operationId: string }>,
  ): Promise<NoteRoute>;
  abandonCreate(
    input: Readonly<{ noteId: NoteId; operationId: string }>,
  ): Promise<void>;
  beginMove(
    input: Readonly<{
      noteId: NoteId;
      expectedRouteVersion: number;
      target: ScopeKey;
      migrationId: string;
    }>,
  ): Promise<NoteRoute>;
  abortMove(
    input: Readonly<{
      noteId: NoteId;
      migrationId: string;
      expectedRouteVersion: number;
    }>,
  ): Promise<NoteRoute>;
  switchMove(
    input: Readonly<{
      noteId: NoteId;
      migrationId: string;
      expectedRouteVersion: number;
    }>,
  ): Promise<NoteRoute>;
  beginPurge(
    input: Readonly<{
      noteId: NoteId;
      scope: ScopeKey;
      expectedRouteVersion: number;
      operationId: string;
    }>,
  ): Promise<NoteRoute>;
  abortPurge(
    input: Readonly<{
      noteId: NoteId;
      operationId: string;
      expectedRouteVersion: number;
    }>,
  ): Promise<NoteRoute>;
  finishPurge(
    input: Readonly<{ noteId: NoteId; operationId: string; expiresAt: Date }>,
  ): Promise<NoteRoute>;
}
