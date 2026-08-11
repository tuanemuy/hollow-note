import { afterEach, describe, expect, it, vi } from "vitest";
import { isSystemError, SystemErrorCode } from "../../../application/errors";
import { createGoogleSignInOAuthClient } from "../googleSignInOAuthClient";

const REDIRECT_URI = "https://app.example.test/auth/callback/google";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGoogleSignInOAuthClient", () => {
  it("fails a hanging token endpoint as EXTERNAL_API_ERROR", async () => {
    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(signal.reason);
        });
      });
    });

    const client = createGoogleSignInOAuthClient(
      { clientId: "client-id", clientSecret: "client-secret" },
      { tokenEndpointTimeoutMs: 10 },
    );

    const error = await client
      .exchangeCode({
        provider: "google",
        code: "code-1",
        codeVerifier: "verifier-1",
        redirectUri: REDIRECT_URI,
      })
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(isSystemError(error)).toBe(true);
    if (isSystemError(error)) {
      expect(error.code).toBe(SystemErrorCode.ExternalApiError);
    }
  });
});
