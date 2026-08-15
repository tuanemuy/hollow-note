import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import type { WorkerContainer } from "../../di/types";
import { runDueScopeTasks } from "../../workers/scopeTaskRunner";
import { dispatchAccountDeletionCleanup } from "../deleteAccount/cleanupDispatch";
import {
  FINALIZE_ATTEMPT_FROM_UNIQUENESS,
  runAccountDeletionGlobalCleanup,
} from "../deleteAccount/globalCleanup";
import type { AccountDeletionDispatchContinuedInput } from "../deleteAccount/input";
import { signUpVerified, signUpWithGoogle } from "./authFlowHelpers";
import { runUntilSettled } from "./deletionDriver";
import {
  acceptDeletion,
  buildDeletionManifest,
  drainDeletion,
} from "./deletionHarness";

const EMAIL = "user@example.com";
const GOOGLE_ACCOUNT = "google-account-1";
const GOOGLE_EMAIL = "oauth-user@example.com";

const header = (h: TestHarness, operationId: string) =>
  h.backend.manifestHeaders.get(operationId);

const directoryKeys = (h: TestHarness): readonly string[] =>
  h.backend.uniqueDirectory
    .values()
    .map((row) => `${row.kind}:${row.normalizedKey}`);

const cleanupTurn = (
  operationId: string,
): AccountDeletionDispatchContinuedInput<"cleanup"> => ({
  type: "identity.accountDeletionDispatchContinued",
  operationId,
  phase: "cleanup",
  cursor: null,
});

const dispatchRows = (h: TestHarness, phase: string, cursor: string | null) =>
  h.backend.outbox.values().filter((row) => {
    if (row.type !== "identity.accountDeletionDispatchContinued") {
      return false;
    }
    const payload = row.payload as Readonly<{
      phase: string;
      cursor: string | null;
    }>;
    return payload.phase === phase && payload.cursor === cursor;
  });

/** Takes one turn's stored continuation away — a lost commit response. */
const dropDispatchRows = (
  h: TestHarness,
  phase: string,
  cursor: string | null,
): number => {
  const rows = dispatchRows(h, phase, cursor);
  for (const row of rows) {
    h.backend.outbox.delete(row.id);
  }
  return rows.length;
};

/** Drives both planes until neither has anything left to do. */
const quiesce = async (h: TestHarness): Promise<void> => {
  for (let round = 0; round < 32; round += 1) {
    const relayed = await drainDeletion(h);
    const { processed } = await runDueScopeTasks(h.workerContainer);
    if (relayed === 0 && processed === 0) {
      return;
    }
  }
  throw new Error("the deletion never went quiet");
};

describe("deleteAccount global cleanup", () => {
  it("reclaims the credential rows and frees every uniqueness key before finalize", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });

    expect(h.backend.sessions.values()).not.toHaveLength(0);
    await drainDeletion(h);

    expect(header(h, operationId)?.receipts).toEqual(
      expect.arrayContaining([
        "personalCleanup",
        "authResidue",
        "uniquenessRelease",
      ]),
    );
    expect(h.backend.sessions.values()).toHaveLength(0);
    expect(h.backend.authTokens.values()).toHaveLength(0);
    expect(directoryKeys(h)).toEqual([]);
    expect(h.backend.users.get(userId)?.status).toBe("deleted");
  });

  it("TC-identity-093: the address is free again once the deletion completes", async () => {
    const h = createTestHarness();
    const first = await signUpVerified(h, EMAIL);
    await acceptDeletion(h, { userId: first.userId, email: EMAIL });
    await drainDeletion(h);

    const second = await signUpVerified(h, EMAIL);

    expect(second.userId).not.toBe(first.userId);
    expect(h.backend.users.get(second.userId)?.status).toBe("active");
  });

  it("TC-identity-094: the provider account is free again and never resolves to the tombstone", async () => {
    const h = createTestHarness();
    const first = await signUpWithGoogle(h, {
      providerAccountId: GOOGLE_ACCOUNT,
    });
    await acceptDeletion(h, {
      userId: first.userId,
      email: GOOGLE_EMAIL,
    });
    await drainDeletion(h);
    expect(
      h.backend.identities
        .values()
        .filter((identity) => identity.userId === first.userId),
    ).toEqual([]);

    const second = await signUpWithGoogle(h, {
      providerAccountId: GOOGLE_ACCOUNT,
    });

    expect(second.userId).not.toBe(first.userId);
    expect(h.backend.users.get(second.userId)?.status).toBe("active");
  });

  it("re-driving the wave neither re-releases a key nor restarts the residue chain", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    await drainDeletion(h);

    await runAccountDeletionGlobalCleanup(h.workerContainer, {
      type: "identity.accountDeletionDispatchContinued",
      operationId,
      phase: "cleanup",
      cursor: null,
    });

    // The manifest is terminal by now, so the wave finds nothing to do
    // and leaves no continuation behind.
    expect(header(h, operationId)?.status).toBe("completed");
    expect(await drainDeletion(h)).toBe(0);
  });

  it("re-issues the finalize attempt when the receipt is in but the attempt it stored was lost", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    await buildDeletionManifest(h, operationId);

    // The release half of the first wave fails, so `uniquenessRelease`
    // becomes the last receipt the deletion is waiting for: every other
    // branch has already made its finalize attempt and been turned away.
    const withFailingRelease: WorkerContainer = {
      ...h.workerContainer,
      identityUniqueDirectory: {
        ...h.workerContainer.identityUniqueDirectory,
        beginRelease: () => Promise.reject(new Error("release response lost")),
      },
    };
    await dispatchAccountDeletionCleanup(
      h.workerContainer,
      cleanupTurn(operationId),
    );
    await expect(
      runAccountDeletionGlobalCleanup(
        withFailingRelease,
        cleanupTurn(operationId),
      ),
    ).rejects.toThrow();
    expect(dropDispatchRows(h, "cleanup", null)).toBe(1);
    await quiesce(h);
    expect(header(h, operationId)?.receipts).not.toContain("uniquenessRelease");
    expect(h.backend.users.get(userId)?.status).toBe("deleting");

    // The redelivered wave releases the keys and acknowledges, and its
    // response is lost before the finalize attempt reaches the relay.
    await runAccountDeletionGlobalCleanup(
      h.workerContainer,
      cleanupTurn(operationId),
    );
    expect(header(h, operationId)?.receipts).toContain("uniquenessRelease");
    expect(
      dropDispatchRows(h, "finalize", FINALIZE_ATTEMPT_FROM_UNIQUENESS),
    ).toBe(1);

    await runAccountDeletionGlobalCleanup(
      h.workerContainer,
      cleanupTurn(operationId),
    );

    expect(
      dispatchRows(h, "finalize", FINALIZE_ATTEMPT_FROM_UNIQUENESS),
    ).toHaveLength(1);
    expect(await runUntilSettled(h, operationId)).toBe("completed");
    expect(h.backend.users.get(userId)?.status).toBe("deleted");
    expect(directoryKeys(h)).toEqual([]);
  });
});
