import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { authenticateSession } from "../authenticateSession";
import { deleteAccount } from "../deleteAccount";
import { readUniquenessKeys } from "../deleteAccount/input";
import { signUpVerified, signUpWithGoogle } from "./authFlowHelpers";

const EMAIL = "user@example.com";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";

const request = (
  h: TestHarness,
  userId: string,
  overrides: Partial<{ confirmationEmail: string; requestId: string }> = {},
) =>
  deleteAccount({
    container: h.container,
    input: {
      type: "userRequest",
      userId,
      confirmationEmail: overrides.confirmationEmail ?? EMAIL,
      requestId: overrides.requestId ?? REQUEST_ID,
    },
  });

const storedUser = (h: TestHarness, userId: string) => {
  const user = h.backend.users.get(userId);
  if (user === undefined) {
    throw new Error(`no user row for ${userId}`);
  }
  return user;
};

const barrier = (h: TestHarness, userId: string) =>
  h.backend
    .scope(ScopeKey.user(UserId.create(userId)))
    .cleanupReceipts.values()[0];

const expectCode = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === code,
  );
};

describe("deleteAccount admission", () => {
  it("TC-identity-039: the request is accepted, the user turns deleting and the barrier closes the scope", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    const view = await request(h, userId);

    expect(view.status).toBe("accepted");
    const user = storedUser(h, userId);
    expect(user.status).toBe("deleting");
    expect(user.status === "deleting" && user.deletionOperationId).toBe(
      view.operationId,
    );
    expect(barrier(h, userId)).toMatchObject({
      operationId: view.operationId,
      status: "running",
      acknowledged: [],
      retainUntil: null,
    });
  });

  it("TC-identity-040: the epoch bump expires the live session without touching its row", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h, EMAIL);
    const epochBefore = storedUser(h, userId).authEpoch;

    await request(h, userId);

    expect(storedUser(h, userId).authEpoch).toBe(epochBefore + 1);
    await expectCode(
      authenticateSession({ container: h.container, input: { sessionToken } }),
      "UNAUTHENTICATED",
    );
    // Revocation is the generation, not the rows: physical cleanup is a
    // continuation and finalize waits for its acknowledgement.
    expect(h.backend.sessions.values()).toHaveLength(1);
  });

  it("TC-identity-049: a mismatched confirmation address creates no operation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    await expectCode(
      request(h, userId, { confirmationEmail: "typo@example.com" }),
      "CONFIRMATION_MISMATCH",
    );

    expect(h.backend.distributedOperations.values()).toHaveLength(0);
    expect(storedUser(h, userId).status).toBe("active");
  });

  it("TC-identity-054: a requestId that is not a UUID creates no operation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    await expectCode(
      request(h, userId, { requestId: "not-a-uuid" }),
      "INVALID_REQUEST_ID",
    );

    expect(h.backend.distributedOperations.values()).toHaveLength(0);
    expect(storedUser(h, userId).status).toBe("active");
  });

  it("TC-identity-050: re-requesting with the same requestId replays the same operation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    const first = await request(h, userId);
    const epochAfterFirst = storedUser(h, userId).authEpoch;
    const second = await request(h, userId);

    expect(second.operationId).toBe(first.operationId);
    expect(h.backend.distributedOperations.values()).toHaveLength(1);
    // The generation must not move again: the residue cleanup already
    // running for this operation would otherwise delete live credentials.
    expect(storedUser(h, userId).authEpoch).toBe(epochAfterFirst);
  });

  it("TC-identity-053: a different requestId joins the operation already running", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    const first = await request(h, userId);
    const second = await request(h, userId, { requestId: OTHER_REQUEST_ID });

    expect(second.operationId).toBe(first.operationId);
    expect(h.backend.distributedOperations.values()).toHaveLength(1);
  });

  it("freezes the uniqueness keys into the operation payload while the PII is alive", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h, {
      email: EMAIL,
      providerAccountId: "google-account-9",
    });

    const view = await request(h, userId);

    const operation = h.backend.distributedOperations.get(view.operationId);
    expect(operation).toBeDefined();
    if (operation === undefined) {
      return;
    }
    expect(readUniquenessKeys(operation.payload)).toEqual({
      email: EMAIL,
      handle: null,
      providerAccounts: ["google:google-account-9"],
    });
  });
});
