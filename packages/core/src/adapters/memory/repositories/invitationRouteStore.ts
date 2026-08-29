import { ConflictError } from "../../../application/errors";
import type { TokenHash } from "../../../domain/identity/valueObject";
import type {
  InvitationRouteStore,
  InvitationRouteTarget,
} from "../../../domain/workspace/ports/invitationRouteStore";
import type { InvitationId } from "../../../domain/workspace/valueObject";
import type { InvitationRouteRow, MemoryBackend } from "../store";

const heldByAnother = (tokenHash: TokenHash): ConflictError =>
  new ConflictError(
    "INVITATION_ROUTE_CONFLICT",
    `Invitation route ${tokenHash} is held by another operation`,
  );

const routeGone = (tokenHash: TokenHash): ConflictError =>
  new ConflictError(
    "INVITATION_ROUTE_NOT_FOUND",
    `Invitation route ${tokenHash} does not exist`,
  );

const foreignInvitation = (
  tokenHash: TokenHash,
  invitationId: InvitationId,
): ConflictError =>
  new ConflictError(
    "INVITATION_ROUTE_CONFLICT",
    `Invitation route ${tokenHash} does not belong to invitation ${invitationId}`,
  );

export function createMemoryInvitationRouteStore(
  backend: MemoryBackend,
): InvitationRouteStore {
  const table = backend.invitationRoutes;

  const close = (
    input: Readonly<{
      tokenHash: TokenHash;
      invitationId: InvitationId;
      operationId: string;
    }>,
  ): void => {
    const row = table.get(input.tokenHash);
    // An absent row already satisfies the only obligation a close has —
    // that the token stops resolving. The workspace-local Invitation is
    // the record of what happened to the invitation itself.
    if (row === undefined) {
      return;
    }
    if (row.invitationId !== input.invitationId) {
      throw foreignInvitation(input.tokenHash, input.invitationId);
    }
    if (row.state === "revoked") {
      return;
    }
    // The issuing operation id stays on the row: a duplicate `activate`
    // of that operation must still recognize its own row and decline to
    // reopen it, rather than read it as held by someone else.
    table.set(input.tokenHash, { ...row, state: "revoked" });
  };

  return {
    async resolveActive(
      tokenHash: TokenHash,
    ): Promise<InvitationRouteTarget | null> {
      const row = table.get(tokenHash);
      if (
        row === undefined ||
        row.state !== "active" ||
        row.expiresAt.getTime() <= backend.clock.now().getTime()
      ) {
        return null;
      }
      return { workspaceId: row.workspaceId, invitationId: row.invitationId };
    },

    async reserve(input): Promise<void> {
      const existing = table.get(input.tokenHash);
      if (existing !== undefined) {
        if (existing.operationId !== input.operationId) {
          throw heldByAnother(input.tokenHash);
        }
        return;
      }
      table.set(input.tokenHash, {
        tokenHash: input.tokenHash,
        workspaceId: input.workspaceId,
        invitationId: input.invitationId,
        operationId: input.operationId,
        state: "reserved",
        expiresAt: input.expiresAt,
      });
    },

    async activate(input): Promise<void> {
      const row = table.get(input.tokenHash);
      if (row === undefined) {
        throw routeGone(input.tokenHash);
      }
      if (row.operationId !== input.operationId) {
        throw heldByAnother(input.tokenHash);
      }
      // Forward recovery must never hand a redeemed token back out, so a
      // row this operation has since closed stays closed.
      if (row.state !== "reserved") {
        return;
      }
      table.set(input.tokenHash, { ...row, state: "active" });
    },

    async reserveReplacement(input): Promise<void> {
      const replacement = table.get(input.newTokenHash);
      // Checked first so a repeat that arrives after the exchange landed
      // converges instead of failing on an old route it already closed.
      if (replacement !== undefined) {
        if (replacement.operationId !== input.operationId) {
          throw heldByAnother(input.newTokenHash);
        }
        return;
      }
      const old = table.get(input.oldTokenHash);
      if (old === undefined || old.state !== "active") {
        throw routeGone(input.oldTokenHash);
      }
      if (old.invitationId !== input.invitationId) {
        throw foreignInvitation(input.oldTokenHash, input.invitationId);
      }
      table.set(input.newTokenHash, {
        tokenHash: input.newTokenHash,
        workspaceId: input.workspaceId,
        invitationId: input.invitationId,
        operationId: input.operationId,
        state: "reserved",
        expiresAt: input.expiresAt,
      });
    },

    async activateReplacement(input): Promise<void> {
      const replacement = table.get(input.newTokenHash);
      if (replacement === undefined) {
        throw routeGone(input.newTokenHash);
      }
      if (replacement.operationId !== input.operationId) {
        throw heldByAnother(input.newTokenHash);
      }
      const old = table.get(input.oldTokenHash);
      if (replacement.state === "revoked") {
        return;
      }
      if (
        replacement.state === "active" &&
        (old === undefined || old.state === "revoked")
      ) {
        return;
      }
      if (old === undefined || old.state !== "active") {
        throw routeGone(input.oldTokenHash);
      }
      if (old.invitationId !== input.invitationId) {
        throw foreignInvitation(input.oldTokenHash, input.invitationId);
      }
      const applied: InvitationRouteRow = { ...replacement, state: "active" };
      table.set(input.oldTokenHash, { ...old, state: "revoked" });
      table.set(input.newTokenHash, applied);
    },

    async abandon(input): Promise<void> {
      const row = table.get(input.tokenHash);
      if (
        row === undefined ||
        row.operationId !== input.operationId ||
        row.state !== "reserved"
      ) {
        return;
      }
      table.delete(input.tokenHash);
    },

    async revoke(input): Promise<void> {
      close(input);
    },

    async consume(input): Promise<void> {
      close(input);
    },
  };
}
