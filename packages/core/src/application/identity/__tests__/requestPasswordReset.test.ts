import { encodeDevAuthorizationCode } from "@repo/core/adapters/oauth/devSignInOAuthClient";
import { isNotFoundError } from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { completeOAuthSignIn } from "../completeOAuthSignIn";
import { requestPasswordReset } from "../requestPasswordReset";
import { resetPassword } from "../resetPassword";
import { startOAuthFlow } from "../startOAuthFlow";
import {
  DEFAULT_PASSWORD,
  latestPasswordResetToken,
  markDeleting,
  signUpVerified,
} from "./authFlowHelpers";

const SECOND_MS = 1000;

const resetMails = (h: TestHarness) =>
  h.mailSender.sent().filter((mail) => mail.template.kind === "passwordReset");

const unavailableMails = (h: TestHarness) =>
  h.mailSender
    .sent()
    .filter((mail) => mail.template.kind === "passwordResetUnavailable");

const resetTokens = (h: TestHarness) =>
  h.backend.authTokens
    .values()
    .filter((token) => token.purpose === "password_reset");

const request = (h: TestHarness, email: string) =>
  requestPasswordReset({ container: h.container, input: { email } });

/** Registers an active user whose only identity is a Google account. */
async function signUpWithGoogle(
  h: TestHarness,
  email = "google-user@example.com",
): Promise<string> {
  const { authorizationUrl, stateBinding } = await startOAuthFlow({
    container: h.container,
    input: { provider: "google", intent: "signIn", redirectTo: null },
  });
  const codeChallenge = new URL(authorizationUrl).searchParams.get(
    "code_challenge",
  );
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (codeChallenge === null || state === null) {
    throw new Error("authorization URL is missing PKCE parameters");
  }
  const view = await completeOAuthSignIn({
    container: h.container,
    input: {
      state,
      stateBinding,
      code: encodeDevAuthorizationCode({
        providerAccountId: "google-account-1",
        email,
        emailVerified: true,
        displayName: "Google User",
        codeChallenge,
      }),
    },
  });
  return view.userId;
}

describe("requestPasswordReset", () => {
  it("TC-identity-187: replaces the pending token and mails the new one", async () => {
    const h = createTestHarness();
    await signUpVerified(h);

    await request(h, "user@example.com");
    const first = resetTokens(h)[0];
    h.clock.advance(61 * SECOND_MS);
    await request(h, "user@example.com");

    const tokens = resetTokens(h);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.id).not.toBe(first?.id);
    expect(tokens[0]?.status).toBe("pending");
    expect(resetMails(h)).toHaveLength(2);
  });

  it("TC-identity-188: mails the unavailable notice for a Google-only account", async () => {
    const h = createTestHarness();
    await signUpWithGoogle(h);

    await expect(request(h, "google-user@example.com")).resolves.toEqual({});

    expect(unavailableMails(h)).toHaveLength(1);
    expect(resetMails(h)).toHaveLength(0);
    expect(resetTokens(h)).toHaveLength(0);
  });

  it("TC-identity-189: sends nothing for an address whose account is deleting", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    markDeleting(h, userId);
    const mailsBefore = h.mailSender.sent().length;

    await expect(request(h, "user@example.com")).resolves.toEqual({});

    expect(h.mailSender.sent()).toHaveLength(mailsBefore);
    expect(resetTokens(h)).toHaveLength(0);
  });

  it("TC-identity-190: answers identically for an unregistered address", async () => {
    const h = createTestHarness();

    await expect(request(h, "nobody@example.com")).resolves.toEqual({});

    expect(h.mailSender.sent()).toHaveLength(0);
    expect(resetTokens(h)).toHaveLength(0);
  });

  it("TC-identity-191: rejects a malformed address with InvalidEmail", async () => {
    const h = createTestHarness();

    await expect(request(h, "not-an-email")).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.InvalidEmail,
    );
    expect(h.mailSender.sent()).toHaveLength(0);
  });

  it("TC-identity-192: throttles a second request inside the interval", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    await request(h, "user@example.com");
    const issued = resetTokens(h)[0];
    h.clock.advance(59 * SECOND_MS);

    await expect(request(h, "user@example.com")).resolves.toEqual({});

    expect(resetMails(h)).toHaveLength(1);
    expect(resetTokens(h)[0]).toEqual(issued);
  });

  it("TC-identity-193: retires the previous unconsumed token", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    await request(h, "user@example.com");
    const superseded = latestPasswordResetToken(h);
    h.clock.advance(61 * SECOND_MS);
    await request(h, "user@example.com");
    const current = latestPasswordResetToken(h);

    await expect(
      resetPassword({
        container: h.container,
        input: { token: superseded, newPassword: "supersededpw1" },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isNotFoundError(error) && error.code === "AUTH_TOKEN_NOT_FOUND",
    );
    await expect(
      resetPassword({
        container: h.container,
        input: { token: current, newPassword: `${DEFAULT_PASSWORD}x` },
      }),
    ).resolves.toMatchObject({ userId: expect.any(String) });
  });
});
