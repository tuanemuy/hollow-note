import type {
  ExpectedVersion,
  Versioned,
} from "../../../domain/common/transactionalRepository";
import type { UserId } from "../../../domain/identity/valueObject";
import type { LlmUsage } from "../../../domain/usage/llmUsage";
import type { LlmUsageRepository } from "../../../domain/usage/ports/llmUsageRepository";
import type { BillingPeriod } from "../../../domain/usage/valueObject";
import type { ScopeStore } from "../store";
import {
  clone,
  compareStrings,
  duplicateKey,
  optimisticLockFailure,
} from "../support";

const TABLE = "llm_usages";

export const llmUsageKey = (userId: UserId, period: BillingPeriod): string =>
  `${userId} ${period.year}-${String(period.month).padStart(2, "0")}`;

export function createMemoryLlmUsageRepository(
  scope: ScopeStore,
): LlmUsageRepository {
  const table = scope.llmUsages;

  return {
    async find(
      userId: UserId,
      period: BillingPeriod,
    ): Promise<Versioned<LlmUsage> | null> {
      const stored = table.get(llmUsageKey(userId, period));
      if (stored === undefined) {
        return null;
      }
      return {
        entity: clone(stored),
        expectedVersion: stored.version as number as ExpectedVersion<LlmUsage>,
      };
    },

    async insert(usage: LlmUsage): Promise<void> {
      const key = llmUsageKey(usage.userId, usage.period);
      if (table.has(key)) {
        throw duplicateKey(TABLE, key);
      }
      table.set(key, clone(usage));
    },

    async save(
      usage: LlmUsage,
      expectedVersion: ExpectedVersion<LlmUsage>,
    ): Promise<void> {
      const key = llmUsageKey(usage.userId, usage.period);
      const stored = table.get(key);
      if (
        stored === undefined ||
        (stored.version as number) !== expectedVersion
      ) {
        throw optimisticLockFailure(TABLE, key);
      }
      table.set(key, clone(usage));
    },

    async deleteByUser(userId: UserId, limit: number): Promise<number> {
      if (limit <= 0) {
        return 0;
      }
      const targets = table
        .entries()
        .filter(([, row]) => row.userId === userId)
        .sort(([a], [b]) => compareStrings(a, b))
        .slice(0, limit);
      for (const [key] of targets) {
        table.delete(key);
      }
      return targets.length;
    },
  };
}
