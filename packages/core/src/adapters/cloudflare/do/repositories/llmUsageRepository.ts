import type {
  ExpectedVersion,
  Versioned,
} from "../../../../domain/common/transactionalRepository";
import { Version } from "../../../../domain/common/version";
import { UserId } from "../../../../domain/identity/valueObject";
import type { LlmUsage } from "../../../../domain/usage/llmUsage";
import type { LlmUsageRepository } from "../../../../domain/usage/ports/llmUsageRepository";
import {
  BillingPeriod,
  LlmCallQuota,
} from "../../../../domain/usage/valueObject";
import {
  opaque,
  type RowMutation,
  remove,
  upsert,
} from "../../execution/writeSet";
import { optimisticLockFailure, throwTranslated } from "../../sql/errors";
import { occGuard } from "../../sql/occGuard";
import { compositeKey, date, int, text, toTimestamp } from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import {
  type SqlRow,
  type SqlStatement,
  type SqlValue,
  statement,
} from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";

const TABLE = SCOPE_TABLES.llmUsages;

const COLUMNS = [
  "user_id",
  "period_year",
  "period_month",
  "limit_calls",
  "consumed_calls",
  "version",
  "updated_at",
] as const;

const KEY_COLUMNS = ["user_id", "period_year", "period_month"] as const;

const SELECTION = COLUMNS.join(", ");
const MUTABLE = COLUMNS.filter(
  (column) => !(KEY_COLUMNS as readonly string[]).includes(column),
);

const INSERT_SQL = `INSERT INTO ${TABLE} (${SELECTION}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;
const KEY_PREDICATE = "user_id = ? AND period_year = ? AND period_month = ?";
const UPDATE_SQL = `UPDATE ${TABLE} SET ${MUTABLE.map((column) => `${column} = ?`).join(", ")} WHERE ${KEY_PREDICATE}`;
const DELETE_SQL = `DELETE FROM ${TABLE} WHERE ${KEY_PREDICATE}`;

const overlayKey = (userId: string, year: number, month: number): string =>
  compositeKey(userId, String(year), String(month));

const rowKey = (row: SqlRow): string =>
  overlayKey(
    text(row, "user_id"),
    int(row, "period_year"),
    int(row, "period_month"),
  );

const toRow = (usage: LlmUsage): SqlRow => ({
  user_id: usage.userId,
  period_year: usage.period.year,
  period_month: usage.period.month,
  limit_calls: usage.quota.limit,
  consumed_calls: usage.consumedCalls,
  version: usage.version,
  updated_at: toTimestamp(usage.updatedAt),
});

const fromRow = (row: SqlRow): LlmUsage => ({
  userId: UserId.create(text(row, "user_id")),
  period: BillingPeriod.create(
    int(row, "period_year"),
    int(row, "period_month"),
  ),
  quota: LlmCallQuota.create(int(row, "limit_calls")),
  consumedCalls: int(row, "consumed_calls"),
  version: Version.create(int(row, "version")),
  updatedAt: date(row, "updated_at"),
});

const valuesOf = (
  row: SqlRow,
  columns: readonly string[],
): readonly SqlValue[] => columns.map((column) => row[column] ?? null);

export type CloudflareLlmUsageRepositoryDeps = Readonly<{
  session: SqlSession;
}>;

/** `llm_usages` of one scope object, keyed by `(userId, period)`. */
export function createCloudflareLlmUsageRepository(
  deps: CloudflareLlmUsageRepositoryDeps,
): LlmUsageRepository {
  const { session } = deps;

  const write = async (
    mutations: readonly RowMutation[],
    context: string,
  ): Promise<void> => {
    try {
      await session.write(mutations);
    } catch (cause) {
      throwTranslated(context, cause);
    }
  };

  const contextOf = (userId: UserId, period: BillingPeriod): string =>
    `${TABLE} row ${userId} ${period.year}-${period.month}`;

  const selectByKey = (userId: UserId, period: BillingPeriod): SqlStatement =>
    statement(
      `SELECT ${SELECTION} FROM ${TABLE} WHERE ${KEY_PREDICATE}`,
      userId,
      period.year,
      period.month,
    );

  const readRow = (
    userId: UserId,
    period: BillingPeriod,
  ): Promise<SqlRow | null> =>
    session.readRow({
      table: TABLE,
      key: overlayKey(userId, period.year, period.month),
      statement: selectByKey(userId, period),
    });

  return {
    async find(
      userId: UserId,
      period: BillingPeriod,
    ): Promise<Versioned<LlmUsage> | null> {
      const row = await readRow(userId, period);
      if (row === null) {
        return null;
      }
      return {
        entity: fromRow(row),
        expectedVersion: int(row, "version") as ExpectedVersion<LlmUsage>,
      };
    },

    async insert(usage: LlmUsage): Promise<void> {
      const row = toRow(usage);
      await write(
        [
          upsert({
            table: TABLE,
            key: overlayKey(
              usage.userId,
              usage.period.year,
              usage.period.month,
            ),
            row,
            statement: statement(INSERT_SQL, ...valuesOf(row, COLUMNS)),
          }),
        ],
        contextOf(usage.userId, usage.period),
      );
    },

    async save(
      usage: LlmUsage,
      expectedVersion: ExpectedVersion<LlmUsage>,
    ): Promise<void> {
      const context = contextOf(usage.userId, usage.period);
      const current = await readRow(usage.userId, usage.period);
      if (current === null || int(current, "version") !== expectedVersion) {
        throw optimisticLockFailure(context);
      }
      const row = toRow(usage);
      await write(
        [
          opaque(
            occGuard(
              statement(
                `SELECT 1 FROM ${TABLE} WHERE ${KEY_PREDICATE} AND version = ?`,
                usage.userId,
                usage.period.year,
                usage.period.month,
                expectedVersion,
              ),
            ),
          ),
          upsert({
            table: TABLE,
            key: overlayKey(
              usage.userId,
              usage.period.year,
              usage.period.month,
            ),
            row,
            statement: statement(
              UPDATE_SQL,
              ...valuesOf(row, MUTABLE),
              usage.userId,
              usage.period.year,
              usage.period.month,
            ),
          }),
        ],
        context,
      );
    },

    async deleteByUser(userId: UserId, limit: number): Promise<number> {
      const bounded = Math.max(0, limit);
      if (bounded === 0) {
        return 0;
      }
      const rows = await session.readRows({
        table: TABLE,
        statement: statement(
          `SELECT ${SELECTION} FROM ${TABLE} WHERE user_id = ?
             ORDER BY period_year, period_month LIMIT ?`,
          userId,
          bounded,
        ),
        keyOf: rowKey,
        matches: (row) => text(row, "user_id") === userId,
        compare: (a, b) =>
          int(a, "period_year") - int(b, "period_year") ||
          int(a, "period_month") - int(b, "period_month"),
        limit: bounded,
      });
      if (rows.length === 0) {
        return 0;
      }
      // One statement per row rather than a single multi-row DELETE: the
      // page is bounded by `limit` and the row images stay in the overlay,
      // so a later read in the same unit sees the deletion.
      await write(
        rows.map((row) =>
          remove({
            table: TABLE,
            key: rowKey(row),
            statement: statement(
              DELETE_SQL,
              text(row, "user_id"),
              int(row, "period_year"),
              int(row, "period_month"),
            ),
          }),
        ),
        `${TABLE} rows of ${userId}`,
      );
      return rows.length;
    },
  };
}
