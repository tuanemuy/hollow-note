import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { runAccountDeletionGlobalCleanup } from "../deleteAccount/globalCleanup";
import { signUpVerified, signUpWithGoogle } from "./authFlowHelpers";
import { acceptDeletion, drainDeletion } from "./deletionHarness";

const EMAIL = "user@example.com";
const GOOGLE_ACCOUNT = "google-account-1";
const GOOGLE_EMAIL = "oauth-user@example.com";

const header = (h: TestHarness, operationId: string) =>
  h.backend.manifestHeaders.get(operationId);

const directoryKeys = (h: TestHarness): readonly string[] =>
  h.backend.uniqueDirectory
    .values()
    .map((row) => `${row.kind}:${row.normalizedKey}`);

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
});
