import { beforeEach, describe, expect, it } from "vitest";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { userId } from "./fixtures";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Shared conformance suite for `IdentityUniqueDirectory`
 * (ADP-identity-006..009): two-phase reservation, per-kind conflict
 * codes, and lost-response idempotency.
 */
export function describeIdentityUniqueDirectoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`IdentityUniqueDirectory conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
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

    it("ADP-identity-007/008: reserve and activate are idempotent per operation (lost response)", async () => {
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

    it("ADP-identity-008: activate without a matching operation is rejected", async () => {
      await expectConflict(
        backend.identityUniqueDirectory.activate("op-unknown", 0),
      );
    });
  });
}
