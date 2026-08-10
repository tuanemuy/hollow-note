import { beforeEach, describe, expect, it } from "vitest";
import { Session } from "../../domain/identity/session";
import { SessionId, TokenHash } from "../../domain/identity/valueObject";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { makeSession, userId } from "./fixtures";

/** Shared conformance suite for `SessionRepository` (ADP-identity-015..020). */
export function describeSessionRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`SessionRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-identity-015/016: insert then findByTokenHash matches user and hash together", async () => {
      const now = backend.clock.now();
      const session = makeSession(1, userId(1), now);
      await backend.sessionRepository.insert(session);

      expect(
        await backend.sessionRepository.findByTokenHash(
          userId(1),
          session.tokenHash,
        ),
      ).toEqual(session);
      expect(
        await backend.sessionRepository.findByTokenHash(
          userId(2),
          session.tokenHash,
        ),
      ).toBeNull();
      expect(
        await backend.sessionRepository.findByTokenHash(
          userId(1),
          TokenHash.create("other-hash"),
        ),
      ).toBeNull();
    });

    it("ADP-identity-017: deleteById removes the row", async () => {
      const now = backend.clock.now();
      const session = makeSession(1, userId(1), now);
      await backend.sessionRepository.insert(session);
      await backend.sessionRepository.deleteById(SessionId.create("session-1"));
      expect(
        await backend.sessionRepository.findByTokenHash(
          userId(1),
          session.tokenHash,
        ),
      ).toBeNull();
    });

    it("ADP-identity-018: refreshAuthEpoch follows only the matching session", async () => {
      const now = backend.clock.now();
      const mine = makeSession(1, userId(1), now);
      const other = makeSession(2, userId(2), now);
      await backend.sessionRepository.insert(mine);
      await backend.sessionRepository.insert(other);

      await backend.sessionRepository.refreshAuthEpoch(
        SessionId.create("session-1"),
        userId(1),
        3,
      );
      // A user mismatch must not touch the row.
      await backend.sessionRepository.refreshAuthEpoch(
        SessionId.create("session-2"),
        userId(1),
        9,
      );

      expect(
        (
          await backend.sessionRepository.findByTokenHash(
            userId(1),
            mine.tokenHash,
          )
        )?.authEpoch,
      ).toBe(3);
      expect(
        (
          await backend.sessionRepository.findByTokenHash(
            userId(2),
            other.tokenHash,
          )
        )?.authEpoch,
      ).toBe(0);
    });

    it("ADP-identity-019: deleteOlderEpochByUser is bounded and epoch-scoped", async () => {
      const now = backend.clock.now();
      for (let n = 1; n <= 3; n += 1) {
        await backend.sessionRepository.insert(makeSession(n, userId(1), now));
      }
      const current = Session.create(
        {
          id: "session-current",
          userId: userId(1),
          tokenHash: TokenHash.create("current-hash"),
          authEpoch: 1,
        },
        now,
      );
      await backend.sessionRepository.insert(current);

      expect(
        await backend.sessionRepository.deleteOlderEpochByUser(userId(1), 1, 2),
      ).toBe(2);
      expect(
        await backend.sessionRepository.deleteOlderEpochByUser(
          userId(1),
          1,
          10,
        ),
      ).toBe(1);
      expect(
        await backend.sessionRepository.findByTokenHash(
          userId(1),
          current.tokenHash,
        ),
      ).toEqual(current);
    });

    it("ADP-identity-020: deleteExpired sweeps expiresAt <= now in bounded keyset pages", async () => {
      const now = backend.clock.now();
      for (let n = 1; n <= 3; n += 1) {
        await backend.sessionRepository.insert(makeSession(n, userId(1), now));
      }
      const boundary = new Date(now.getTime() + Session.ttlMs);

      const before = await backend.sessionRepository.deleteExpired(
        new Date(boundary.getTime() - 1),
        null,
        10,
      );
      expect(before.deleted).toBe(0);

      const first = await backend.sessionRepository.deleteExpired(
        boundary,
        null,
        2,
      );
      expect(first.deleted).toBe(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await backend.sessionRepository.deleteExpired(
        boundary,
        first.nextCursor,
        2,
      );
      expect(second.deleted).toBe(1);
      expect(second.nextCursor).toBeNull();
    });
  });
}
