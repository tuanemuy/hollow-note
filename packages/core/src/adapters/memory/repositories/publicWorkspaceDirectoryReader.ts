import {
  SystemError,
  SystemErrorCode,
  ValidationError,
} from "../../../application/errors";
import type { ShardPage } from "../../../domain/common/pagination";
import type {
  PublicWorkspaceDirectoryReader,
  PublicWorkspaceEntry,
} from "../../../domain/workspace/ports/publicWorkspaceDirectoryReader";
import type { WorkspaceSlug } from "../../../domain/workspace/valueObject";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../cursor";
import type { MemoryBackend, WorkspaceDirectoryRow } from "../store";
import { compareStrings } from "../support";

const MIN_LIMIT = 1;
const MAX_LIMIT = 200;
const FINGERPRINT = "publicWorkspaceDirectory:published";

type KeysetPosition = Readonly<{ updatedAt: number; workspaceId: string }>;

const invalidPagination = (message: string): ValidationError =>
  new ValidationError("INVALID_PAGINATION", message);

const encodePosition = (row: WorkspaceDirectoryRow): string =>
  `${row.updatedAt.getTime()}:${row.workspaceId}`;

const decodePosition = (after: string): KeysetPosition => {
  const separator = after.indexOf(":");
  const updatedAt =
    separator < 0 ? Number.NaN : Number(after.slice(0, separator));
  if (!Number.isFinite(updatedAt)) {
    throw invalidPagination("Tampered or retired pagination cursor");
  }
  return { updatedAt, workspaceId: after.slice(separator + 1) };
};

/**
 * A row the public enumeration may return. The slug narrowing is what
 * keeps `PublicWorkspaceEntry.slug` non-null without a cast — a
 * published row without one is a broken projection, not a page item.
 */
type PublishedRow = WorkspaceDirectoryRow & Readonly<{ slug: WorkspaceSlug }>;

const isPublished = (row: WorkspaceDirectoryRow): row is PublishedRow =>
  row.publication === "published" &&
  row.lifecycle === "active" &&
  row.slug !== null;

/** `updatedAt DESC, workspaceId ASC` — a total order over the shards. */
const compareRows = (
  a: WorkspaceDirectoryRow,
  b: WorkspaceDirectoryRow,
): number =>
  b.updatedAt.getTime() - a.updatedAt.getTime() ||
  compareStrings(a.workspaceId, b.workspaceId);

const isAfter = (row: WorkspaceDirectoryRow, at: KeysetPosition): boolean =>
  row.updatedAt.getTime() < at.updatedAt ||
  (row.updatedAt.getTime() === at.updatedAt &&
    row.workspaceId > at.workspaceId);

export function createMemoryPublicWorkspaceDirectoryReader(
  backend: MemoryBackend,
): PublicWorkspaceDirectoryReader {
  return {
    async listPublished(
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<PublicWorkspaceEntry>> {
      if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        throw invalidPagination(
          `limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`,
        );
      }
      if (backend.workspaceDirectoryOutages.size > 0) {
        // A short page is indistinguishable from a complete one, and the
        // page type has no degraded variant, so an unreadable shard has
        // to fail the whole enumeration.
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          "A workspace directory shard is unreadable",
        );
      }
      const after =
        cursor === null
          ? null
          : decodePosition(decodeOpaqueCursor(cursor, FINGERPRINT).after);
      const rows = backend.workspaceDirectory
        .values()
        .filter(
          (row): row is PublishedRow =>
            isPublished(row) && (after === null || isAfter(row, after)),
        )
        .sort(compareRows);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          workspaceId: row.workspaceId,
          slug: row.slug,
          updatedAt: new Date(row.updatedAt.getTime()),
        })),
        nextCursor:
          rows.length > page.length && last !== undefined
            ? encodeOpaqueCursor({
                fp: FINGERPRINT,
                after: encodePosition(last),
              })
            : null,
      };
    },
  };
}
