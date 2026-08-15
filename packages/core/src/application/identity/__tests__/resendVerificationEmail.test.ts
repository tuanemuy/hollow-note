import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { resendVerificationEmail } from "../resendVerificationEmail";
import {
  latestVerificationToken,
  signUpPending,
  signUpVerified,
} from "./authFlowHelpers";

const SECOND_MS = 1000;

const verificationMails = (h: TestHarness) =>
  h.mailSender
    .sent()
    .filter((mail) => mail.template.kind === "emailVerification");

const resend = (h: TestHarness, email: string) =>
  resendVerificationEmail({ container: h.container, input: { email } });

describe("resendVerificationEmail", () => {
  it("TC-identity-194: replaces the pending token and mails the new one", async () => {
    const h = createTestHarness();
    const { verificationToken } = await signUpPending(h);
    const original = h.backend.authTokens.values()[0];
    h.clock.advance(61 * SECOND_MS);

    await resend(h, "user@example.com");

    const tokens = h.backend.authTokens.values();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.id).not.toBe(original?.id);
    expect(tokens[0]?.status).toBe("pending");
    expect(verificationMails(h)).toHaveLength(2);
    expect(latestVerificationToken(h)).not.toBe(verificationToken);
  });

  it("TC-identity-195: sends nothing within 59s of the last issue", async () => {
    const h = createTestHarness();
    await signUpPending(h);
    const original = h.backend.authTokens.values()[0];
    h.clock.advance(59 * SECOND_MS);

    await expect(resend(h, "user@example.com")).resolves.toEqual({});

    expect(verificationMails(h)).toHaveLength(1);
    expect(h.backend.authTokens.values()[0]).toEqual(original);
  });

  it("TC-identity-196: sends again once 61s have passed (interval boundary)", async () => {
    const h = createTestHarness();
    await signUpPending(h);
    h.clock.advance(61 * SECOND_MS);

    await resend(h, "user@example.com");

    expect(verificationMails(h)).toHaveLength(2);
  });

  it("TC-identity-197: sends nothing for an already active user", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    h.clock.advance(61 * SECOND_MS);
    const tokensBefore = h.backend.authTokens.values();

    await expect(resend(h, "user@example.com")).resolves.toEqual({});

    expect(verificationMails(h)).toHaveLength(1);
    expect(h.backend.authTokens.values()).toEqual(tokensBefore);
  });

  it("TC-identity-198: answers identically for an unregistered address", async () => {
    const h = createTestHarness();

    await expect(resend(h, "nobody@example.com")).resolves.toEqual({});

    expect(h.mailSender.sent()).toHaveLength(0);
    expect(h.backend.authTokens.size).toBe(0);
  });

  it("TC-identity-199: rejects a malformed address with InvalidEmail", async () => {
    const h = createTestHarness();

    await expect(resend(h, "not-an-email")).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.InvalidEmail,
    );
    expect(h.mailSender.sent()).toHaveLength(0);
  });
});
