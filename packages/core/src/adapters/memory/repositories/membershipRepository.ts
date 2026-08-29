import {
  ConflictError,
  SystemError,
  SystemErrorCode,
} from "../../../application/errors";
import type {
  Pagination,
  PaginationResult,
} from "../../../domain/common/pagination";
import type {
  ExpectedVersion,
  Versioned,
} from "../../../domain/common/transactionalRepository";
import type { UserId } from "../../../domain/identity/valueObject";
import type { Membership } from "../../../domain/workspace/membership";
import type { MembershipRepository } from "../../../domain/workspace/ports/membershipRepository";
import type {
  MembershipId,
  WorkspaceId,
  WorkspaceRole,
} from "../../../domain/workspace/valueObject";
import type { ScopeStore } from "../store";
import { clone, compareStrings, createOccRepository } from "../support";

const MAX_DELETE_BATCH = 100;

export function createMemoryMembershipRepository(
  scope: ScopeStore,
): MembershipRepository {
  const table = scope.memberships;
  const base = createOccRepository<Membership, MembershipId>(
    "memberships",
    table,
  );

  const byWorkspace = (workspaceId: WorkspaceId): readonly Membership[] =>
    table.values().filter((row) => row.workspaceId === workspaceId);

  return {
    ...base,

    async insert(membership: Membership): Promise<void> {
      const taken = table
        .values()
        .some(
          (row) =>
            row.workspaceId === membership.workspaceId &&
            row.userId === membership.userId,
        );
      if (taken) {
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
      const found = table
        .values()
        .find(
          (row) => row.workspaceId === workspaceId && row.userId === userId,
        );
      if (found === undefined) {
        return null;
      }
      return {
        entity: clone(found),
        expectedVersion: found.version as number as ExpectedVersion<Membership>,
      };
    },

    async listByWorkspace(
      workspaceId: WorkspaceId,
      pagination: Pagination,
    ): Promise<PaginationResult<Membership>> {
      const matched = [...byWorkspace(workspaceId)].sort(
        (a, b) =>
          a.joinedAt.getTime() - b.joinedAt.getTime() ||
          compareStrings(a.id, b.id),
      );
      const start = (pagination.page - 1) * pagination.limit;
      return {
        items: matched.slice(start, start + pagination.limit).map(clone),
        count: matched.length,
      };
    },

    async countByRole(
      workspaceId: WorkspaceId,
      role: WorkspaceRole,
    ): Promise<number> {
      return byWorkspace(workspaceId).filter((row) => row.role === role).length;
    },

    async deleteByIds(ids: readonly MembershipId[]): Promise<number> {
      if (ids.length > MAX_DELETE_BATCH) {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          `deleteByIds accepts at most ${MAX_DELETE_BATCH} ids`,
        );
      }
      let deleted = 0;
      for (const id of ids) {
        if (table.delete(id)) {
          deleted += 1;
        }
      }
      return deleted;
    },
  };
}
