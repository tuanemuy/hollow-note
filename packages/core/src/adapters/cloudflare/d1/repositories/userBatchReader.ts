import { SystemError, SystemErrorCode } from "../../../../application/errors";
import type {
  ExpectedVersion,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import type { UserBatchReader } from "../../../../domain/identity/ports/userBatchReader";
import type { User } from "../../../../domain/identity/user";
import type { UserId } from "../../../../domain/identity/valueObject";
import { inJsonList, jsonList } from "../../sql/json";
import { int, text } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import { statement } from "../../sql/statement";
import { GLOBAL_TABLES } from "../schema";
import { userFromRow } from "./userRepository";

const TABLE = GLOBAL_TABLES.users;
const MAX_BATCH = 100;

/**
 * Batch read of `users` by id. The ids arrive as one JSON array expanded
 * with `json_each` rather than as 100 positional bindings, which would
 * exceed the plane's bound-parameter cap on its own
 * (`spec/database/index.md` の「共通の規約」).
 */
export function createD1UserBatchReader(
  deps: Readonly<{ session: SqlSession }>,
): UserBatchReader {
  const { session } = deps;
  return {
    async resolveMany(
      ids: readonly UserId[],
    ): Promise<ReadonlyMap<UserId, Versioned<User>>> {
      if (ids.length > MAX_BATCH) {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          `resolveMany accepts at most ${MAX_BATCH} ids`,
        );
      }
      const resolved = new Map<UserId, Versioned<User>>();
      if (ids.length === 0) {
        return resolved;
      }
      const wanted = new Set<string>(ids);
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT * FROM ${TABLE} WHERE ${inJsonList("id")}`,
          jsonList(ids),
        ),
        keyOf: (row) => text(row, "id"),
        matches: (row) => wanted.has(text(row, "id")),
      });
      for (const row of rows) {
        const user = userFromRow(row);
        resolved.set(user.id, {
          entity: user,
          expectedVersion: int(row, "version") as ExpectedVersion<User>,
        });
      }
      return resolved;
    },
  };
}
