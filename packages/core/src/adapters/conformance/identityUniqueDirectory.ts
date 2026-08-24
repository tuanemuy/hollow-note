import { beforeEach, describe, expect, it } from "vitest";
import { User } from "../../domain/identity/user";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { makePendingUser, userId } from "./fixtures";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Shared conformance suite for `IdentityUniqueDirectory`
 * (ADP-identity-006..009, ADP-identity-041, ADP-identity-042): two-phase
 * reservation, per-kind conflict codes, lost-response idempotency, and
 * the conditional teardown of an observed durable claim.
 */
export function describeIdentityUniqueDirectoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`IdentityUniqueDirectory conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
      // `activate` is conditional on the committed user version, so every
      // reservation owner needs a persisted user row to condition on.
      await backend.userRepository.insert(
        makePendingUser(1, backend.clock.now()),
      );
      await backend.userRepository.insert(
        makePendingUser(2, backend.clock.now()),
      );
    });

    const reserveEmail = (
      operationId: string,
      owner = userId(1),
      key = "a@example.com",
    ): Promise<void> =>
      backend.identityUniqueDirectory.reserve({
        kind: "email",
        normalizedKey: key,
        userId: owner,
        operationId,
        expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
      });

    it("ADP-identity-006: resolve returns null until a reservation is activated", async () => {
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBeNull();

      await reserveEmail("op-1");
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBeNull();

      await backend.identityUniqueDirectory.activate("op-1", 0);
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(1));
    });

    it("ADP-identity-007: an unexpired reservation blocks another operation with the kind's code", async () => {
      await reserveEmail("op-1");
      await expectConflict(
        reserveEmail("op-2", userId(2)),
        "EMAIL_ALREADY_USED",
      );
    });

    it("ADP-identity-007: an active claim blocks another user with the kind's code", async () => {
      await backend.identityUniqueDirectory.reserve({
        kind: "handle",
        normalizedKey: "taken",
        userId: userId(1),
        operationId: "op-1",
        expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
      });
      await backend.identityUniqueDirectory.activate("op-1", 0);

      await expectConflict(
        backend.identityUniqueDirectory.reserve({
          kind: "handle",
          normalizedKey: "taken",
          userId: userId(2),
          operationId: "op-2",
          expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
        }),
        "HANDLE_ALREADY_USED",
      );
    });

    it("ADP-identity-007: an expired reservation is reclaimable", async () => {
      await reserveEmail("op-1");
      backend.clock.advance(HOUR_MS + 1);

      await reserveEmail("op-2", userId(2));
      await backend.identityUniqueDirectory.activate("op-2", 0);
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(2));
    });

    it("ADP-identity-007/ADP-identity-008: reserve and activate are idempotent per operation (lost response)", async () => {
      await reserveEmail("op-1");
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);
      await backend.identityUniqueDirectory.activate("op-1", 0);
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(1));
    });

    it("ADP-identity-009: release frees a reservation and is idempotent", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.release("op-1");
      await backend.identityUniqueDirectory.release("op-1");

      await reserveEmail("op-2", userId(2));
      await backend.identityUniqueDirectory.activate("op-2", 0);
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(2));
    });

    it("ADP-identity-009: release does not tear down an activated claim", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);
      await backend.identityUniqueDirectory.release("op-1");
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(1));
    });

    it("ADP-identity-008: activate is conditional on the expected user version", async () => {
      const now = backend.clock.now();
      const seeded = await backend.userRepository.findById(userId(1));
      if (seeded === null || seeded.entity.status !== "pending") {
        throw new Error("seeded user missing");
      }
      await backend.userRepository.save(
        User.verifyEmail(seeded.entity, now).entity,
        seeded.expectedVersion,
      );
      await reserveEmail("op-1");

      await expectConflict(
        backend.identityUniqueDirectory.activate("op-1", 0),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      // A rejected activation leaves the reservation untouched.
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBeNull();

      await backend.identityUniqueDirectory.activate("op-1", 1);
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(1));
    });

    it("ADP-identity-008: activate without a matching operation is rejected", async () => {
      await expectConflict(
        backend.identityUniqueDirectory.activate("op-unknown", 0),
      );
    });

    /** The observation a conditional teardown has to quote. */
    const observeClaimToken = async (
      key = "a@example.com",
    ): Promise<string> => {
      const claim = await backend.identityUniqueDirectory.resolveClaim(
        "email",
        key,
      );
      if (claim === null) {
        throw new Error(`no active claim on ${key}`);
      }
      return claim.claimToken;
    };

    const beginRelease = (
      operationId: string,
      expectedClaimToken: string,
      expectedUserId = userId(1),
      key = "a@example.com",
    ): Promise<void> =>
      backend.identityUniqueDirectory.beginRelease({
        kind: "email",
        normalizedKey: key,
        expectedUserId,
        expectedClaimToken,
        operationId,
      });

    it("ADP-identity-042: resolveClaim answers with owner and token for an active claim only", async () => {
      expect(
        await backend.identityUniqueDirectory.resolveClaim(
          "email",
          "a@example.com",
        ),
      ).toBeNull();

      await reserveEmail("op-1");
      expect(
        await backend.identityUniqueDirectory.resolveClaim(
          "email",
          "a@example.com",
        ),
      ).toBeNull();

      await backend.identityUniqueDirectory.activate("op-1", 0);
      const claim = await backend.identityUniqueDirectory.resolveClaim(
        "email",
        "a@example.com",
      );
      if (claim === null) {
        throw new Error("an active claim answers");
      }
      expect(claim.userId).toBe(userId(1));

      await beginRelease("release-1", claim.claimToken);
      expect(
        await backend.identityUniqueDirectory.resolveClaim(
          "email",
          "a@example.com",
        ),
      ).toBeNull();
    });

    it("ADP-identity-042: the same normalized key is a separate claim per kind", async () => {
      await reserveEmail("op-email");
      await backend.identityUniqueDirectory.reserve({
        kind: "handle",
        normalizedKey: "a@example.com",
        userId: userId(2),
        operationId: "op-handle",
        expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
      });
      await backend.identityUniqueDirectory.activate("op-email", 0);
      await backend.identityUniqueDirectory.activate("op-handle", 0);

      const email = await backend.identityUniqueDirectory.resolveClaim(
        "email",
        "a@example.com",
      );
      const handle = await backend.identityUniqueDirectory.resolveClaim(
        "handle",
        "a@example.com",
      );
      if (email === null || handle === null) {
        throw new Error("both kinds answer");
      }
      expect(email.userId).toBe(userId(1));
      expect(handle.userId).toBe(userId(2));

      // Tearing down the email claim quotes an observation that also
      // matches the handle row on the normalized key alone.
      await beginRelease("release-1", email.claimToken);
      await backend.identityUniqueDirectory.release("release-1");

      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBeNull();
      expect(
        await backend.identityUniqueDirectory.resolve(
          "handle",
          "a@example.com",
        ),
      ).toBe(userId(2));
    });

    it("ADP-identity-042: the token stays the same for as long as the claim lives", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);

      const observed = await observeClaimToken();
      expect(await observeClaimToken()).toBe(observed);
      await backend.identityUniqueDirectory.activate("op-1", 0);
      expect(await observeClaimToken()).toBe(observed);
    });

    it("ADP-identity-042/ADP-identity-041: a re-taken claim carries a different token", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);
      const first = await observeClaimToken();

      await beginRelease("release-1", first);
      await backend.identityUniqueDirectory.release("release-1");

      // Re-taking under the *same* operation id is the load-bearing part:
      // reservation ids are deterministic, so a backend deriving the token
      // from the operation id would hand back the token of a claim that no
      // longer exists.
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);

      expect(await observeClaimToken()).not.toBe(first);
    });

    it("ADP-identity-042/ADP-identity-006: resolve is a projection of resolveClaim in every state", async () => {
      const agreedOwner = async () => {
        const owner = await backend.identityUniqueDirectory.resolve(
          "email",
          "a@example.com",
        );
        const claim = await backend.identityUniqueDirectory.resolveClaim(
          "email",
          "a@example.com",
        );
        expect(owner).toBe(claim?.userId ?? null);
        return owner;
      };

      expect(await agreedOwner()).toBeNull();
      await reserveEmail("op-1");
      expect(await agreedOwner()).toBeNull();
      await backend.identityUniqueDirectory.activate("op-1", 0);
      expect(await agreedOwner()).toBe(userId(1));
      await beginRelease("release-1", await observeClaimToken());
      expect(await agreedOwner()).toBeNull();
    });

    it("ADP-identity-041: beginRelease quoting a superseded token leaves the current claim intact", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);
      const stale = await observeClaimToken();
      await beginRelease("release-1", stale);
      await backend.identityUniqueDirectory.release("release-1");

      await reserveEmail("op-2", userId(2));
      await backend.identityUniqueDirectory.activate("op-2", 0);

      // Owner matches the row now holding the key; only the token is old.
      await beginRelease("release-2", stale, userId(2));
      await backend.identityUniqueDirectory.release("release-2");

      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(2));
    });

    it("ADP-identity-041: a releasing row is not taken over by another operation", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);
      const observed = await observeClaimToken();

      await beginRelease("release-1", observed);
      // Quoting the very observation `release-1` used still cannot re-key
      // a row that is already `releasing`.
      await beginRelease("release-2", observed);
      await backend.identityUniqueDirectory.release("release-2");

      await expectConflict(
        reserveEmail("op-2", userId(2)),
        "EMAIL_ALREADY_USED",
      );

      await backend.identityUniqueDirectory.release("release-1");
      await reserveEmail("op-2", userId(2));
    });

    it("ADP-identity-041/ADP-identity-009: beginRelease then release frees an activated claim for another user", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);

      await beginRelease("release-1", await observeClaimToken());
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBeNull();

      await backend.identityUniqueDirectory.release("release-1");
      await reserveEmail("op-2", userId(2));
      await backend.identityUniqueDirectory.activate("op-2", 0);
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(2));
    });

    it("ADP-identity-041/ADP-identity-007: a releasing key stays blocked for another user until release", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);
      await beginRelease("release-1", await observeClaimToken());

      await expectConflict(
        reserveEmail("op-2", userId(2)),
        "EMAIL_ALREADY_USED",
      );

      await backend.identityUniqueDirectory.release("release-1");
      await reserveEmail("op-2", userId(2));
    });

    it("ADP-identity-041/ADP-identity-009: beginRelease and release are idempotent for the same operation", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);

      const observed = await observeClaimToken();
      await beginRelease("release-1", observed);
      // The row is `releasing` now, so the repeat is a no-op that the
      // paired `release` converges from all the same.
      await beginRelease("release-1", observed);
      await backend.identityUniqueDirectory.release("release-1");
      await backend.identityUniqueDirectory.release("release-1");

      await reserveEmail("op-2", userId(2));
      await backend.identityUniqueDirectory.activate("op-2", 0);
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(2));
    });

    it("ADP-identity-041: beginRelease by a non-owner leaves the claim intact", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);

      // The token is the live one, so only the owner mismatch can refuse
      // this teardown.
      await beginRelease("release-1", await observeClaimToken(), userId(2));
      await backend.identityUniqueDirectory.release("release-1");

      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(1));
    });

    it("ADP-identity-041: beginRelease leaves a still-reserved row alone", async () => {
      await reserveEmail("op-1");

      // No observation exists for a `reserved` row, so this no-op is also
      // implied by the token condition and cannot be told apart from it.
      await beginRelease("release-1", "no-such-token");
      await backend.identityUniqueDirectory.release("release-1");

      // The reservation survived, so its own operation can still publish
      // it and another user is still blocked.
      await expectConflict(
        reserveEmail("op-2", userId(2)),
        "EMAIL_ALREADY_USED",
      );
      await backend.identityUniqueDirectory.activate("op-1", 0);
      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(1));
    });

    it("ADP-identity-041: beginRelease on an unknown key is a no-op", async () => {
      // Same as the `reserved` case: an absent row has no observation, so
      // the token condition already covers this refusal.
      await beginRelease(
        "release-1",
        "no-such-token",
        userId(1),
        "absent@example.com",
      );

      // Taking the key *before* the paired `release` is the load-bearing
      // part: a backend that leaves a `releasing` tombstone behind would
      // block this reservation, and the `release` would then hide it.
      await reserveEmail("op-1", userId(2), "absent@example.com");
      await backend.identityUniqueDirectory.release("release-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);
      expect(
        await backend.identityUniqueDirectory.resolve(
          "email",
          "absent@example.com",
        ),
      ).toBe(userId(2));
    });
  });
}
