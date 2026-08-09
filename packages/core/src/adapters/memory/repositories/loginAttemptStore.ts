import type { PrunePage } from "../../../domain/common/pagination";
import type { LoginAttemptStore } from "../../../domain/identity/ports/loginAttemptStore";
import type { LoginAttempt } from "../../../domain/identity/services/loginThrottlePolicy";
import type { MemoryBackend } from "../store";
import { deleteExpiredPage } from "../support";

export function createMemoryLoginAttemptStore(
  backend: MemoryBackend,
): LoginAttemptStore {
  const table = backend.loginAttempts;
  return {
    async get(key: string): Promise<LoginAttempt | null> {
      const row = table.get(key);
      if (row === undefined) {
        return null;
      }
      if (row.expiresAt.getTime() <= backend.clock.now().getTime()) {
        return null;
      }
      return {
        key: row.key,
        failureCount: row.failureCount,
        lastFailedAt: row.lastFailedAt,
      };
    },

    // The read and the write happen in one synchronous section — no await
    // in between — which is what makes the increment atomic under
    // concurrent callers on this backend.
    async recordFailure(
      key: string,
      now: Date,
      ttlMs: number,
    ): Promise<LoginAttempt> {
      const existing = table.get(key);
      const lapsed =
        existing !== undefined && existing.expiresAt.getTime() <= now.getTime();
      const failureCount =
        existing === undefined || lapsed ? 1 : existing.failureCount + 1;
      table.set(key, {
        key,
        failureCount,
        lastFailedAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
      });
      return { key, failureCount, lastFailedAt: now };
    },

    async clear(key: string): Promise<void> {
      table.delete(key);
    },

    async deleteExpired(
      now: Date,
      cursor: string | null,
      limit: number,
    ): Promise<PrunePage> {
      return deleteExpiredPage(
        table,
        (row) => row.expiresAt,
        now,
        cursor,
        limit,
      );
    },
  };
}
