import { ConflictError } from "../../../../application/errors";
import type {
  Pagination,
  PaginationResult,
} from "../../../../domain/common/pagination";
import type { Versioned } from "../../../../domain/common/transactionalRepository";
import type { UserId } from "../../../../domain/identity/valueObject";
import { Membership } from "../../../../domain/workspace/membership";
import type { MembershipRepository } from "../../../../domain/workspace/ports/membershipRepository";
import type {
  MembershipId,
  WorkspaceId,
  WorkspaceRole,
} from "../../../../domain/workspace/valueObject";
import { throwTranslated } from "../../sql/errors";
import { date, int, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";
import {
  createAggregateStore,
  deleteAggregatesByIds,
} from "./workspaceAggregate";

const TABLE = SCOPE_TABLES.memberships;

const COLUMNS = [
  "id",
  "workspace_id",
  "user_id",
  "role",
  "version",
  "joined_at",
  "updated_at",
] as const;

const toRow = (membership: Membership): SqlRow => ({
  id: membership.id,
  workspace_id: membership.workspaceId,
  user_id: membership.userId,
  role: membership.role,
  version: membership.version,
  joined_at: toTimestamp(membership.joinedAt),
  updated_at: toTimestamp(membership.updatedAt),
});

const fromRow = (row: SqlRow): Membership =>
  Membership.reconstruct({
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    userId: text(row, "user_id"),
    role: text(row, "role"),
    version: int(row, "version"),
    joinedAt: date(row, "joined_at"),
    updatedAt: date(row, "updated_at"),
  });

/**
 * `memberships` of one workspace scope — the authorization source of
 * truth.
 *
 * `insert` resolves the `(workspace_id, user_id)` pair through the same
 * overlay-aware read the port's own `findByWorkspaceAndUser` uses, so a
 * duplicate staged earlier in the same unit of work is caught before the
 * unique index would trip at commit — a constraint violation there is a
 * driver fault with no conflict code, and the contract wants
 * `MEMBERSHIP_ALREADY_EXISTS`.
 */
export function createCloudflareMembershipRepository(
  deps: Readonly<{ session: SqlSession }>,
): MembershipRepository {
  const { session } = deps;
  const base = createAggregateStore<Membership, MembershipId>(session, {
    table: TABLE,
    columns: COLUMNS,
    toRow,
    fromRow,
  });

  const rowFor = async (
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<SqlRow | null> => {
    const matches = (row: SqlRow): boolean =>
      text(row, "workspace_id") === workspaceId &&
      text(row, "user_id") === userId;
    const rows = await session.readRows({
      table: TABLE,
      statement: statement(
        `SELECT ${base.selection} FROM ${TABLE} WHERE workspace_id = ? AND user_id = ?`,
        workspaceId,
        userId,
      ),
      keyOf: (row) => text(row, "id"),
      matches,
    });
    return rows[0] ?? null;
  };

  /**
   * The last-owner invariant is decided on this number inside the
   * transaction that changes a role, so it materialises the rows instead
   * of asking for a `COUNT(*)`: an aggregate is computed over storage and
   * would miss the role change, insert or delete the same unit of work
   * has already staged. The sets it counts are one workspace's members
   * holding one role.
   */
  const countByRoleIn = async (
    workspaceId: WorkspaceId,
    role: WorkspaceRole,
  ): Promise<number> => {
    const rows = await session.readRows({
      table: TABLE,
      statement: statement(
        `SELECT ${base.selection} FROM ${TABLE} WHERE workspace_id = ? AND role = ?`,
        workspaceId,
        role,
      ),
      keyOf: (row) => text(row, "id"),
      matches: (row) =>
        text(row, "workspace_id") === workspaceId && text(row, "role") === role,
    });
    return rows.length;
  };

  return {
    ...base,

    async insert(membership: Membership): Promise<void> {
      const taken = await rowFor(membership.workspaceId, membership.userId);
      if (taken !== null) {
        throw new ConflictError(
          "MEMBERSHIP_ALREADY_EXISTS",
          `User ${membership.userId} already belongs to workspace ${membership.workspaceId}`,
        );
      }
      await base.insert(membership);
    },

    async findByWorkspaceAndUser(
      workspaceId: WorkspaceId,
      userId: UserId,
    ): Promise<Versioned<Membership> | null> {
      const row = await rowFor(workspaceId, userId);
      return row === null ? null : base.versioned(row);
    },

    async listByWorkspace(
      workspaceId: WorkspaceId,
      pagination: Pagination,
    ): Promise<PaginationResult<Membership>> {
      const limit = Math.max(0, pagination.limit);
      const offset = Math.max(0, (pagination.page - 1) * limit);
      try {
        // Straight to storage rather than overlay-aware, for the reason
        // `noteRepository.listByOwner` gives: an offset page cannot be
        // merged with staged rows without re-reading the whole set. The
        // port says so too — this is the one read of the contract that
        // does not observe its own unit of work, which is why the
        // deletion sweep probes for leftovers in a turn that stages no
        // delete of its own.
        const [items, totals] = await Promise.all([
          session.query(
            statement(
              `SELECT ${base.selection} FROM ${TABLE} WHERE workspace_id = ?
                 ORDER BY joined_at, id LIMIT ? OFFSET ?`,
              workspaceId,
              limit,
              offset,
            ),
          ),
          session.query(
            statement(
              `SELECT COUNT(*) AS total FROM ${TABLE} WHERE workspace_id = ?`,
              workspaceId,
            ),
          ),
        ]);
        return {
          items: items.map(fromRow),
          count: totals[0] === undefined ? 0 : int(totals[0], "total"),
        };
      } catch (cause) {
        throwTranslated(`${TABLE} listing`, cause);
      }
    },

    async countByRole(
      workspaceId: WorkspaceId,
      role: WorkspaceRole,
    ): Promise<number> {
      try {
        return await countByRoleIn(workspaceId, role);
      } catch (cause) {
        throwTranslated(`${TABLE} role count`, cause);
      }
    },

    async deleteByIds(ids: readonly MembershipId[]): Promise<number> {
      return deleteAggregatesByIds(session, TABLE, ids);
    },
  };
}
