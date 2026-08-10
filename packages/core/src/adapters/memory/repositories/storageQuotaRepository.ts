import type {
  ExpectedVersion,
  Versioned,
} from "../../../domain/common/transactionalRepository";
import type { StorageQuotaRepository } from "../../../domain/usage/ports/storageQuotaRepository";
import type { StorageQuota } from "../../../domain/usage/storageQuota";
import type { QuotaSubject } from "../../../domain/usage/valueObject";
import type { ScopeStore } from "../store";
import { clone, duplicateKey, optimisticLockFailure } from "../support";

const TABLE = "storage_quotas";

export const storageQuotaKey = (subject: QuotaSubject): string =>
  subject.type === "user"
    ? `user:${subject.userId}`
    : `workspace:${subject.workspaceId}`;

export function createMemoryStorageQuotaRepository(
  scope: ScopeStore,
): StorageQuotaRepository {
  const table = scope.storageQuotas;

  return {
    async find(subject: QuotaSubject): Promise<Versioned<StorageQuota> | null> {
      const stored = table.get(storageQuotaKey(subject));
      if (stored === undefined) {
        return null;
      }
      return {
        entity: clone(stored),
        expectedVersion:
          stored.version as number as ExpectedVersion<StorageQuota>,
      };
    },

    async insert(quota: StorageQuota): Promise<void> {
      const key = storageQuotaKey(quota.subject);
      if (table.has(key)) {
        throw duplicateKey(TABLE, key);
      }
      table.set(key, clone(quota));
    },

    async save(
      quota: StorageQuota,
      expectedVersion: ExpectedVersion<StorageQuota>,
    ): Promise<void> {
      const key = storageQuotaKey(quota.subject);
      const stored = table.get(key);
      if (
        stored === undefined ||
        (stored.version as number) !== expectedVersion
      ) {
        throw optimisticLockFailure(TABLE, key);
      }
      table.set(key, clone(quota));
    },

    async listBySubjects(
      subjects: readonly QuotaSubject[],
    ): Promise<readonly StorageQuota[]> {
      return subjects
        .map((subject) => table.get(storageQuotaKey(subject)))
        .filter((row): row is StorageQuota => row !== undefined)
        .map(clone);
    },

    async delete(subject: QuotaSubject): Promise<void> {
      table.delete(storageQuotaKey(subject));
    },
  };
}
