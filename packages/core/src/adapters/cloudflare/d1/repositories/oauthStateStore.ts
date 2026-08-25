import type { Clock } from "../../../../application/ports/clock";
import type {
  OAuthFlowState,
  OAuthStateStore,
} from "../../../../application/ports/oauthStateStore";
import type { PrunePage } from "../../../../domain/common/pagination";
import { TokenHash, UserId } from "../../../../domain/identity/valueObject";
import { upsert } from "../../execution/writeSet";
import { databaseError } from "../../sql/errors";
import {
  enumOf,
  int,
  intOrNull,
  text,
  textOrNull,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import type { SqlRow } from "../../sql/statement";
import { statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import {
  createTableWriter,
  deleteExpiredPage,
  writeTranslated,
} from "./identitySupport";

const TABLE = GLOBAL_TABLES.oauthFlowStates;

const COLUMNS = [
  "state",
  "provider",
  "code_verifier",
  "intent",
  "user_id",
  "user_auth_epoch",
  "redirect_to",
  "state_binding_hash",
  "created_at",
  "expires_at",
] as const;

const writer = createTableWriter(TABLE, COLUMNS, ["state"]);

const fromRow = (row: SqlRow): OAuthFlowState => {
  const storedUserId = textOrNull(row, "user_id");
  return {
    provider: text(row, "provider"),
    codeVerifier: text(row, "code_verifier"),
    redirectTo: textOrNull(row, "redirect_to"),
    intent: enumOf(row, "intent", ["signIn", "linkIdentity", "integration"]),
    userId: storedUserId === null ? null : UserId.create(storedUserId),
    userAuthEpoch: intOrNull(row, "user_auth_epoch"),
    stateBindingHash: TokenHash.create(text(row, "state_binding_hash")),
  };
};

/**
 * `oauth_flow_states` on global D1.
 *
 * `take` is one `DELETE … RETURNING` whose `WHERE` carries the binding
 * and deliberately not the expiry: mixing expiry in would leave a
 * matched-but-expired row behind, while a mismatched binding must always
 * leave the row alone. Expiry is judged on the returned row instead.
 */
export function createD1OAuthStateStore(
  deps: Readonly<{ session: SqlSession; clock: Clock }>,
): OAuthStateStore {
  const { session, clock } = deps;
  return {
    async put(
      state: string,
      value: OAuthFlowState,
      ttlMs: number,
    ): Promise<void> {
      const createdAt = toTimestamp(clock.now());
      const row: SqlRow = {
        state,
        provider: value.provider,
        code_verifier: value.codeVerifier,
        intent: value.intent,
        user_id: value.userId,
        user_auth_epoch: value.userAuthEpoch,
        redirect_to: value.redirectTo,
        state_binding_hash: value.stateBindingHash,
        created_at: createdAt,
        expires_at: createdAt + ttlMs,
      };
      await writeTranslated(session, `${TABLE} row ${state}`, [
        upsert({
          table: TABLE,
          key: state,
          row,
          statement: writer.upsert(row),
        }),
      ]);
    },

    async take(
      state: string,
      stateBindingHash: TokenHash,
    ): Promise<OAuthFlowState | null> {
      const rows = await session
        .query(
          statement(
            `DELETE FROM ${TABLE}
             WHERE state = ? AND state_binding_hash = ?
             RETURNING *`,
            state,
            stateBindingHash,
          ),
        )
        .catch((cause: unknown) => {
          throw databaseError(`${TABLE} take`, cause);
        });
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      return int(row, "expires_at") <= clock.now().getTime()
        ? null
        : fromRow(row);
    },

    async deleteExpired(
      now: Date,
      cursor: string | null,
      limit: number,
    ): Promise<PrunePage> {
      return deleteExpiredPage(
        session,
        { table: TABLE, keyColumn: "state", expiresColumn: "expires_at" },
        now,
        cursor,
        limit,
      );
    },
  };
}
