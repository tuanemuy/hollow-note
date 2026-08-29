import { ConflictError } from "../../../../application/errors";
import type { Clock } from "../../../../application/ports/clock";
import type { WorkspaceSlugReservationStore } from "../../../../domain/workspace/ports/workspaceSlugReservationStore";
import {
  WorkspaceId,
  type WorkspaceSlug,
} from "../../../../domain/workspace/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { classifySqlError, databaseError } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import {
  dateOrNull,
  enumOf,
  text,
  textOrNull,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { type SqlRow, statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";

const TABLE = GLOBAL_TABLES.workspaceSlugReservations;
const CONTEXT = "the workspace slug reservation store";

const STATES = ["reserved", "active", "releasing"] as const;
type ReservationState = (typeof STATES)[number];

const alreadyUsed = (slug: WorkspaceSlug): ConflictError =>
  new ConflictError("SLUG_ALREADY_USED", `Workspace slug ${slug} is taken`);

const reservationGone = (slug: WorkspaceSlug): ConflictError =>
  new ConflictError(
    "SLUG_RESERVATION_NOT_FOUND",
    `No slug reservation for ${slug}`,
  );

type Reservation = Readonly<{
  workspaceId: WorkspaceId;
  operationId: string;
  attemptId: string | null;
  state: ReservationState;
  expiresAt: Date | null;
  raw: SqlRow;
}>;

const toReservation = (row: SqlRow): Reservation => ({
  workspaceId: WorkspaceId.create(text(row, "workspace_id")),
  operationId: text(row, "operation_id"),
  attemptId: textOrNull(row, "attempt_id"),
  state: enumOf(row, "state", STATES),
  expiresAt: dateOrNull(row, "expires_at"),
  raw: row,
});

export type D1WorkspaceSlugReservationStoreDeps = Readonly<{
  session: SqlSession;
  clock: Clock;
}>;

/**
 * `workspace_slug_reservations` on global D1
 * (`spec/database/index.md#workspace_slug_reservations`).
 *
 * A `WorkspaceSlug` is lower-cased by its own constructor, so the value
 * handed in *is* `normalized_slug` and nothing here normalizes again.
 *
 * Only a `reserved` row carries an expiry, which is the whole of the
 * "ownership never transfers on expiry alone" rule: an `active` row has
 * `expires_at IS NULL` and is freed only by `activate(releasing)` or
 * `release`. The exchange those two perform is one write-set, so no
 * window exists in which both slugs resolve or neither does.
 */
export function createD1WorkspaceSlugReservationStore(
  deps: D1WorkspaceSlugReservationStoreDeps,
): WorkspaceSlugReservationStore {
  const { session, clock } = deps;

  const read = async (slug: WorkspaceSlug): Promise<Reservation | null> => {
    const row = await session.readRow({
      table: TABLE,
      key: slug,
      statement: statement(
        `SELECT * FROM ${TABLE} WHERE normalized_slug = ?`,
        slug,
      ),
    });
    return row === null ? null : toReservation(row);
  };

  const write = async (mutations: readonly RowMutation[]): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throw databaseError(CONTEXT, cause);
    }
  };

  /**
   * The release half of `activate` and the whole of `release`: a slug is
   * given up only while it is `active` for the workspace giving it up, so
   * a delayed teardown can never take a key away from its successor.
   */
  const releaseHeldBy = (
    slug: WorkspaceSlug,
    workspaceId: WorkspaceId,
  ): RowMutation =>
    remove({
      table: TABLE,
      key: slug,
      statement: statement(
        `DELETE FROM ${TABLE} WHERE normalized_slug = ? AND state = 'active' AND workspace_id = ?`,
        slug,
        workspaceId,
      ),
    });

  return {
    async resolveActive(slug: WorkspaceSlug): Promise<WorkspaceId | null> {
      const row = await read(slug);
      return row !== null && row.state === "active" ? row.workspaceId : null;
    },

    async reserve(input): Promise<void> {
      const now = clock.now();
      const existing = await read(input.slug);
      if (existing !== null) {
        if (existing.operationId === input.operationId) {
          if (existing.state === "reserved") {
            await write([
              opaque(
                occGuard(
                  statement(
                    `SELECT 1 FROM ${TABLE} WHERE normalized_slug = ? AND operation_id = ? AND state = 'reserved'`,
                    input.slug,
                    input.operationId,
                  ),
                ),
              ),
              upsert({
                table: TABLE,
                key: input.slug,
                row: {
                  ...existing.raw,
                  attempt_id: input.attemptId,
                  expires_at: toTimestamp(input.expiresAt),
                },
                statement: statement(
                  `UPDATE ${TABLE} SET attempt_id = ?, expires_at = ? WHERE normalized_slug = ? AND operation_id = ? AND state = 'reserved'`,
                  input.attemptId,
                  toTimestamp(input.expiresAt),
                  input.slug,
                  input.operationId,
                ),
              }),
            ]);
          }
          return;
        }
        // The workspace already owns the key durably; re-keying it to
        // this operation lets `activate` find it without the public URL
        // ever ceasing to resolve.
        if (
          existing.state === "active" &&
          existing.workspaceId === input.workspaceId
        ) {
          await write([
            opaque(
              occGuard(
                statement(
                  `SELECT 1 FROM ${TABLE} WHERE normalized_slug = ? AND state = 'active' AND workspace_id = ?`,
                  input.slug,
                  input.workspaceId,
                ),
              ),
            ),
            upsert({
              table: TABLE,
              key: input.slug,
              row: {
                ...existing.raw,
                operation_id: input.operationId,
                attempt_id: input.attemptId,
              },
              statement: statement(
                `UPDATE ${TABLE} SET operation_id = ?, attempt_id = ? WHERE normalized_slug = ? AND state = 'active' AND workspace_id = ?`,
                input.operationId,
                input.attemptId,
                input.slug,
                input.workspaceId,
              ),
            }),
          ]);
          return;
        }
        const lapsed =
          existing.state === "reserved" &&
          existing.expiresAt !== null &&
          existing.expiresAt.getTime() <= now.getTime();
        if (!lapsed) {
          throw alreadyUsed(input.slug);
        }
      }
      const row: SqlRow = {
        normalized_slug: input.slug,
        workspace_id: input.workspaceId,
        operation_id: input.operationId,
        attempt_id: input.attemptId,
        state: "reserved",
        expires_at: toTimestamp(input.expiresAt),
      };
      try {
        await session.write([
          opaque(
            occGuard(
              statement(
                `SELECT 1 WHERE NOT EXISTS (
                   SELECT 1 FROM ${TABLE}
                    WHERE normalized_slug = ?
                      AND (state <> 'reserved' OR expires_at IS NULL OR expires_at > ?)
                 )`,
                input.slug,
                toTimestamp(now),
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key: input.slug,
            row,
            statement: statement(
              `INSERT INTO ${TABLE}
                 (normalized_slug, workspace_id, operation_id, attempt_id, state, expires_at)
               VALUES (?, ?, ?, ?, 'reserved', ?)
               ON CONFLICT (normalized_slug) DO UPDATE SET
                 workspace_id = excluded.workspace_id,
                 operation_id = excluded.operation_id,
                 attempt_id = excluded.attempt_id,
                 state = 'reserved',
                 expires_at = excluded.expires_at`,
              input.slug,
              input.workspaceId,
              input.operationId,
              input.attemptId,
              toTimestamp(input.expiresAt),
            ),
          }),
        ]);
      } catch (cause) {
        const failure = classifySqlError(cause);
        throw failure === "occGuard" || failure === "unique"
          ? alreadyUsed(input.slug)
          : databaseError(CONTEXT, cause);
      }
    },

    async activate(input): Promise<void> {
      const row = await read(input.slug);
      if (row === null) {
        throw reservationGone(input.slug);
      }
      // Checked before anything is released, so a stale replay of an
      // earlier change cannot free the slug the workspace holds today.
      if (
        row.operationId !== input.operationId ||
        row.workspaceId !== input.workspaceId
      ) {
        throw alreadyUsed(input.slug);
      }
      const mutations: RowMutation[] = [
        opaque(
          occGuard(
            statement(
              `SELECT 1 FROM ${TABLE} WHERE normalized_slug = ? AND operation_id = ? AND workspace_id = ?`,
              input.slug,
              input.operationId,
              input.workspaceId,
            ),
          ),
        ),
      ];
      if (row.state === "reserved") {
        mutations.push(
          upsert({
            table: TABLE,
            key: input.slug,
            row: { ...row.raw, state: "active", expires_at: null },
            statement: statement(
              `UPDATE ${TABLE} SET state = 'active', expires_at = NULL WHERE normalized_slug = ? AND operation_id = ?`,
              input.slug,
              input.operationId,
            ),
          }),
        );
      }
      if (input.releasing !== null && input.releasing !== input.slug) {
        const releasing = await read(input.releasing);
        // A slug already re-taken by someone else is left alone, so the
        // staged deletion is only ever the one that really applies.
        if (
          releasing !== null &&
          releasing.state === "active" &&
          releasing.workspaceId === input.workspaceId
        ) {
          mutations.push(releaseHeldBy(input.releasing, input.workspaceId));
        }
      }
      await write(mutations);
    },

    async abandon(input): Promise<void> {
      const row = await read(input.slug);
      if (
        row === null ||
        row.operationId !== input.operationId ||
        row.attemptId !== input.attemptId ||
        row.state !== "reserved"
      ) {
        return;
      }
      await write([
        remove({
          table: TABLE,
          key: input.slug,
          statement: statement(
            `DELETE FROM ${TABLE} WHERE normalized_slug = ? AND operation_id = ? AND attempt_id = ? AND state = 'reserved'`,
            input.slug,
            input.operationId,
            input.attemptId,
          ),
        }),
      ]);
    },

    async release(input): Promise<void> {
      const row = await read(input.slug);
      if (
        row === null ||
        row.state !== "active" ||
        row.workspaceId !== input.workspaceId
      ) {
        return;
      }
      await write([releaseHeldBy(input.slug, input.workspaceId)]);
    },
  };
}
