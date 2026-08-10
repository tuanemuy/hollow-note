import { beforeEach, describe, expect, it } from "vitest";
import { isConflictError } from "../../application/errors";
import { AuthToken } from "../../domain/identity/authToken";
import { AuthTokenPurpose } from "../../domain/identity/valueObject";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { makeAuthToken, userId } from "./fixtures";

/** Shared conformance suite for `AuthTokenRepository` (ADP-identity-021..026). */
export function describeAuthTokenRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`AuthTokenRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-identity-021/022: insert then findByTokenHash matches user and hash together", async () => {
      const now = backend.clock.now();
      const token = makeAuthToken(1, userId(1), "email_verification", now);
      await backend.authTokenRepository.insert(token);

      expect(
        await backend.authTokenRepository.findByTokenHash(
          userId(1),
          token.tokenHash,
        ),
      ).toEqual(token);
      expect(
        await backend.authTokenRepository.findByTokenHash(
          userId(2),
          token.tokenHash,
        ),
      ).toBeNull();
    });

    it("ADP-identity-023: save(Consumed) is a conditional update on the pending row", async () => {
      const now = backend.clock.now();
      const token = makeAuthToken(1, userId(1), "email_verification", now);
      await backend.authTokenRepository.insert(token);

      const consumed = AuthToken.consume(token, now);
      await backend.authTokenRepository.save(consumed);
      expect(
        await backend.authTokenRepository.findByTokenHash(
          userId(1),
          token.tokenHash,
        ),
      ).toEqual(consumed);

      await expectConflict(
        backend.authTokenRepository.save(consumed),
        "AUTH_TOKEN_ALREADY_CONSUMED",
      );
    });

    it("ADP-identity-023: exactly one concurrent consumer succeeds", async () => {
      const now = backend.clock.now();
      const token = makeAuthToken(1, userId(1), "email_verification", now);
      await backend.authTokenRepository.insert(token);
      const consumed = AuthToken.consume(token, now);

      const outcomes = await Promise.allSettled([
        backend.authTokenRepository.save(consumed),
        backend.authTokenRepository.save(consumed),
      ]);
      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === "fulfilled",
      );
      const conflicts = outcomes.filter(
        (outcome) =>
          outcome.status === "rejected" && isConflictError(outcome.reason),
      );
      expect(fulfilled).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
    });

    it("ADR-031: findPendingByUserAndPurpose yields the single live row of the pair", async () => {
      const now = backend.clock.now();
      const consumedSource = makeAuthToken(
        1,
        userId(1),
        "email_verification",
        now,
      );
      await backend.authTokenRepository.insert(consumedSource);
      await backend.authTokenRepository.save(
        AuthToken.consume(consumedSource, now),
      );
      const pending = makeAuthToken(2, userId(1), "email_verification", now);
      await backend.authTokenRepository.insert(pending);
      await backend.authTokenRepository.insert(
        makeAuthToken(3, userId(2), "email_verification", now),
      );

      expect(
        await backend.authTokenRepository.findPendingByUserAndPurpose(
          userId(1),
          "email_verification",
        ),
      ).toEqual(pending);
      expect(
        await backend.authTokenRepository.findPendingByUserAndPurpose(
          userId(1),
          "password_reset",
        ),
      ).toBeNull();
    });

    it("ADP-identity-024: deleteByUserAndPurpose is purpose-scoped and bounded", async () => {
      const now = backend.clock.now();
      await backend.authTokenRepository.insert(
        makeAuthToken(1, userId(1), "email_verification", now),
      );
      await backend.authTokenRepository.insert(
        makeAuthToken(2, userId(1), "email_verification", now),
      );
      await backend.authTokenRepository.insert(
        makeAuthToken(3, userId(1), "password_reset", now),
      );

      expect(
        await backend.authTokenRepository.deleteByUserAndPurpose(
          userId(1),
          "email_verification",
          1,
        ),
      ).toBe(1);
      expect(
        await backend.authTokenRepository.deleteByUserAndPurpose(
          userId(1),
          "email_verification",
          10,
        ),
      ).toBe(1);
      expect(
        await backend.authTokenRepository.deleteByUserAndPurpose(
          userId(1),
          "password_reset",
          10,
        ),
      ).toBe(1);
    });

    it("ADP-identity-025: deleteOlderEpochByUser removes only pre-epoch tokens", async () => {
      const now = backend.clock.now();
      await backend.authTokenRepository.insert(
        makeAuthToken(1, userId(1), "email_verification", now),
      );
      const current = AuthToken.issue(
        {
          id: "auth-token-current",
          userId: userId(1),
          purpose: "email_verification",
          tokenHash: makeAuthToken(9, userId(1), "email_verification", now)
            .tokenHash,
          authEpoch: 2,
        },
        now,
      );
      await backend.authTokenRepository.insert(current);

      expect(
        await backend.authTokenRepository.deleteOlderEpochByUser(
          userId(1),
          2,
          10,
        ),
      ).toBe(1);
      expect(
        await backend.authTokenRepository.findByTokenHash(
          userId(1),
          current.tokenHash,
        ),
      ).toEqual(current);
    });

    it("ADP-identity-026: deleteExpired honours the expiresAt <= now boundary", async () => {
      const now = backend.clock.now();
      const token = makeAuthToken(1, userId(1), "email_verification", now);
      await backend.authTokenRepository.insert(token);
      const ttl = AuthTokenPurpose.ttlMs("email_verification");
      const boundary = new Date(now.getTime() + ttl);

      const early = await backend.authTokenRepository.deleteExpired(
        new Date(boundary.getTime() - 1),
        null,
        10,
      );
      expect(early.deleted).toBe(0);

      const exact = await backend.authTokenRepository.deleteExpired(
        boundary,
        null,
        10,
      );
      expect(exact.deleted).toBe(1);
      expect(exact.nextCursor).toBeNull();
    });
  });
}
