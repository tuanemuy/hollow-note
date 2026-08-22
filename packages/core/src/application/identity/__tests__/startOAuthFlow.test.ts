import {
  isUnauthorizedError,
  isValidationError,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { signOutOtherSessions } from "../signOutOtherSessions";
import { type StartOAuthFlowInput, startOAuthFlow } from "../startOAuthFlow";
import { markDeleted, markDeleting, signUpVerified } from "./authFlowHelpers";

const TEN_MINUTES_MS = 10 * 60 * 1000;

const start = (h: TestHarness, input: Partial<StartOAuthFlowInput> = {}) =>
  startOAuthFlow({
    container: h.container,
    input: { provider: "google", intent: "signIn", ...input },
  });

const storedStates = (h: TestHarness) => h.backend.oauthStates.values();

describe("startOAuthFlow", () => {
  it("TC-identity-264: returns an authorization URL and parks state + verifier for 10 minutes", async () => {
    const h = createTestHarness();
    const before = h.clock.now();

    const view = await start(h);

    const url = new URL(view.authorizationUrl);
    const state = url.searchParams.get("state");
    expect(state).not.toBeNull();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${h.config.appUrl}/auth/callback/google`,
    );

    const rows = storedStates(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe(state);
    expect(rows[0]?.value.codeVerifier.length).toBeGreaterThan(0);
    expect(rows[0]?.value.intent).toBe("signIn");
    expect(rows[0]?.expiresAt.getTime()).toBe(
      before.getTime() + TEN_MINUTES_MS,
    );
  });

  it("TC-identity-336: the binding secret is stored as its digest and cannot be derived from the state", async () => {
    const h = createTestHarness();

    const view = await start(h);

    const state = new URL(view.authorizationUrl).searchParams.get("state");
    if (state === null) {
      throw new Error("authorization URL is missing state");
    }
    const saved = storedStates(h)[0]?.value;
    expect(saved?.stateBindingHash).toBe(
      h.container.secureTokenGenerator.hashOf(view.stateBinding),
    );
    // `state` round-trips through the provider's URLs, so anyone who sees
    // it must still be unable to reproduce the binding.
    expect(view.stateBinding).not.toBe(state);
    expect(saved?.stateBindingHash).not.toBe(
      h.container.secureTokenGenerator.hashOf(state),
    );
  });

  it("TC-identity-265: linkIdentity stores the authenticated user and its current epoch", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await start(h, { intent: "linkIdentity", userId });

    const stored = storedStates(h)[0]?.value;
    expect(stored?.intent).toBe("linkIdentity");
    expect(stored?.userId).toBe(userId);
    expect(stored?.userAuthEpoch).toBe(0);
  });

  it("TC-identity-265: the stored epoch is the generation the user is on, not the initial one", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    for (let round = 0; round < 2; round += 1) {
      await signOutOtherSessions({
        container: h.container,
        input: { userId, currentSessionToken: sessionToken },
      });
    }
    expect(h.backend.users.get(userId)?.authEpoch).toBe(2);

    await start(h, { intent: "linkIdentity", userId });

    expect(storedStates(h)[0]?.value.userAuthEpoch).toBe(2);
  });

  it("TC-identity-266: a user that started deletion is not an authenticated principal", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    markDeleting(h, userId);

    const error = await start(h, { intent: "linkIdentity", userId }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isUnauthorizedError(error)).toBe(true);
    expect(storedStates(h)).toHaveLength(0);
  });

  it("TC-identity-266: a tombstoned user is not an authenticated principal either", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    markDeleted(h, userId);

    const error = await start(h, { intent: "linkIdentity", userId }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isUnauthorizedError(error)).toBe(true);
    expect(storedStates(h)).toHaveLength(0);
  });

  it("TC-identity-267: linkIdentity without a userId is USER_REQUIRED", async () => {
    const h = createTestHarness();

    const error = await start(h, { intent: "linkIdentity" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isValidationError(error) && error.code).toBe("USER_REQUIRED");
    expect(storedStates(h)).toHaveLength(0);
  });

  it("TC-identity-268: an unknown provider is refused by the value object", async () => {
    const h = createTestHarness();

    const error = await start(h, { provider: "facebook" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isBusinessRuleError(error) && error.code).toBe(
      IdentityErrorCode.InvalidProviderAccount,
    );
    expect(storedStates(h)).toHaveLength(0);
  });

  it("TC-identity-269: a cross-origin redirectTo is INVALID_REDIRECT", async () => {
    const h = createTestHarness();

    for (const redirectTo of [
      "https://evil.example/notes",
      "//evil.example/notes",
      "/\n/evil.example",
      "notes",
    ]) {
      const error = await start(h, { redirectTo }).catch(
        (thrown: unknown) => thrown,
      );
      expect(isValidationError(error) && error.code).toBe("INVALID_REDIRECT");
    }
    expect(storedStates(h)).toHaveLength(0);
  });

  it("TC-identity-270: a relative redirectTo is kept in the stored state", async () => {
    const h = createTestHarness();

    await start(h, { redirectTo: "/notes/note-1" });

    expect(storedStates(h)[0]?.value.redirectTo).toBe("/notes/note-1");
  });

  it("TC-identity-271: two starts park two independent states", async () => {
    const h = createTestHarness();

    const first = new URL((await start(h)).authorizationUrl);
    const second = new URL((await start(h)).authorizationUrl);

    const firstState = first.searchParams.get("state");
    const secondState = second.searchParams.get("state");
    expect(firstState).not.toBe(secondState);
    expect(storedStates(h)).toHaveLength(2);
    expect(first.searchParams.get("code_challenge")).not.toBe(
      second.searchParams.get("code_challenge"),
    );
  });
});
