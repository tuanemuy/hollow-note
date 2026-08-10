import type {
  ExpectedVersion,
  Versioned,
} from "@repo/core/domain/common/transactionalRepository";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { LlmUsage } from "../llmUsage";
import type { BillingPeriod } from "../valueObject";

/**
 * Keyed by `(userId, period)`, so the OCC contract is restated here as
 * on `StorageQuotaRepository`. `deleteByUser` is the bounded page an
 * account-deletion cleanup turn removes.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`,
 * `SystemError(DatabaseError)`.
 */
export interface LlmUsageRepository {
  find(
    userId: UserId,
    period: BillingPeriod,
  ): Promise<Versioned<LlmUsage> | null>;
  insert(usage: LlmUsage): Promise<void>;
  save(
    usage: LlmUsage,
    expectedVersion: ExpectedVersion<LlmUsage>,
  ): Promise<void>;
  deleteByUser(userId: UserId, limit: number): Promise<number>;
}
