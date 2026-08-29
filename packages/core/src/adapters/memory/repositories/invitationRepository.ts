import { SystemError, SystemErrorCode } from "../../../application/errors";
import type {
  Pagination,
  PaginationResult,
} from "../../../domain/common/pagination";
import type {
  ExpectedVersion,
  Versioned,
} from "../../../domain/common/transactionalRepository";
import type { Email, TokenHash } from "../../../domain/identity/valueObject";
import { Invitation } from "../../../domain/workspace/invitation";
import type { InvitationRepository } from "../../../domain/workspace/ports/invitationRepository";
import type {
  InvitationId,
  WorkspaceId,
} from "../../../domain/workspace/valueObject";
import type { ScopeStore } from "../store";
import { clone, compareStrings, createOccRepository } from "../support";

const MAX_DELETE_BATCH = 100;

export function createMemoryInvitationRepository(
  scope: ScopeStore,
): InvitationRepository {
  const table = scope.invitations;
  const base = createOccRepository<Invitation, InvitationId>(
    "invitations",
    table,
  );

  const versioned = (invitation: Invitation): Versioned<Invitation> => ({
    entity: clone(invitation),
    expectedVersion:
      invitation.version as number as ExpectedVersion<Invitation>,
  });

  return {
    ...base,

    async findByTokenHash(
      tokenHash: TokenHash,
    ): Promise<Versioned<Invitation> | null> {
      const found = table.values().find((row) => row.tokenHash === tokenHash);
      return found === undefined ? null : versioned(found);
    },

    async findPendingByWorkspaceAndEmail(
      workspaceId: WorkspaceId,
      email: Email,
    ): Promise<Versioned<Invitation> | null> {
      const found = table
        .values()
        .find(
          (row) =>
            row.workspaceId === workspaceId &&
            row.email === email &&
            Invitation.isPending(row),
        );
      return found === undefined ? null : versioned(found);
    },

    async listByWorkspace(
      workspaceId: WorkspaceId,
      pagination: Pagination,
    ): Promise<PaginationResult<Invitation>> {
      const matched = table
        .values()
        .filter((row) => row.workspaceId === workspaceId)
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            compareStrings(b.id, a.id),
        );
      const start = (pagination.page - 1) * pagination.limit;
      return {
        items: matched.slice(start, start + pagination.limit).map(clone),
        count: matched.length,
      };
    },

    async countPendingIssuedSince(
      workspaceId: WorkspaceId,
      since: Date,
    ): Promise<number> {
      return table
        .values()
        .filter(
          (row) =>
            row.workspaceId === workspaceId &&
            Invitation.isPending(row) &&
            row.createdAt.getTime() >= since.getTime(),
        ).length;
    },

    async deleteByIds(ids: readonly InvitationId[]): Promise<number> {
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
