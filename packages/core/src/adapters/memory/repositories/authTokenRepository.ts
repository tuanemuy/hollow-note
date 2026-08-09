import { ConflictError } from "../../../application/errors";
import type { PrunePage } from "../../../domain/common/pagination";
import type { AuthToken } from "../../../domain/identity/authToken";
import type { AuthTokenRepository } from "../../../domain/identity/ports/authTokenRepository";
import type {
  AuthTokenPurpose,
  TokenHash,
  UserId,
} from "../../../domain/identity/valueObject";
import type { MemoryBackend } from "../store";
import {
  clone,
  compareStrings,
  deleteExpiredPage,
  duplicateKey,
} from "../support";

export function createMemoryAuthTokenRepository(
  backend: MemoryBackend,
): AuthTokenRepository {
  const table = backend.authTokens;
  return {
    async insert(token: AuthToken): Promise<void> {
      if (table.has(token.id)) {
        throw duplicateKey("auth_tokens", token.id);
      }
      table.set(token.id, clone(token));
    },

    async findByTokenHash(
      userId: UserId,
      tokenHash: TokenHash,
    ): Promise<AuthToken | null> {
      const found = table
        .values()
        .find(
          (token) => token.userId === userId && token.tokenHash === tokenHash,
        );
      return found === undefined ? null : clone(found);
    },

    async save(token: AuthToken): Promise<void> {
      const stored = table.get(token.id);
      if (token.status === "consumed") {
        // Single consumption: conditional update on the pending row —
        // exactly one concurrent consumer wins.
        if (stored === undefined || stored.status !== "pending") {
          throw new ConflictError(
            "AUTH_TOKEN_ALREADY_CONSUMED",
            `Auth token ${token.id} is not pending`,
          );
        }
      }
      table.set(token.id, clone(token));
    },

    async deleteByUserAndPurpose(
      userId: UserId,
      purpose: AuthTokenPurpose,
      limit: number,
    ): Promise<number> {
      const targets = table
        .values()
        .filter((token) => token.userId === userId && token.purpose === purpose)
        .sort((a, b) => compareStrings(a.id, b.id))
        .slice(0, Math.max(0, limit));
      for (const token of targets) {
        table.delete(token.id);
      }
      return targets.length;
    },

    async deleteOlderEpochByUser(
      userId: UserId,
      currentEpoch: number,
      limit: number,
    ): Promise<number> {
      const targets = table
        .values()
        .filter(
          (token) => token.userId === userId && token.authEpoch < currentEpoch,
        )
        .sort((a, b) => compareStrings(a.id, b.id))
        .slice(0, Math.max(0, limit));
      for (const token of targets) {
        table.delete(token.id);
      }
      return targets.length;
    },

    async deleteExpired(
      now: Date,
      cursor: string | null,
      limit: number,
    ): Promise<PrunePage> {
      return deleteExpiredPage(
        table,
        (token) => token.expiresAt,
        now,
        cursor,
        limit,
      );
    },
  };
}
