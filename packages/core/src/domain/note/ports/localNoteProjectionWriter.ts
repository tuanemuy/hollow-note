import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteId, NoteOwner } from "../valueObject";

/**
 * Generation vector used for projection ordering. Within one route /
 * scope generation, a writer replaces the stored snapshot only when every
 * component is >= the stored value and at least one is greater.
 */
export type ProjectionVersion = Readonly<{
  projectionRevision: number;
  authorVersion: number;
  /** 0 for personal notes. */
  workspaceVersion: number;
}>;

/** `TagName` display name and normalized name. */
export type ProjectedTagName = Readonly<{ name: string; normalized: string }>;

export type NoteProjectionEntry = Readonly<{
  noteId: NoteId;
  owner: NoteOwner;
  createdBy: UserId;
  author: Readonly<{
    displayName: string;
    handle: string | null;
    version: number;
  }>;
  /** Required when `owner.type === "workspace"`, `null` for user-owned notes. */
  workspace: Readonly<{
    name: string;
    slug: string | null;
    published: boolean;
    version: number;
  }> | null;
  title: string;
  text: string;
  excerpt: string;
  visibility: "private" | "unlisted" | "public";
  contentStatus: "processing" | "awaitingIntegration" | "failed" | "ready";
  styleMode: "default" | "preserve";
  hasSourceFile: boolean;
  lifecycle: "active" | "trashed";
  createdAt: Date;
  updatedAt: Date;
  trashedAt: Date | null;
  purgeAfter: Date | null;
}>;

export type ProjectionWriteResult = "written" | "stale" | "incomparable";

/**
 * Full-snapshot replacement of a note's row in the local read model,
 * called from the owner scope's scheduled task / Alarm. One call updates
 * the search row, its display tag names, the tag filter rows, and the
 * FTS index in the same transaction ("tag column contract" in
 * spec/database). `stale` = every vector component <= stored;
 * `incomparable` = mixed ordering (read-write race) — the consumer
 * re-reads all sources and retries once before deferring to Queue/Alarm
 * retry.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface LocalNoteProjectionWriter {
  replaceSnapshotIfNewer(
    entry: NoteProjectionEntry,
    tags: readonly ProjectedTagName[],
    version: ProjectionVersion,
  ): Promise<ProjectionWriteResult>;
  /** Removes the search row, FTS row, and tag filter rows for the note. */
  remove(noteId: NoteId): Promise<void>;
}
