import type {
  Pagination,
  PaginationResult,
} from "../../../../domain/common/pagination";
import type { Versioned } from "../../../../domain/common/transactionalRepository";
import type { Email, TokenHash } from "../../../../domain/identity/valueObject";
import { Invitation } from "../../../../domain/workspace/invitation";
import type { InvitationRepository } from "../../../../domain/workspace/ports/invitationRepository";
import type {
  InvitationId,
  WorkspaceId,
} from "../../../../domain/workspace/valueObject";
import { throwTranslated } from "../../sql/errors";
import {
  date,
  dateOrNull,
  int,
  text,
  textOrNull,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, type SqlValue, statement } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";
import {
  createAggregateStore,
  deleteAggregatesByIds,
} from "./workspaceAggregate";

const TABLE = SCOPE_TABLES.invitations;

const COLUMNS = [
  "id",
  "workspace_id",
  "email",
  "role",
  "invited_by",
  "token_hash",
  "status",
  "accepted_at",
  "accepted_by",
  "revoked_at",
  "version",
  "created_at",
  "expires_at",
] as const;

const toRow = (invitation: Invitation): SqlRow => ({
  id: invitation.id,
  workspace_id: invitation.workspaceId,
  email: invitation.email,
  role: invitation.role,
  invited_by: invitation.invitedBy,
  token_hash: invitation.tokenHash,
  status: invitation.status,
  accepted_at:
    invitation.status === "accepted"
      ? toTimestamp(invitation.acceptedAt)
      : null,
  accepted_by: invitation.status === "accepted" ? invitation.acceptedBy : null,
  revoked_at:
    invitation.status === "revoked" ? toTimestamp(invitation.revokedAt) : null,
  version: invitation.version,
  created_at: toTimestamp(invitation.createdAt),
  expires_at: toTimestamp(invitation.expiresAt),
});

const fromRow = (row: SqlRow): Invitation =>
  Invitation.reconstruct({
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    email: text(row, "email"),
    role: text(row, "role"),
    invitedBy: text(row, "invited_by"),
    tokenHash: text(row, "token_hash"),
    status: text(row, "status"),
    acceptedAt: dateOrNull(row, "accepted_at"),
    acceptedBy: textOrNull(row, "accepted_by"),
    revokedAt: dateOrNull(row, "revoked_at"),
    version: int(row, "version"),
    createdAt: date(row, "created_at"),
    expiresAt: date(row, "expires_at"),
  });

/**
 * `invitations` of one workspace scope
 * (`spec/database/index.md#invitations`).
 *
 * A status predicate is applied only in the methods that name it, and an
 * expiry one never is: a lapsed invitation still resolves and still
 * lists — including in `listPendingByWorkspace`, since expiry is not a
 * status — because `Invitation.isExpired` is the domain's answer against
 * the caller's `now`.
 */
export function createCloudflareInvitationRepository(
  deps: Readonly<{ session: SqlSession }>,
): InvitationRepository {
  const { session } = deps;
  const base = createAggregateStore<Invitation, InvitationId>(session, {
    table: TABLE,
    columns: COLUMNS,
    toRow,
    fromRow,
  });

  const findOne = async (
    where: string,
    params: readonly SqlValue[],
    matches: (row: SqlRow) => boolean,
  ): Promise<Versioned<Invitation> | null> => {
    try {
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT ${base.selection} FROM ${TABLE} WHERE ${where}`,
          ...params,
        ),
        keyOf: (row) => text(row, "id"),
        matches,
      });
      const row = rows[0];
      return row === undefined ? null : base.versioned(row);
    } catch (cause) {
      throwTranslated(`${TABLE} lookup`, cause);
    }
  };

  const listWhere = async (
    where: string,
    params: readonly SqlValue[],
    pagination: Pagination,
  ): Promise<PaginationResult<Invitation>> => {
    const limit = Math.max(0, pagination.limit);
    const offset = Math.max(0, (pagination.page - 1) * limit);
    try {
      const [items, totals] = await Promise.all([
        session.query(
          statement(
            `SELECT ${base.selection} FROM ${TABLE} WHERE ${where}
               ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
            ...params,
            limit,
            offset,
          ),
        ),
        session.query(
          statement(
            `SELECT COUNT(*) AS total FROM ${TABLE} WHERE ${where}`,
            ...params,
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
  };

  return {
    ...base,

    async findByTokenHash(
      tokenHash: TokenHash,
    ): Promise<Versioned<Invitation> | null> {
      return findOne(
        "token_hash = ?",
        [tokenHash],
        (row) => text(row, "token_hash") === tokenHash,
      );
    },

    async findPendingByWorkspaceAndEmail(
      workspaceId: WorkspaceId,
      email: Email,
    ): Promise<Versioned<Invitation> | null> {
      return findOne(
        "workspace_id = ? AND email = ? AND status = 'pending'",
        [workspaceId, email],
        (row) =>
          text(row, "workspace_id") === workspaceId &&
          text(row, "email") === email &&
          text(row, "status") === "pending",
      );
    },

    async listByWorkspace(
      workspaceId: WorkspaceId,
      pagination: Pagination,
    ): Promise<PaginationResult<Invitation>> {
      return listWhere("workspace_id = ?", [workspaceId], pagination);
    },

    async listPendingByWorkspace(
      workspaceId: WorkspaceId,
      pagination: Pagination,
    ): Promise<PaginationResult<Invitation>> {
      return listWhere(
        "workspace_id = ? AND status = 'pending'",
        [workspaceId],
        pagination,
      );
    },

    async countPendingIssuedSince(
      workspaceId: WorkspaceId,
      since: Date,
    ): Promise<number> {
      try {
        const rows = await session.query(
          statement(
            `SELECT COUNT(*) AS total FROM ${TABLE}
               WHERE workspace_id = ? AND status = 'pending' AND created_at >= ?`,
            workspaceId,
            toTimestamp(since),
          ),
        );
        return rows[0] === undefined ? 0 : int(rows[0], "total");
      } catch (cause) {
        throwTranslated(`${TABLE} quota count`, cause);
      }
    },

    async deleteByIds(ids: readonly InvitationId[]): Promise<number> {
      return deleteAggregatesByIds(session, TABLE, ids);
    },
  };
}
