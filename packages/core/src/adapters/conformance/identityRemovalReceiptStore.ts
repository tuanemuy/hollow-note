import { beforeEach, describe, expect, it } from "vitest";
import type { IdentityRemovalReceipt } from "../../application/ports/identityRemovalReceiptStore";
import { IdentityId } from "../../domain/identity/valueObject";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { userId } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shared conformance suite for `IdentityRemovalReceiptStore` (ADR-015 /
 * steps.md step 1): retention record of a removed identity, read back by
 * either the removal operation or the identity it describes.
 */
export function describeIdentityRemovalReceiptStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`IdentityRemovalReceiptStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    const receipt = (
      n: number,
      overrides: Partial<IdentityRemovalReceipt> = {},
    ): IdentityRemovalReceipt => ({
      operationId: `removal-${n}`,
      identityId: IdentityId.create(`identity-${n}`),
      userId: userId(1),
      kind: "oauth",
      providerAccountKey: `google:account-${n}`,
      expiresAt: new Date(backend.clock.now().getTime() + 30 * DAY_MS),
      ...overrides,
    });

    it("records a receipt readable by operation id and by identity id", async () => {
      const stored = receipt(1);
      await backend.identityRemovalReceiptStore.record(stored);

      expect(
        await backend.identityRemovalReceiptStore.findByOperationId(
          "removal-1",
        ),
      ).toEqual(stored);
      expect(
        await backend.identityRemovalReceiptStore.findByIdentityId(
          IdentityId.create("identity-1"),
        ),
      ).toEqual(stored);
    });

    it("returns null for an unknown operation or identity", async () => {
      expect(
        await backend.identityRemovalReceiptStore.findByOperationId("absent"),
      ).toBeNull();
      expect(
        await backend.identityRemovalReceiptStore.findByIdentityId(
          IdentityId.create("absent"),
        ),
      ).toBeNull();
    });

    it("keeps the first receipt when the same removal is recorded again", async () => {
      await backend.identityRemovalReceiptStore.record(receipt(1));
      await backend.identityRemovalReceiptStore.record(
        receipt(1, { providerAccountKey: "rewritten" }),
      );

      const found =
        await backend.identityRemovalReceiptStore.findByOperationId(
          "removal-1",
        );
      expect(found?.providerAccountKey).toBe("google:account-1");
    });

    it("keeps the provider account key of a password identity null", async () => {
      await backend.identityRemovalReceiptStore.record(
        receipt(2, { kind: "password", providerAccountKey: null }),
      );

      const found =
        await backend.identityRemovalReceiptStore.findByOperationId(
          "removal-2",
        );
      expect(found?.kind).toBe("password");
      expect(found?.providerAccountKey).toBeNull();
    });

    it("sweeps only expired receipts, paging by keyset", async () => {
      const now = backend.clock.now();
      await backend.identityRemovalReceiptStore.record(
        receipt(1, { expiresAt: new Date(now.getTime() - 1) }),
      );
      await backend.identityRemovalReceiptStore.record(
        receipt(2, { expiresAt: new Date(now.getTime() - 1) }),
      );
      await backend.identityRemovalReceiptStore.record(
        receipt(3, { expiresAt: new Date(now.getTime() + DAY_MS) }),
      );

      const first = await backend.identityRemovalReceiptStore.deleteExpired(
        now,
        null,
        1,
      );
      expect(first.deleted).toBe(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await backend.identityRemovalReceiptStore.deleteExpired(
        now,
        first.nextCursor,
        10,
      );
      expect(second.deleted).toBe(1);
      expect(second.nextCursor).toBeNull();

      expect(
        await backend.identityRemovalReceiptStore.findByOperationId(
          "removal-3",
        ),
      ).not.toBeNull();
    });
  });
}
