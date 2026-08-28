import { UserId } from "../../../domain/identity/valueObject";
import type {
  AuthorRedaction,
  NoteProjectionEntry,
  ProjectedTagName,
  ProjectionVersion,
  ProjectionWriteResult,
} from "../../../domain/note/ports/localNoteProjectionWriter";
import { WITHDRAWN_AUTHOR_DISPLAY_NAME } from "../../../domain/note/ports/localNoteProjectionWriter";
import type { NoteSummary } from "../../../domain/note/ports/localNoteQueryService";
import type { PublicNoteSummary } from "../../../domain/note/ports/publicNoteQueryService";
import { NoteId, NoteOwner } from "../../../domain/note/valueObject";
import { WorkspaceId } from "../../../domain/workspace/valueObject";
import { GLOBAL_TABLES } from "../d1/schema";
import { SCOPE_TABLES } from "../do/schema";
import { highlightExcerpt } from "../search/highlight";
import {
  bool,
  date,
  dateOrNull,
  enumOf,
  int,
  text,
  textOrNull,
  toBool,
  toTimestamp,
  toTimestampOrNull,
} from "../sql/row";
import type { SqlRow, SqlValue } from "../sql/statement";

/**
 * The `note_search*` triple, in the two places it exists.
 *
 * Local and public differ only in where they live and in the public
 * plane's extra `route_version` column
 * (`spec/database/index.md#public_note_search--public_note_search_tags--public_note_search_fts`:
 * 列・FTS 構成・bigram 前処理・同期契約は scope-local の `note_search*` と
 * 同じ), so the row mapping, the snapshot writer and the summary
 * projection are written once and parameterized by this descriptor.
 */
export type NoteSearchPlane = Readonly<{
  table: string;
  tagsTable: string;
  ftsTable: string;
  /** Public plane: the route generation is compared ahead of the vector. */
  routeVersioned: boolean;
}>;

export const LOCAL_NOTE_SEARCH: NoteSearchPlane = {
  table: SCOPE_TABLES.noteSearch,
  tagsTable: SCOPE_TABLES.noteSearchTags,
  ftsTable: SCOPE_TABLES.noteSearchFts,
  routeVersioned: false,
};

export const PUBLIC_NOTE_SEARCH: NoteSearchPlane = {
  table: GLOBAL_TABLES.publicNoteSearch,
  tagsTable: GLOBAL_TABLES.publicNoteSearchTags,
  ftsTable: GLOBAL_TABLES.publicNoteSearchFts,
  routeVersioned: true,
};

/**
 * Both tag columns are newline-joined, and the separator is fixed
 * (`spec/database/index.md#note_search`): `tag_names` is the input of the
 * `tag_names_fts` bigrams, and a CJK or alphanumeric separator would fuse
 * the tail of one tag with the head of the next into a single token.
 * `TagName` cannot contain a newline, so nothing fuses across this one.
 */
const TAG_SEPARATOR = "\n";

const VISIBILITIES = ["private", "unlisted", "public"] as const;
const CONTENT_STATUSES = [
  "processing",
  "awaitingIntegration",
  "failed",
  "ready",
] as const;
const STYLE_MODES = ["default", "preserve"] as const;
const LIFECYCLES = ["active", "trashed"] as const;
const OWNER_TYPES = ["user", "workspace"] as const;

const BASE_COLUMNS = [
  "note_id",
  "owner_type",
  "owner_id",
  "created_by",
  "title",
  "text",
  "excerpt",
  "tag_names",
  "tag_display_names",
  "visibility",
  "content_status",
  "style_mode",
  "has_source_file",
  "lifecycle",
  "author_display_name",
  "author_handle",
  "workspace_name",
  "workspace_slug",
  "workspace_published",
  "projection_revision",
  "author_version",
  "workspace_version",
  "created_at",
  "updated_at",
  "trashed_at",
  "purge_after",
] as const;

export const columnsOf = (plane: NoteSearchPlane): readonly string[] =>
  plane.routeVersioned ? [...BASE_COLUMNS, "route_version"] : BASE_COLUMNS;

/**
 * What a search page reads: every column but `text`.
 *
 * `text` is the projected body — up to 800,000 bytes a row (ADR 017) —
 * and no field of `NoteSummary` is built from it. Only the highlighter
 * ever needs it, and only for the rows whose excerpt held no match, so
 * those rows fetch a bounded prefix of it separately rather than every
 * row of the page carrying the whole body through a DO RPC or a D1
 * response.
 */
export const summaryColumns = (plane: NoteSearchPlane, alias: string): string =>
  columnsOf(plane)
    .filter((column) => column !== "text")
    .map((column) => `${alias}.${column}`)
    .join(", ");

export const ownerColumns = (
  owner: NoteOwner,
): Readonly<{ type: string; id: string }> =>
  owner.type === "user"
    ? { type: "user", id: owner.userId }
    : { type: "workspace", id: owner.workspaceId };

/**
 * The full projected row. Every column is written on every call — the
 * writer replaces a whole snapshot rather than patching fields, which is
 * what lets the generation vector be the only ordering rule.
 */
export function snapshotRow(
  plane: NoteSearchPlane,
  entry: NoteProjectionEntry,
  tags: readonly ProjectedTagName[],
  version: ProjectionVersion & Readonly<{ routeVersion?: number }>,
): SqlRow {
  const owner = ownerColumns(entry.owner);
  const base: Record<string, SqlValue> = {
    note_id: entry.noteId,
    owner_type: owner.type,
    owner_id: owner.id,
    created_by: entry.createdBy,
    title: entry.title,
    text: entry.text,
    excerpt: entry.excerpt,
    tag_names: tags.map((tag) => tag.normalized).join(TAG_SEPARATOR),
    tag_display_names: tags.map((tag) => tag.name).join(TAG_SEPARATOR),
    visibility: entry.visibility,
    content_status: entry.contentStatus,
    style_mode: entry.styleMode,
    has_source_file: toBool(entry.hasSourceFile),
    lifecycle: entry.lifecycle,
    author_display_name: entry.author.displayName,
    author_handle: entry.author.handle,
    workspace_name: entry.workspace?.name ?? null,
    workspace_slug: entry.workspace?.slug ?? null,
    workspace_published: toBool(entry.workspace?.published ?? false),
    projection_revision: version.projectionRevision,
    author_version: version.authorVersion,
    workspace_version: version.workspaceVersion,
    created_at: toTimestamp(entry.createdAt),
    updated_at: toTimestamp(entry.updatedAt),
    trashed_at: toTimestampOrNull(entry.trashedAt),
    purge_after: toTimestampOrNull(entry.purgeAfter),
  };
  return plane.routeVersioned
    ? { ...base, route_version: version.routeVersion ?? 0 }
    : base;
}

const decodeOwner = (row: SqlRow): NoteOwner => {
  const id = text(row, "owner_id");
  return enumOf(row, "owner_type", OWNER_TYPES) === "user"
    ? NoteOwner.user(UserId.create(id))
    : NoteOwner.workspace(WorkspaceId.create(id));
};

export function decodeEntry(row: SqlRow): NoteProjectionEntry {
  const workspaceName = textOrNull(row, "workspace_name");
  return {
    noteId: NoteId.create(text(row, "note_id")),
    owner: decodeOwner(row),
    createdBy: UserId.create(text(row, "created_by")),
    author: {
      displayName: text(row, "author_display_name"),
      handle: textOrNull(row, "author_handle"),
      version: int(row, "author_version"),
    },
    workspace:
      workspaceName === null
        ? null
        : {
            name: workspaceName,
            slug: textOrNull(row, "workspace_slug"),
            published: bool(row, "workspace_published"),
            version: int(row, "workspace_version"),
          },
    title: text(row, "title"),
    text: text(row, "text"),
    excerpt: text(row, "excerpt"),
    visibility: enumOf(row, "visibility", VISIBILITIES),
    contentStatus: enumOf(row, "content_status", CONTENT_STATUSES),
    styleMode: enumOf(row, "style_mode", STYLE_MODES),
    hasSourceFile: bool(row, "has_source_file"),
    lifecycle: enumOf(row, "lifecycle", LIFECYCLES),
    createdAt: date(row, "created_at"),
    updatedAt: date(row, "updated_at"),
    trashedAt: dateOrNull(row, "trashed_at"),
    purgeAfter: dateOrNull(row, "purge_after"),
  };
}

const splitTagColumn = (value: string): readonly string[] =>
  value.length === 0 ? [] : value.split(TAG_SEPARATOR);

/**
 * Display and normalized names come back out of the two joined columns
 * rather than out of `note_search_tags`, which carries no display name:
 * the writer builds both from one array, so index `i` is the same tag on
 * both sides.
 */
export function decodeTags(row: SqlRow): readonly ProjectedTagName[] {
  const names = splitTagColumn(text(row, "tag_display_names"));
  const normalized = splitTagColumn(text(row, "tag_names"));
  return normalized.map((value, index) => ({
    name: names[index] ?? value,
    normalized: value,
  }));
}

export function toSummary(row: SqlRow, keyword: string | null): NoteSummary {
  const excerpt = text(row, "excerpt");
  return {
    id: text(row, "note_id"),
    title: text(row, "title"),
    excerpt,
    highlightedExcerpt:
      keyword === null ? null : highlightExcerpt(excerpt, keyword),
    visibility: enumOf(row, "visibility", VISIBILITIES),
    contentStatus: enumOf(row, "content_status", CONTENT_STATUSES),
    styleMode: enumOf(row, "style_mode", STYLE_MODES),
    ownerType: enumOf(row, "owner_type", OWNER_TYPES),
    ownerId: text(row, "owner_id"),
    createdBy: text(row, "created_by"),
    tagNames: splitTagColumn(text(row, "tag_display_names")),
    hasSourceFile: bool(row, "has_source_file"),
    createdAt: date(row, "created_at"),
    updatedAt: date(row, "updated_at"),
    trashedAt: dateOrNull(row, "trashed_at"),
    purgeAfter: dateOrNull(row, "purge_after"),
  };
}

export function toPublicSummary(
  row: SqlRow,
  keyword: string | null,
): PublicNoteSummary {
  return {
    ...toSummary(row, keyword),
    authorHandle: textOrNull(row, "author_handle"),
    authorDisplayName: text(row, "author_display_name"),
    workspaceSlug: textOrNull(row, "workspace_slug"),
    workspaceName: textOrNull(row, "workspace_name"),
  };
}

/**
 * `written` when every component is >= the stored one and at least one is
 * greater, `stale` when every component is <=, and `incomparable`
 * otherwise — a mixed ordering means the sources were read across a
 * concurrent update, and the consumer re-reads them all rather than
 * publishing a snapshot that is partly behind.
 */
export function compareVectors(
  next: ProjectionVersion,
  stored: SqlRow,
): ProjectionWriteResult {
  const deltas = [
    next.projectionRevision - int(stored, "projection_revision"),
    next.authorVersion - int(stored, "author_version"),
    next.workspaceVersion - int(stored, "workspace_version"),
  ];
  if (
    deltas.every((delta) => delta >= 0) &&
    deltas.some((delta) => delta > 0)
  ) {
    return "written";
  }
  return deltas.every((delta) => delta <= 0) ? "stale" : "incomparable";
}

/**
 * The row a redaction leaves behind, or `null` when the row must stay as
 * it is: absent, written by someone else, or already published at this
 * redaction generation or later. Those three no-ops are what make the
 * at-least-once fan-out converge.
 */
export function redactedRow(
  stored: SqlRow | null,
  input: AuthorRedaction,
): SqlRow | null {
  if (
    stored === null ||
    text(stored, "created_by") !== input.createdBy ||
    int(stored, "author_version") >= input.redactionVersion
  ) {
    return null;
  }
  return {
    ...stored,
    author_display_name: WITHDRAWN_AUTHOR_DISPLAY_NAME,
    author_handle: null,
    author_version: input.redactionVersion,
  };
}
