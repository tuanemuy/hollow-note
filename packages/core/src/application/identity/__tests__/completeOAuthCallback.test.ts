import { isValidationError } from "@repo/core/application/errors";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { completeOAuthCallback } from "../completeOAuthCallback";
import {
  beginOAuthFlow,
  devAuthorizationCode,
  signUpVerified,
} from "./authFlowHelpers";

/**
 * The `/auth/callback/:provider` dispatcher (ADR-007, AC-9). What is
 * pinned here is the branching evidence itself: the stored intent
 * chooses the usecase, the path's provider has to agree with the stored
 * one, and a state answers exactly once.
 */

const EMAIL = "user@example.com";

const callback = (
  h: TestHarness,
  input: Readonly<{ provider?: string; state: string; code: string }>,
) =>
  completeOAuthCallback({
    container: h.container,
    input: {
      provider: input.provider ?? "google",
      state: input.state,
      code: input.code,
    },
  });

const identitiesOf = (h: TestHarness, userId: string) =>
  h.backend.identities.values().filter((row) => row.userId === userId);

const expectStateInvalid = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) =>
      isValidationError(error) && error.code === "OAUTH_STATE_INVALID",
  );

describe("completeOAuthCallback", () => {
  it("dispatches a signIn state to the sign-in usecase and issues a session", async () => {
    const h = createTestHarness();
    const flow = await beginOAuthFlow(h, {
      intent: "signIn",
      redirectTo: "/notes",
    });

    const view = await callback(h, {
      state: flow.state,
      code: devAuthorizationCode(flow, { email: EMAIL }),
    });

    expect(view).toMatchObject({
      intent: "signIn",
      created: true,
      redirectTo: "/notes",
    });
    if (view.intent !== "signIn") {
      throw new Error("expected the sign-in arm");
    }
    expect(view.sessionToken.length).toBeGreaterThan(0);
    expect(h.backend.users.get(view.userId)?.status).toBe("active");
    expect(identitiesOf(h, view.userId)).toHaveLength(1);
  });

  it("dispatches a linkIdentity state to the link usecase, carrying the flow's redirectTo", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const sessionsBefore = h.backend.sessions.size;
    const flow = await beginOAuthFlow(h, {
      intent: "linkIdentity",
      userId,
      redirectTo: "/settings/auth",
    });

    const view = await callback(h, {
      state: flow.state,
      code: devAuthorizationCode(flow, {
        email: "linked@example.com",
        providerAccountId: "google-account-link",
      }),
    });

    expect(view).toMatchObject({
      intent: "linkIdentity",
      redirectTo: "/settings/auth",
    });
    if (view.intent !== "linkIdentity") {
      throw new Error("expected the link arm");
    }
    expect(
      identitiesOf(h, userId).find((row) => row.id === view.identityId),
    ).toMatchObject({ provider: "google" });
    // The link arm authenticates nobody: no session may be minted.
    expect(h.backend.sessions.size).toBe(sessionsBefore);
    expect(view).not.toHaveProperty("sessionToken");
  });

  it("refuses a state whose provider disagrees with the callback path", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const flow = await beginOAuthFlow(h, { intent: "linkIdentity", userId });
    const sessionsBefore = h.backend.sessions.size;

    await expectStateInvalid(
      callback(h, {
        provider: "github",
        state: flow.state,
        code: devAuthorizationCode(flow, {
          providerAccountId: "google-account-link",
        }),
      }),
    );

    expect(identitiesOf(h, userId)).toHaveLength(1);
    expect(h.backend.sessions.size).toBe(sessionsBefore);
    // The mismatch is decided after the atomic take, so the state is
    // burnt: a second attempt on the honest path cannot revive it.
    await expectStateInvalid(
      callback(h, {
        state: flow.state,
        code: devAuthorizationCode(flow, {
          providerAccountId: "google-account-link",
        }),
      }),
    );
  });

  it("refuses an integration state, which no usecase of this slice may run", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    const state = "integration-state";
    await h.container.oauthStateStore.put(
      state,
      {
        provider: "google",
        codeVerifier: "verifier-for-integration",
        redirectTo: "/settings/integrations",
        intent: "integration",
        userId: UserId.create(userId),
        userAuthEpoch: 0,
      },
      10 * 60 * 1000,
    );

    await expectStateInvalid(callback(h, { state, code: "unused" }));

    expect(identitiesOf(h, userId)).toHaveLength(1);
    expect(h.backend.oauthStates.get(state)).toBeUndefined();
  });

  it("refuses the second use of a state the first callback already consumed", async () => {
    const h = createTestHarness();
    const flow = await beginOAuthFlow(h, { intent: "signIn" });
    const code = devAuthorizationCode(flow, { email: EMAIL });
    const first = await callback(h, { state: flow.state, code });
    if (first.intent !== "signIn") {
      throw new Error("expected the sign-in arm");
    }

    await expectStateInvalid(callback(h, { state: flow.state, code }));

    expect(h.backend.users.values()).toHaveLength(1);
    expect(identitiesOf(h, first.userId)).toHaveLength(1);
    expect(h.backend.sessions.size).toBe(1);
  });
});
