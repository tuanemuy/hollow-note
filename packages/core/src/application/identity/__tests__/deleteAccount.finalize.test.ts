import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import type { AccountDeletionReceipt } from "../../ports/accountDeletionManifestStore";
import { dispatchAccountDeletionRedaction } from "../deleteAccount/authorRedaction";
import { compactAccountDeletionManifest } from "../deleteAccount/compaction";
import { finalizeAccountDeletion } from "../deleteAccount/finalize";
import { signUpVerified } from "./authFlowHelpers";
import {
  acceptDeletion,
  buildDeletionManifest,
  drainDeletion,
} from "./deletionHarness";

const EMAIL = "user@example.com";
const DAY_MS = 24 * 60 * 60 * 1000;

const RECEIPTS: readonly AccountDeletionReceipt[] = [
  "personalCleanup",
  "authResidue",
  "uniquenessRelease",
];

const seedAuthorRoutes = (
  h: TestHarness,
  userId: string,
  count: number,
): void => {
  for (let i = 0; i < count; i += 1) {
    const noteId = `note-${String(i).padStart(4, "0")}`;
    h.backend.noteRoutes.set(noteId, {
      noteId,
      scope: ScopeKey.user(UserId.create(userId)),
      createdBy: UserId.create(userId),
      routeVersion: 1,
      state: "active",
      target: null,
      migrationId: null,
      lastMigrationId: null,
      operationId: null,
      expiresAt: null,
    });
  }
};

const header = (h: TestHarness, operationId: string) =>
  h.backend.manifestHeaders.get(operationId);

const itemCount = (h: TestHarness, operationId: string): number =>
  h.backend.manifestItems
    .values()
    .filter((item) => item.operationId === operationId).length;

const finalize = (h: TestHarness, operationId: string) =>
  finalizeAccountDeletion(h.workerContainer, {
    type: "identity.accountDeletionDispatchContinued",
    operationId,
    phase: "finalize",
    cursor: null,
  });

const compact = (h: TestHarness, operationId: string, cursor: string | null) =>
  compactAccountDeletionManifest(h.workerContainer, {
    type: "identity.accountDeletionManifestCompactContinued",
    operationId,
    cursor,
  });

/**
 * Grants the global receipts directly: the paths that earn each of them
 * are covered by their own suites, and the compaction cases care only
 * that finalize's precondition is met.
 */
const grantReceipts = async (
  h: TestHarness,
  operationId: string,
): Promise<void> => {
  for (const receipt of RECEIPTS) {
    await h.workerContainer.accountDeletionManifestStore.acknowledgeReceipt(
      operationId,
      receipt,
    );
  }
};

const redactAll = async (
  h: TestHarness,
  operationId: string,
  turns: number,
): Promise<void> => {
  for (let turn = 0; turn < turns; turn += 1) {
    await dispatchAccountDeletionRedaction(h.workerContainer, {
      type: "identity.accountDeletionDispatchContinued",
      operationId,
      phase: "redaction",
      cursor: turn === 0 ? null : String(turn),
    });
  }
};

describe("deleteAccount finalize and compaction", () => {
  it("TC-identity-090 (without the retry-time record): an incomplete receipt set leaves the user deleting and its PII in place", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    await buildDeletionManifest(h, operationId);

    await finalize(h, operationId);

    const user = h.backend.users.get(userId);
    expect(user?.status).toBe("deleting");
    expect(user).toMatchObject({ email: EMAIL });
    expect(
      h.backend.identities.values().filter((row) => row.userId === userId),
    ).toHaveLength(1);
    expect(header(h, operationId)?.status).toBe("built");
    expect(
      h.logger.entries.some((entry) =>
        entry.message.includes("finalize is still waiting"),
      ),
    ).toBe(true);
    // The attempt has to leave the operation re-drivable: a terminal
    // state here would strand the account half-deleted.
    expect(h.backend.distributedOperations.get(operationId)?.state).toBe(
      "running",
    );
    expect(
      h.backend.outbox
        .values()
        .filter((row) => row.type === "identity.user.deleted"),
    ).toEqual([]);
  });

  it("TC-identity-091: the completed set drops the PII, tombstones the user and emits identity.user.deleted", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });

    await drainDeletion(h);

    expect(h.backend.users.get(userId)).toMatchObject({
      status: "deleted",
      id: userId,
    });
    expect(h.backend.users.get(userId)).not.toHaveProperty("email");
    expect(
      h.backend.identities.values().filter((row) => row.userId === userId),
    ).toEqual([]);
    expect(
      h.backend.outbox
        .values()
        .filter((row) => row.type === "identity.user.deleted"),
    ).toHaveLength(1);
    expect(header(h, operationId)).toMatchObject({ status: "completed" });
    expect(h.backend.distributedOperations.get(operationId)?.state).toBe(
      "completed",
    );
  });

  it("TC-identity-102: 101 acknowledged items compact as 100 + 1, and only the emptying turn terminates the header", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    seedAuthorRoutes(h, userId, 101);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    await buildDeletionManifest(h, operationId);
    await redactAll(h, operationId, 2);
    await grantReceipts(h, operationId);
    await finalize(h, operationId);
    expect(itemCount(h, operationId)).toBe(101);

    await compact(h, operationId, null);
    expect(itemCount(h, operationId)).toBe(1);
    expect(header(h, operationId)?.status).toBe("built");

    await compact(h, operationId, "1");

    expect(itemCount(h, operationId)).toBe(0);
    const terminal = header(h, operationId);
    expect(terminal?.status).toBe("completed");
    expect(terminal?.retainUntil?.getTime()).toBe(
      h.clock.now().getTime() + 120 * DAY_MS,
    );
  });

  it("TC-identity-103: 1,000 acknowledged items compact in 10 turns of at most 100", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    seedAuthorRoutes(h, userId, 1_000);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    await buildDeletionManifest(h, operationId);
    await redactAll(h, operationId, 10);
    await grantReceipts(h, operationId);
    await finalize(h, operationId);

    const perTurn: number[] = [];
    for (let turn = 0; turn < 10; turn += 1) {
      const before = itemCount(h, operationId);
      await compact(h, operationId, turn === 0 ? null : String(turn));
      perTurn.push(before - itemCount(h, operationId));
    }

    expect(perTurn).toEqual(Array.from({ length: 10 }, () => 100));
    expect(itemCount(h, operationId)).toBe(0);
    expect(header(h, operationId)?.status).toBe("completed");
  });

  it("a redelivered finalize re-arms compaction instead of touching the tombstone", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    seedAuthorRoutes(h, userId, 1);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    await buildDeletionManifest(h, operationId);
    await redactAll(h, operationId, 1);
    await grantReceipts(h, operationId);
    await finalize(h, operationId);
    const tombstone = h.backend.users.get(userId);

    await finalize(h, operationId);

    expect(h.backend.users.get(userId)).toEqual(tombstone);
    expect(
      h.backend.outbox
        .values()
        .filter(
          (row) =>
            row.type === "identity.accountDeletionManifestCompactContinued",
        ),
    ).toHaveLength(1);
  });
});
