import { beforeEach, describe, expect, it } from "vitest";
import { Identity } from "../../domain/identity/identity";
import { IdentityId, PasswordHash } from "../../domain/identity/valueObject";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { makePasswordIdentity, userId } from "./fixtures";

/** Shared conformance suite for `IdentityRepository` (ADP-identity-010..014). */
export function describeIdentityRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`IdentityRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-identity-010/011: insert then findById round-trips", async () => {
      const now = backend.clock.now();
      const identity = makePasswordIdentity(1, userId(1), now);
      await backend.identityRepository.insert(identity);

      const found = await backend.identityRepository.findById(
        IdentityId.create("identity-1"),
      );
      expect(found?.entity).toEqual(identity);
      expect(found?.expectedVersion).toBe(0);
    });

    it("ADP-identity-012/013: save and delete enforce the version token", async () => {
      const now = backend.clock.now();
      await backend.identityRepository.insert(
        makePasswordIdentity(1, userId(1), now),
      );
      const first = await backend.identityRepository.findById(
        IdentityId.create("identity-1"),
      );
      if (first === null || first.entity.kind !== "password") {
        throw new Error("seeded identity missing");
      }
      const changed = Identity.changePassword(
        first.entity,
        PasswordHash.create("hash-rotated"),
        now,
      ).entity;
      await backend.identityRepository.save(changed, first.expectedVersion);

      await expectConflict(
        backend.identityRepository.save(changed, first.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      await expectConflict(
        backend.identityRepository.delete(
          IdentityId.create("identity-1"),
          first.expectedVersion,
        ),
        "OPTIMISTIC_LOCK_FAILURE",
      );

      const fresh = await backend.identityRepository.findById(
        IdentityId.create("identity-1"),
      );
      if (fresh === null) {
        throw new Error("seeded identity missing");
      }
      await backend.identityRepository.delete(
        IdentityId.create("identity-1"),
        fresh.expectedVersion,
      );
      expect(
        await backend.identityRepository.findById(
          IdentityId.create("identity-1"),
        ),
      ).toBeNull();
    });

    it("ADP-identity-014: listByUserId returns only the user's identities", async () => {
      const now = backend.clock.now();
      await backend.identityRepository.insert(
        makePasswordIdentity(1, userId(1), now),
      );
      await backend.identityRepository.insert(
        makePasswordIdentity(2, userId(2), now),
      );

      const listed = await backend.identityRepository.listByUserId(userId(1));
      expect(listed.map((identity) => identity.id)).toEqual(["identity-1"]);
      expect(await backend.identityRepository.listByUserId(userId(3))).toEqual(
        [],
      );
    });
  });
}
