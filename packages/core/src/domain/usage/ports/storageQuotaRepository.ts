import type {
  ExpectedVersion,
  Versioned,
} from "@repo/core/domain/common/transactionalRepository";
import type { StorageQuota } from "../storageQuota";
import type { QuotaSubject } from "../valueObject";

/**
 * `TransactionalRepository` assumes a single id, and this aggregate is
 * keyed by its subject, so the same OCC contract is restated here:
 * `find` is the only place a version token is minted, and `save`
 * consumes it.
 *
 * Error contract: `ConflictError("OPTIMISTIC_LOCK_FAILURE")`,
 * `SystemError(DatabaseError)`.
 */
export interface StorageQuotaRepository {
  find(subject: QuotaSubject): Promise<Versioned<StorageQuota> | null>;
  insert(quota: StorageQuota): Promise<void>;
  save(
    quota: StorageQuota,
    expectedVersion: ExpectedVersion<StorageQuota>,
  ): Promise<void>;
  listBySubjects(
    subjects: readonly QuotaSubject[],
  ): Promise<readonly StorageQuota[]>;
  delete(subject: QuotaSubject): Promise<void>;
}
