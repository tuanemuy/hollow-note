import { beforeEach, describe, expect, it } from "vitest";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { makePendingUser, userId } from "./fixtures";

/** Shared conformance suite for `UserBatchReader` (ADP-identity-005). */
export function describeUserBatchReaderContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`UserBatchReader conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-identity-005: resolveMany returns found users with version tokens, omitting misses", async () => {
      const now = backend.clock.now();
      await backend.userRepository.insert(makePendingUser(1, now));
      await backend.userRepository.insert(makePendingUser(2, now));

      const resolved = await backend.userBatchReader.resolveMany([
        userId(1),
        userId(2),
        userId(3),
      ]);
      expect(resolved.size).toBe(2);
      expect(resolved.get(userId(1))?.entity.id).toBe(userId(1));
      expect(resolved.get(userId(1))?.expectedVersion).toBe(0);
      expect(resolved.has(userId(3))).toBe(false);
    });

    it("ADP-identity-005: an empty input resolves to an empty map", async () => {
      expect((await backend.userBatchReader.resolveMany([])).size).toBe(0);
    });
  });
}
