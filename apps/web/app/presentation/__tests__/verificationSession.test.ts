import { describe, expect, it } from "vitest";
import { shouldIssueVerificationSession } from "../verificationSession";

describe("shouldIssueVerificationSession", () => {
  it("issues a session when the pending cookie matches and a token was minted", () => {
    expect(
      shouldIssueVerificationSession("user-1", {
        userId: "user-1",
        sessionToken: "token",
      }),
    ).toBe(true);
  });

  it("refuses when the pending cookie belongs to another user (login CSRF)", () => {
    expect(
      shouldIssueVerificationSession("victim", {
        userId: "attacker",
        sessionToken: "token",
      }),
    ).toBe(false);
  });

  it("refuses when no pending cookie is present", () => {
    expect(
      shouldIssueVerificationSession(null, {
        userId: "user-1",
        sessionToken: "token",
      }),
    ).toBe(false);
  });

  it("refuses when the token was already consumed", () => {
    expect(
      shouldIssueVerificationSession("user-1", {
        userId: "user-1",
        sessionToken: null,
      }),
    ).toBe(false);
  });
});
