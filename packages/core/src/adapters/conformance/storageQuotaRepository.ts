import { beforeEach, describe, expect, it } from "vitest";
import { StorageQuota } from "../../domain/usage/storageQuota";
import { QuotaSubject } from "../../domain/usage/valueObject";
import { WorkspaceId } from "../../domain/workspace/valueObject";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { scopeOf, userId } from "./fixtures";

/**
 * Shared conformance suite for `StorageQuotaRepository`
 * (ADP-usage-001..005): subject-keyed OCC without a separate id.
 */
export function describeStorageQuotaRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`StorageQuotaRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let repository: ScopedConformancePorts["storageQuotaRepository"];

    const subject = QuotaSubject.user(userId(1));
    const workspaceSubject = QuotaSubject.workspace(WorkspaceId.create("w1"));

    beforeEach(async () => {
      backend = await makeBackend();
      repository = backend.forScope(scopeOf(1)).storageQuotaRepository;
    });

    it("ADP-usage-001/002: inserts a quota and reads it back with a version token", async () => {
      expect(await repository.find(subject)).toBeNull();

      await repository.insert(
        StorageQuota.initialize(subject, backend.clock.now()),
      );

      const found = await repository.find(subject);
      expect(found?.entity.subject).toEqual(subject);
      expect(found?.entity.consumedBytes).toBe(0);
      expect(found?.expectedVersion).toBe(0);
    });

    it("ADP-usage-003: saves only against the observed version", async () => {
      await repository.insert(
        StorageQuota.initialize(subject, backend.clock.now()),
      );
      const found = await repository.find(subject);
      if (found === null) {
        throw new Error("quota missing");
      }

      const updated = StorageQuota.add(found.entity, 100, backend.clock.now());
      await repository.save(updated, found.expectedVersion);

      // The stale token is refused, so a lost update cannot happen.
      await expectConflict(
        repository.save(
          StorageQuota.add(found.entity, 5, backend.clock.now()),
          found.expectedVersion,
        ),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      expect((await repository.find(subject))?.entity.consumedBytes).toBe(100);
    });

    it("ADP-usage-004: lists the quotas of the requested subjects only", async () => {
      await repository.insert(
        StorageQuota.initialize(subject, backend.clock.now()),
      );
      await repository.insert(
        StorageQuota.initialize(workspaceSubject, backend.clock.now()),
      );

      const listed = await repository.listBySubjects([
        subject,
        QuotaSubject.user(userId(2)),
      ]);
      expect(listed.map((quota) => quota.subject)).toEqual([subject]);
      expect(await repository.listBySubjects([])).toEqual([]);
    });

    it("ADP-usage-005: deletes a subject's quota and tolerates an absent one", async () => {
      await repository.insert(
        StorageQuota.initialize(subject, backend.clock.now()),
      );

      await repository.delete(subject);
      await repository.delete(subject);
      expect(await repository.find(subject)).toBeNull();
    });

    it("keeps quotas of different scopes apart", async () => {
      await repository.insert(
        StorageQuota.initialize(subject, backend.clock.now()),
      );

      expect(
        await backend.forScope(scopeOf(2)).storageQuotaRepository.find(subject),
      ).toBeNull();
    });
  });
}
