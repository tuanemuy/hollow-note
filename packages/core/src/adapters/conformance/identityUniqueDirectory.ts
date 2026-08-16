import { beforeEach, describe, expect, it } from "vitest";
import { User } from "../../domain/identity/user";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { makePendingUser, userId } from "./fixtures";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Shared conformance suite for `IdentityUniqueDirectory`
 * (ADP-identity-006..009, ADP-identity-041): two-phase reservation,
 * per-kind conflict codes, and lost-response idempotency.
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

    const beginRelease = (
      operationId: string,
      expectedUserId = userId(1),
      key = "a@example.com",
    ): Promise<void> =>
      backend.identityUniqueDirectory.beginRelease({
        kind: "email",
        normalizedKey: key,
        expectedUserId,
        operationId,
      });

    it("ADP-identity-041/ADP-identity-009: beginRelease then release frees an activated claim for another user", async () => {
      await reserveEmail("op-1");
      await backend.identityUniqueDirectory.activate("op-1", 0);

      await beginRelease("release-1");
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
      await beginRelease("release-1");

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

      await beginRelease("release-1");
      await beginRelease("release-1");
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

      await beginRelease("release-1", userId(2));
      await backend.identityUniqueDirectory.release("release-1");

      expect(
        await backend.identityUniqueDirectory.resolve("email", "a@example.com"),
      ).toBe(userId(1));
    });

    it("ADP-identity-041: beginRelease leaves a still-reserved row alone", async () => {
      await reserveEmail("op-1");

      await beginRelease("release-1");
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
      await beginRelease("release-1", userId(1), "absent@example.com");
      await backend.identityUniqueDirectory.release("release-1");

      await reserveEmail("op-1", userId(2), "absent@example.com");
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
