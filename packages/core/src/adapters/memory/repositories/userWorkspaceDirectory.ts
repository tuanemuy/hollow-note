import { ValidationError } from "../../../application/errors";
import type { ShardPage } from "../../../domain/common/pagination";
import type { UserId } from "../../../domain/identity/valueObject";
import type {
  UserWorkspaceDirectory,
  UserWorkspaceEdge,
} from "../../../domain/workspace/ports/userWorkspaceDirectory";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../cursor";
import type { MembershipDirectoryRow, MemoryBackend } from "../store";
import { compareStrings } from "../support";

const MIN_LIMIT = 1;
const MAX_LIMIT = 20;
const MAX_COUNT_LIMIT = 100;

/** States a seat is taken in: settled, or reserved by an unsettled join. */
const OWNED_STATES: ReadonlySet<string> = new Set([
  "active",
  "pending",
  "activating",
]);

/** `${createdAt}:${workspaceId}` — the trailing key of the page. */
type KeysetPosition = Readonly<{ createdAt: number; workspaceId: string }>;

const encodePosition = (row: MembershipDirectoryRow): string =>
  `${row.createdAt.getTime()}:${row.workspaceId}`;

const decodePosition = (after: string): KeysetPosition => {
  const separator = after.indexOf(":");
  const createdAt =
    separator < 0 ? Number.NaN : Number(after.slice(0, separator));
  if (!Number.isFinite(createdAt)) {
    throw new ValidationError(
      "INVALID_PAGINATION",
      "Tampered or retired pagination cursor",
    );
  }
  return { createdAt, workspaceId: after.slice(separator + 1) };
};

/** `createdAt DESC, workspaceId ASC` — a total order over the edges. */
const compareEdges = (
  a: MembershipDirectoryRow,
  b: MembershipDirectoryRow,
): number =>
  b.createdAt.getTime() - a.createdAt.getTime() ||
  compareStrings(a.workspaceId, b.workspaceId);

const isAfter = (row: MembershipDirectoryRow, at: KeysetPosition): boolean =>
  row.createdAt.getTime() < at.createdAt ||
  (row.createdAt.getTime() === at.createdAt &&
    row.workspaceId > at.workspaceId);

export function createMemoryUserWorkspaceDirectory(
  backend: MemoryBackend,
): UserWorkspaceDirectory {
  return {
    async listActiveByUser(
      userId: UserId,
      cursor: string | null,
      limit: number,
    ): Promise<ShardPage<UserWorkspaceEdge>> {
      if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        throw new ValidationError(
          "INVALID_PAGINATION",
          `limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`,
        );
      }
      const fingerprint = `userWorkspaceDirectory:${userId}`;
      const after =
        cursor === null
          ? null
          : decodePosition(decodeOpaqueCursor(cursor, fingerprint).after);
      // The userId predicate is re-applied whatever cursor arrives: a
      // cursor says where a page starts, never what it may contain.
      const rows = backend.membershipEdges
        .values()
        .filter(
          (row) =>
            row.userId === userId &&
            row.edgeState === "active" &&
            (after === null || isAfter(row, after)),
        )
        .sort(compareEdges);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          workspaceId: row.workspaceId,
          role: row.role,
        })),
        nextCursor:
          rows.length > page.length && last !== undefined
            ? encodeOpaqueCursor({
                fp: fingerprint,
                after: encodePosition(last),
              })
            : null,
      };
    },

    async countOwnedByUser(userId: UserId, limit: number): Promise<number> {
      if (
        !Number.isInteger(limit) ||
        limit < MIN_LIMIT ||
        limit > MAX_COUNT_LIMIT
      ) {
        throw new ValidationError(
          "INVALID_PAGINATION",
          `limit must be between ${MIN_LIMIT} and ${MAX_COUNT_LIMIT}`,
        );
      }
      let owned = 0;
      for (const row of backend.membershipEdges.values()) {
        if (
          row.userId === userId &&
          row.role === "owner" &&
          OWNED_STATES.has(row.edgeState)
        ) {
          owned += 1;
          if (owned === limit) {
            break;
          }
        }
      }
      return owned;
    },
  };
}
