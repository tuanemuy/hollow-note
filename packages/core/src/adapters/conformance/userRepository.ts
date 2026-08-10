import { beforeEach, describe, expect, it } from "vitest";
import { User } from "../../domain/identity/user";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { makePendingUser, userId } from "./fixtures";

/**
 * Shared conformance suite for `UserRepository`
 * (ADP-identity-001..004). Import and invoke from each backend's test
 * file; the suite owns the `describe` block.
 */
export function describeUserRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`UserRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-identity-001/002: insert then findById round-trips with a version token", async () => {
      const now = backend.clock.now();
      const user = makePendingUser(1, now);
      await backend.userRepository.insert(user);

      const found = await backend.userRepository.findById(userId(1));
      expect(found).not.toBeNull();
      expect(found?.entity).toEqual(user);
      expect(found?.expectedVersion).toBe(0);
    });

    it("ADP-identity-002: findById returns null for an unknown id", async () => {
      expect(await backend.userRepository.findById(userId(9))).toBeNull();
    });

    it("ADP-identity-003: save persists when the expected version matches", async () => {
      const now = backend.clock.now();
      await backend.userRepository.insert(makePendingUser(1, now));

      const first = await backend.userRepository.findById(userId(1));
      if (first === null || first.entity.status !== "pending") {
        throw new Error("seeded user missing");
      }
      const verified = User.verifyEmail(first.entity, now).entity;
      await backend.userRepository.save(verified, first.expectedVersion);

      const reread = await backend.userRepository.findById(userId(1));
      expect(reread?.entity.status).toBe("active");
      expect(reread?.expectedVersion).toBe(1);
    });

    it("ADP-identity-003: save with a stale token raises OPTIMISTIC_LOCK_FAILURE", async () => {
      const now = backend.clock.now();
      await backend.userRepository.insert(makePendingUser(1, now));

      const stale = await backend.userRepository.findById(userId(1));
      const fresh = await backend.userRepository.findById(userId(1));
      if (
        stale === null ||
        fresh === null ||
        stale.entity.status !== "pending" ||
        fresh.entity.status !== "pending"
      ) {
        throw new Error("seeded user missing");
      }
      await backend.userRepository.save(
        User.verifyEmail(fresh.entity, now).entity,
        fresh.expectedVersion,
      );

      await expectConflict(
        backend.userRepository.save(
          User.verifyEmail(stale.entity, now).entity,
          stale.expectedVersion,
        ),
        "OPTIMISTIC_LOCK_FAILURE",
      );
    });

    it("ADP-identity-004: delete honours the version token", async () => {
      const now = backend.clock.now();
      await backend.userRepository.insert(makePendingUser(1, now));

      const first = await backend.userRepository.findById(userId(1));
      if (first === null || first.entity.status !== "pending") {
        throw new Error("seeded user missing");
      }
      await backend.userRepository.save(
        User.verifyEmail(first.entity, now).entity,
        first.expectedVersion,
      );

      await expectConflict(
        backend.userRepository.delete(userId(1), first.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );

      const fresh = await backend.userRepository.findById(userId(1));
      if (fresh === null) {
        throw new Error("seeded user missing");
      }
      await backend.userRepository.delete(userId(1), fresh.expectedVersion);
      expect(await backend.userRepository.findById(userId(1))).toBeNull();
    });
  });
}
