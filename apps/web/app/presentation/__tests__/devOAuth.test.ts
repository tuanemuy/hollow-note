import { isValidationError } from "@repo/core/application/errors";
import { describe, expect, it } from "vitest";
import { devApprovalRedirect, devDenialRedirect } from "../devOAuth";

const APP_URL = "https://app.example.test";

const invalidRedirect = (run: () => unknown): void => {
  try {
    run();
  } catch (error) {
    expect(isValidationError(error) && error.code).toBe("INVALID_REDIRECT");
    return;
  }
  throw new Error("expected a ValidationError");
};

describe("devOAuth redirects", () => {
  it("carries code + state back to a same-origin redirect_uri", () => {
    const url = new URL(
      devApprovalRedirect({
        appUrl: APP_URL,
        redirectUri: `${APP_URL}/auth/callback/google`,
        state: "state-1",
        code: "code-1",
      }),
    );
    expect(url.pathname).toBe("/auth/callback/google");
    expect(url.searchParams.get("code")).toBe("code-1");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("carries error=access_denied + state on cancel", () => {
    const url = new URL(
      devDenialRedirect({
        appUrl: APP_URL,
        redirectUri: `${APP_URL}/auth/callback/google`,
        state: "state-1",
      }),
    );
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code")).toBeNull();
  });

  it("refuses a redirect_uri on another origin", () => {
    invalidRedirect(() =>
      devApprovalRedirect({
        appUrl: APP_URL,
        redirectUri: "https://evil.example/auth/callback/google",
        state: "state-1",
        code: "code-1",
      }),
    );
  });

  it("refuses a redirect_uri that is not a URL", () => {
    invalidRedirect(() =>
      devDenialRedirect({
        appUrl: APP_URL,
        redirectUri: "/auth/callback/google",
        state: "state-1",
      }),
    );
  });
});
