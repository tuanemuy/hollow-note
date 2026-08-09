import {
  ConflictError,
  SystemError,
  SystemErrorCode,
} from "../../application/errors";
import type { PrunePage } from "../../domain/common/pagination";
import type {
  ExpectedVersion,
  TransactionalRepository,
  Versioned,
} from "../../domain/common/transactionalRepository";
import type { Version } from "../../domain/common/version";
import type { MemTable } from "./store";

export const clone = <T>(value: T): T => structuredClone(value);

export function duplicateKey(table: string, id: string): SystemError {
  return new SystemError(
    SystemErrorCode.DatabaseError,
    `Duplicate primary key in ${table}: ${id}`,
  );
}

export function optimisticLockFailure(
  table: string,
  id: string,
): ConflictError {
  return new ConflictError(
    "OPTIMISTIC_LOCK_FAILURE",
    `Version mismatch while writing ${table} row ${id}`,
  );
}

/**
 * OCC-enforced `TransactionalRepository` over one `MemTable`. Entities
 * are cloned on both write and read so callers never alias the stored
 * snapshot; the version token is minted from the persisted row inside
 * `findById`, the only legitimate construction site.
 */
export function createOccRepository<
  TEntity extends { readonly id: TId; readonly version: Version },
  TId extends string,
>(
  tableName: string,
  table: MemTable<TEntity>,
): TransactionalRepository<TEntity, TId> {
  const checkVersion = (
    id: TId,
    expectedVersion: ExpectedVersion<TEntity>,
  ): void => {
    const stored = table.get(id);
    if (
      stored === undefined ||
      (stored.version as number) !== expectedVersion
    ) {
      throw optimisticLockFailure(tableName, id);
    }
  };
  return {
    async insert(entity: TEntity): Promise<void> {
      if (table.has(entity.id)) {
        throw duplicateKey(tableName, entity.id);
      }
      table.set(entity.id, clone(entity));
    },
    async findById(id: TId): Promise<Versioned<TEntity> | null> {
      const stored = table.get(id);
      if (stored === undefined) {
        return null;
      }
      return {
        entity: clone(stored),
        expectedVersion: stored.version as number as ExpectedVersion<TEntity>,
      };
    },
    async save(
      entity: TEntity,
      expectedVersion: ExpectedVersion<TEntity>,
    ): Promise<void> {
      checkVersion(entity.id, expectedVersion);
      table.set(entity.id, clone(entity));
    },
    async delete(
      id: TId,
      expectedVersion: ExpectedVersion<TEntity>,
    ): Promise<void> {
      checkVersion(id, expectedVersion);
      table.delete(id);
    },
  };
}

/**
 * One bounded pass of a `(expiresAt, id)`-ordered expiry sweep. Rows
 * whose `expiresAt <= now` are deleted in id-keyset order starting after
 * `cursor`; the keyset (never an OFFSET) keeps concurrent deletions from
 * skipping rows.
 */
export function deleteExpiredPage<V>(
  table: MemTable<V>,
  expiresAtOf: (row: V) => Date,
  now: Date,
  cursor: string | null,
  limit: number,
): PrunePage {
  const expired = table
    .entries()
    .filter(([key, row]) => {
      if (expiresAtOf(row).getTime() > now.getTime()) {
        return false;
      }
      return cursor === null || key > cursor;
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const page = expired.slice(0, Math.max(0, limit));
  for (const [key] of page) {
    table.delete(key);
  }
  const hasMore = expired.length > page.length;
  const last = page[page.length - 1];
  return {
    deleted: page.length,
    nextCursor: hasMore && last !== undefined ? last[0] : null,
  };
}

export const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
