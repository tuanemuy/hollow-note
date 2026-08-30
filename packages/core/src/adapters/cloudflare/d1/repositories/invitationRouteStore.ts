import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type { TokenHash } from "../../../../domain/identity/valueObject";
import type {
  InvitationRouteStore,
  InvitationRouteTarget,
} from "../../../../domain/workspace/ports/invitationRouteStore";
import {
  InvitationId,
  WorkspaceId,
} from "../../../../domain/workspace/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { classifySqlError, databaseError } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import { date, enumOf, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.invitationRoutes;
const CONTEXT = "the invitation route store";

const STATES = ["reserved", "active", "revoked"] as const;
type RouteState = (typeof STATES)[number];

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

const lapsedReservation = (tokenHash: TokenHash): ConflictError =>
  new ConflictError(
    "INVITATION_ROUTE_CONFLICT",
    `Invitation route ${tokenHash} expired before it was activated`,
  );

const foreignInvitation = (
  tokenHash: TokenHash,
  invitationId: InvitationId,
): ConflictError =>
  new ConflictError(
    "INVITATION_ROUTE_CONFLICT",
    `Invitation route ${tokenHash} does not belong to invitation ${invitationId}`,
  );

type Route = Readonly<{
  workspaceId: WorkspaceId;
  invitationId: InvitationId;
  operationId: string;
  state: RouteState;
  expiresAt: Date;
  raw: SqlRow;
}>;

const toRoute = (row: SqlRow): Route => ({
  workspaceId: WorkspaceId.create(text(row, "workspace_id")),
  invitationId: InvitationId.create(text(row, "invitation_id")),
  operationId: text(row, "operation_id"),
  state: enumOf(row, "state", STATES),
  expiresAt: date(row, "expires_at"),
  raw: row,
});

export type D1InvitationRouteStoreDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
}>;

/**
 * `invitation_routes` on global D1.
 *
 * The token hash is the primary key, so the row *is* the token's global
 * uniqueness reservation and a collision surfaces as the same
 * `ConflictError` a foreign operation gets. Every transition decides its
 * branch from the row it just read and stages an `occGuard` repeating
 * that predicate, so a racing writer aborts the batch rather than having
 * a decision applied over a state that no longer holds.
 *
 * Closing is one-way: `revoke` and `consume` reach the same `revoked`
 * row and leave the issuing `operation_id` on it, which is what lets a
 * duplicate `activate` of that operation recognise its own row and
 * decline to reopen a token that has already been redeemed.
 */
export function createD1InvitationRouteStore(
  deps: D1InvitationRouteStoreDeps,
): InvitationRouteStore {
  const { session, clock } = deps;

  const read = async (tokenHash: TokenHash): Promise<Route | null> => {
    const row = await session.readRow({
      table: TABLE,
      key: tokenHash,
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE token_hash = ?`,
        tokenHash,
      ),
    });
    return row === null ? null : toRoute(row);
  };

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throw databaseError(CONTEXT, cause);
    }
  };

  /** Fence for "this token hash is still free". */
  const absentGuard = (tokenHash: TokenHash) =>
    opaque(
      occGuard(
        statement(
          `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE token_hash = ?)`,
          tokenHash,
        ),
      ),
    );

  const stateGuard = (
    tokenHash: TokenHash,
    operationId: string,
    state: RouteState,
  ) =>
    opaque(
      occGuard(
        statement(
          `SELECT 1 FROM ${TABLE} WHERE token_hash = ? AND operation_id = ? AND state = ?`,
          tokenHash,
          operationId,
          state,
        ),
      ),
    );

  const insertReservation = (
    input: Readonly<{
      tokenHash: TokenHash;
      workspaceId: WorkspaceId;
      invitationId: InvitationId;
      operationId: string;
      expiresAt: Date;
      now: Date;
    }>,
  ) => {
    const row: SqlRow = {
      token_hash: input.tokenHash,
      workspace_id: input.workspaceId,
      invitation_id: input.invitationId,
      operation_id: input.operationId,
      state: "reserved",
      expires_at: toTimestamp(input.expiresAt),
      updated_at: toTimestamp(input.now),
    };
    return upsert({
      table: TABLE,
      key: input.tokenHash,
      row,
      statement: statement(
        `INSERT INTO ${TABLE}
           (token_hash, workspace_id, invitation_id, operation_id, state, expires_at, updated_at)
         VALUES (?, ?, ?, ?, 'reserved', ?, ?)`,
        input.tokenHash,
        input.workspaceId,
        input.invitationId,
        input.operationId,
        toTimestamp(input.expiresAt),
        toTimestamp(input.now),
      ),
    });
  };

  const reserveFailure = (cause: unknown, tokenHash: TokenHash): unknown => {
    const failure = classifySqlError(cause);
    return failure === "occGuard" || failure === "unique"
      ? heldByAnother(tokenHash)
      : databaseError(CONTEXT, cause);
  };

  const close = async (
    input: Readonly<{
      tokenHash: TokenHash;
      invitationId: InvitationId;
      operationId: string;
    }>,
  ): Promise<void> => {
    const route = await read(input.tokenHash);
    // An absent row already satisfies the only obligation a close has —
    // that the token stops resolving. The workspace-local Invitation is
    // the record of what happened to the invitation itself.
    if (route === null) {
      return;
    }
    if (route.invitationId !== input.invitationId) {
      throw foreignInvitation(input.tokenHash, input.invitationId);
    }
    if (route.state === "revoked") {
      return;
    }
    const now = toTimestamp(clock.now());
    await write([
      upsert({
        table: TABLE,
        key: input.tokenHash,
        row: { ...route.raw, state: "revoked", updated_at: now },
        statement: statement(
          `UPDATE ${TABLE} SET state = 'revoked', updated_at = ? WHERE token_hash = ? AND state <> 'revoked'`,
          now,
          input.tokenHash,
        ),
      }),
    ]);
  };

  return {
    async resolveActive(
      tokenHash: TokenHash,
    ): Promise<InvitationRouteTarget | null> {
      const route = await read(tokenHash);
      // An expired route still resolves: the target scope's Invitation is
      // what an expired link is judged against, and a null here would
      // collapse "expired" into "never existed".
      if (route === null || route.state !== "active") {
        return null;
      }
      return {
        workspaceId: route.workspaceId,
        invitationId: route.invitationId,
      };
    },

    async reserve(input): Promise<void> {
      const existing = await read(input.tokenHash);
      if (existing !== null) {
        if (existing.operationId !== input.operationId) {
          throw heldByAnother(input.tokenHash);
        }
        return;
      }
      try {
        await session.write([
          absentGuard(input.tokenHash),
          insertReservation({ ...input, now: clock.now() }),
        ]);
      } catch (cause) {
        throw reserveFailure(cause, input.tokenHash);
      }
    },

    async activate(input): Promise<void> {
      const route = await read(input.tokenHash);
      if (route === null) {
        throw routeGone(input.tokenHash);
      }
      if (route.operationId !== input.operationId) {
        throw heldByAnother(input.tokenHash);
      }
      // Forward recovery must never hand a redeemed token back out, so a
      // row this operation has since closed stays closed.
      if (route.state !== "reserved") {
        return;
      }
      if (route.expiresAt.getTime() <= clock.now().getTime()) {
        throw lapsedReservation(input.tokenHash);
      }
      await write([
        stateGuard(input.tokenHash, input.operationId, "reserved"),
        upsert({
          table: TABLE,
          key: input.tokenHash,
          row: {
            ...route.raw,
            state: "active",
            updated_at: toTimestamp(clock.now()),
          },
          statement: statement(
            `UPDATE ${TABLE} SET state = 'active', updated_at = ? WHERE token_hash = ? AND operation_id = ? AND state = 'reserved'`,
            toTimestamp(clock.now()),
            input.tokenHash,
            input.operationId,
          ),
        }),
      ]);
    },

    async reserveReplacement(input): Promise<void> {
      const replacement = await read(input.newTokenHash);
      // Checked first so a repeat that arrives after the exchange landed
      // converges instead of failing on an old route it already closed.
      if (replacement !== null) {
        if (replacement.operationId !== input.operationId) {
          throw heldByAnother(input.newTokenHash);
        }
        return;
      }
      const old = await read(input.oldTokenHash);
      if (old === null || old.state !== "active") {
        throw routeGone(input.oldTokenHash);
      }
      if (old.invitationId !== input.invitationId) {
        throw foreignInvitation(input.oldTokenHash, input.invitationId);
      }
      try {
        await session.write([
          absentGuard(input.newTokenHash),
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${TABLE} WHERE token_hash = ? AND state = 'active' AND invitation_id = ?`,
                input.oldTokenHash,
                input.invitationId,
              ),
            ),
          ),
          insertReservation({
            tokenHash: input.newTokenHash,
            workspaceId: input.workspaceId,
            invitationId: input.invitationId,
            operationId: input.operationId,
            expiresAt: input.expiresAt,
            now: clock.now(),
          }),
        ]);
      } catch (cause) {
        throw reserveFailure(cause, input.newTokenHash);
      }
    },

    async activateReplacement(input): Promise<void> {
      const replacement = await read(input.newTokenHash);
      if (replacement === null) {
        throw routeGone(input.newTokenHash);
      }
      if (replacement.operationId !== input.operationId) {
        throw heldByAnother(input.newTokenHash);
      }
      const old = await read(input.oldTokenHash);
      if (replacement.state === "revoked") {
        // The replacement can no longer open, but an old route left
        // `active` would keep resolving to a cancelled invitation with
        // neither an expiry nor a call able to take it back.
        if (
          old !== null &&
          old.state === "active" &&
          old.invitationId === input.invitationId
        ) {
          const closedAt = toTimestamp(clock.now());
          await write([
            opaque(
              occGuard(
                statement(
                  `SELECT 1 FROM ${TABLE} WHERE token_hash = ? AND state = 'active' AND invitation_id = ?`,
                  input.oldTokenHash,
                  input.invitationId,
                ),
              ),
            ),
            upsert({
              table: TABLE,
              key: input.oldTokenHash,
              row: { ...old.raw, state: "revoked", updated_at: closedAt },
              statement: statement(
                `UPDATE ${TABLE} SET state = 'revoked', updated_at = ? WHERE token_hash = ? AND state = 'active' AND invitation_id = ?`,
                closedAt,
                input.oldTokenHash,
                input.invitationId,
              ),
            }),
          ]);
        }
        return;
      }
      if (
        replacement.state === "active" &&
        (old === null || old.state === "revoked")
      ) {
        return;
      }
      if (old === null || old.state !== "active") {
        throw routeGone(input.oldTokenHash);
      }
      if (old.invitationId !== input.invitationId) {
        throw foreignInvitation(input.oldTokenHash, input.invitationId);
      }
      const now = toTimestamp(clock.now());
      // One write-set, so a partial application cannot leave two live
      // tokens for one invitation or none at all.
      await write([
        opaque(
          occGuard(
            statement(
              `SELECT 1 FROM ${TABLE} WHERE token_hash = ? AND state = 'active' AND invitation_id = ?`,
              input.oldTokenHash,
              input.invitationId,
            ),
          ),
        ),
        upsert({
          table: TABLE,
          key: input.oldTokenHash,
          row: { ...old.raw, state: "revoked", updated_at: now },
          statement: statement(
            `UPDATE ${TABLE} SET state = 'revoked', updated_at = ? WHERE token_hash = ?`,
            now,
            input.oldTokenHash,
          ),
        }),
        upsert({
          table: TABLE,
          key: input.newTokenHash,
          row: { ...replacement.raw, state: "active", updated_at: now },
          statement: statement(
            `UPDATE ${TABLE} SET state = 'active', updated_at = ? WHERE token_hash = ? AND operation_id = ?`,
            now,
            input.newTokenHash,
            input.operationId,
          ),
        }),
      ]);
    },

    async abandon(input): Promise<void> {
      const route = await read(input.tokenHash);
      if (
        route === null ||
        route.operationId !== input.operationId ||
        route.state !== "reserved"
      ) {
        return;
      }
      await write([
        stateGuard(input.tokenHash, input.operationId, "reserved"),
        remove({
          table: TABLE,
          key: input.tokenHash,
          statement: statement(
            `DELETE FROM ${TABLE} WHERE token_hash = ? AND operation_id = ? AND state = 'reserved'`,
            input.tokenHash,
            input.operationId,
          ),
        }),
      ]);
    },

    revoke(input): Promise<void> {
      return close(input);
    },

    consume(input): Promise<void> {
      return close(input);
    },
  };
}
