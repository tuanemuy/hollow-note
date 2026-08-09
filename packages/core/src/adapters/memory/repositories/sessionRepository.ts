import type { PrunePage } from "../../../domain/common/pagination";
import type { SessionRepository } from "../../../domain/identity/ports/sessionRepository";
import type { Session } from "../../../domain/identity/session";
import type {
  SessionId,
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

export function createMemorySessionRepository(
  backend: MemoryBackend,
): SessionRepository {
  const table = backend.sessions;
  return {
    async insert(session: Session): Promise<void> {
      if (table.has(session.id)) {
        throw duplicateKey("sessions", session.id);
      }
      table.set(session.id, clone(session));
    },

    async findByTokenHash(
      userId: UserId,
      tokenHash: TokenHash,
    ): Promise<Session | null> {
      const found = table
        .values()
        .find(
          (session) =>
            session.userId === userId && session.tokenHash === tokenHash,
        );
      return found === undefined ? null : clone(found);
    },

    async deleteById(id: SessionId): Promise<void> {
      table.delete(id);
    },

    async refreshAuthEpoch(
      id: SessionId,
      userId: UserId,
      authEpoch: number,
    ): Promise<void> {
      const stored = table.get(id);
      if (stored === undefined || stored.userId !== userId) {
        return;
      }
      table.set(id, { ...stored, authEpoch });
    },

    async deleteOlderEpochByUser(
      userId: UserId,
      currentEpoch: number,
      limit: number,
    ): Promise<number> {
      const targets = table
        .values()
        .filter(
          (session) =>
            session.userId === userId && session.authEpoch < currentEpoch,
        )
        .sort((a, b) => compareStrings(a.id, b.id))
        .slice(0, Math.max(0, limit));
      for (const session of targets) {
        table.delete(session.id);
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
        (session) => session.expiresAt,
        now,
        cursor,
        limit,
      );
    },
  };
}
