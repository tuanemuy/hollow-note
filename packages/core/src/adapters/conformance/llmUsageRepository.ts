import { beforeEach, describe, expect, it } from "vitest";
import { LlmUsage } from "../../domain/usage/llmUsage";
import { BillingPeriod } from "../../domain/usage/valueObject";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { scopeOf, userId } from "./fixtures";

/**
 * Shared conformance suite for `LlmUsageRepository`
 * (ADP-usage-006..009): `(userId, period)`-keyed OCC and the bounded
 * per-user delete a cleanup turn uses.
 */
export function describeLlmUsageRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`LlmUsageRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let repository: ScopedConformancePorts["llmUsageRepository"];

    const may = BillingPeriod.create(2026, 5);
    const june = BillingPeriod.create(2026, 6);

    beforeEach(async () => {
      backend = await makeBackend();
      repository = backend.forScope(scopeOf(1)).llmUsageRepository;
    });

    it("ADP-usage-006/007: inserts one record per period and reads it back with a token", async () => {
      expect(await repository.find(userId(1), may)).toBeNull();

      await repository.insert(
        LlmUsage.initialize(userId(1), may, backend.clock.now()),
      );
      await repository.insert(
        LlmUsage.initialize(userId(1), june, backend.clock.now()),
      );

      const found = await repository.find(userId(1), may);
      expect(found?.entity.period).toEqual(may);
      expect(found?.expectedVersion).toBe(0);
      expect((await repository.find(userId(1), june))?.entity.period).toEqual(
        june,
      );
    });

    it("ADP-usage-008: saves only against the observed version", async () => {
      await repository.insert(
        LlmUsage.initialize(userId(1), may, backend.clock.now()),
      );
      const found = await repository.find(userId(1), may);
      if (found === null) {
        throw new Error("usage missing");
      }

      await repository.save(
        LlmUsage.consume(found.entity, 1, backend.clock.now()),
        found.expectedVersion,
      );
      await expectConflict(
        repository.save(
          LlmUsage.consume(found.entity, 1, backend.clock.now()),
          found.expectedVersion,
        ),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      expect(
        (await repository.find(userId(1), may))?.entity.consumedCalls,
      ).toBe(1);
    });

    it("ADP-usage-009: deletes a user's records in bounded pages, leaving other users alone", async () => {
      await repository.insert(
        LlmUsage.initialize(userId(1), may, backend.clock.now()),
      );
      await repository.insert(
        LlmUsage.initialize(userId(1), june, backend.clock.now()),
      );
      await repository.insert(
        LlmUsage.initialize(userId(2), may, backend.clock.now()),
      );

      expect(await repository.deleteByUser(userId(1), 1)).toBe(1);
      expect(await repository.deleteByUser(userId(1), 100)).toBe(1);
      expect(await repository.deleteByUser(userId(1), 100)).toBe(0);
      expect(await repository.find(userId(2), may)).not.toBeNull();
    });
  });
}
