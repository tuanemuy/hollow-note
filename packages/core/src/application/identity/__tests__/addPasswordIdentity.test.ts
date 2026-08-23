import { isConflictError } from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import { Identity } from "@repo/core/domain/identity/identity";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { addPasswordIdentity } from "../addPasswordIdentity";
import { completeOAuthSignIn } from "../completeOAuthSignIn";
import { signInWithPassword } from "../signInWithPassword";
import {
  beginOAuthFlow,
  devAuthorizationCode,
  signUpVerified,
  signUpWithGoogle,
} from "./authFlowHelpers";

const NEW_PASSWORD = "addedpassword1";

const add = (h: TestHarness, userId: string, newPassword = NEW_PASSWORD) =>
  addPasswordIdentity({
    container: h.container,
    input: { userId, newPassword },
  });

const identitiesOf = (h: TestHarness, userId: string) =>
  h.backend.identities.values().filter((row) => row.userId === userId);

/** Plants OAuth identities so the 8-method ceiling can be reached. */
function plantOAuthIdentities(
  h: TestHarness,
  userId: string,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const id = `planted-oauth-${index}`;
    const { entity } = Identity.createOAuth(
      {
        id,
        userId: UserId.create(userId),
        provider: "google",
        providerAccountId: `planted-account-${index}`,
        providerEmail: `planted-${index}@example.com`,
      },
      h.clock.now(),
    );
    h.backend.identities.set(id, entity);
  }
}

describe("addPasswordIdentity", () => {
  it("TC-identity-001: adds a password identity to a Google-only account and emits identity.added", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h);

    const view = await add(h, userId);

    const identities = identitiesOf(h, userId);
    expect(identities.map((row) => row.kind).sort()).toEqual([
      "oauth",
      "password",
    ]);
    expect(
      h.backend.outbox
        .values()
        .filter(
          (row) =>
            row.type === "identity.identity.added" &&
            (row.payload as { identityId: string }).identityId ===
              view.identityId,
        ),
    ).toHaveLength(1);
  });

  it("TC-identity-002: rejects a second password identity", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expect(add(h, userId)).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.PasswordIdentityAlreadyExists,
    );
  });

  it("TC-identity-003: rejects a password that fails the strength rules", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h);

    await expect(add(h, userId, "short")).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.WeakPassword,
    );
    expect(identitiesOf(h, userId)).toHaveLength(1);
  });

  it("TC-identity-004: the added password signs the user in", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h, {
      email: "google-only@example.com",
    });
    await add(h, userId);

    const view = await signInWithPassword({
      container: h.container,
      input: {
        email: "google-only@example.com",
        password: NEW_PASSWORD,
        clientKey: "client-1",
      },
    });

    expect(view.userId).toBe(userId);
  });

  it("TC-identity-005: two concurrent adds leave exactly one password identity", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h);

    const results = await Promise.allSettled([
      add(h, userId, "firstpassword1"),
      add(h, userId, "secondpassword1"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [rejected] = results.filter((result) => result.status === "rejected");
    if (rejected === undefined) {
      throw new Error("both concurrent adds succeeded");
    }
    expect(
      isConflictError(rejected.reason) ||
        (isBusinessRuleError(rejected.reason) &&
          rejected.reason.code ===
            IdentityErrorCode.PasswordIdentityAlreadyExists),
    ).toBe(true);
    expect(
      identitiesOf(h, userId).filter((row) => row.kind === "password"),
    ).toHaveLength(1);
  });

  it("TC-identity-006: refuses a 9th identity when 8 OAuth methods already exist", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h);
    plantOAuthIdentities(h, userId, 7);

    await expect(add(h, userId)).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.IdentityLimitExceeded,
    );
    expect(identitiesOf(h, userId)).toHaveLength(8);
  });

  it("TC-identity-007: a concurrent OAuth link and password add cannot exceed 8", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h);
    plantOAuthIdentities(h, userId, 6);
    const flow = await beginOAuthFlow(h, { intent: "signIn" });

    const results = await Promise.allSettled([
      add(h, userId),
      completeOAuthSignIn({
        container: h.container,
        input: {
          state: flow.state,
          stateBinding: flow.stateBinding,
          code: devAuthorizationCode(flow, {
            providerAccountId: "google-account-2",
            email: "oauth-user@example.com",
          }),
        },
      }),
    ]);

    expect(identitiesOf(h, userId).length).toBeLessThanOrEqual(8);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
  });
});
