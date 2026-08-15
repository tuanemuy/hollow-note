import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSystemError,
  isValidationError,
  SystemErrorCode,
} from "../../../application/errors";
import { createGoogleSignInOAuthClient } from "../googleSignInOAuthClient";

const REDIRECT_URI = "https://app.example.test/auth/callback/google";
const CLIENT_ID = "client-id";

const client = () =>
  createGoogleSignInOAuthClient({
    clientId: CLIENT_ID,
    clientSecret: "client-secret",
  });

const exchange = () =>
  client()
    .exchangeCode({
      provider: "google",
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: REDIRECT_URI,
    })
    .then(
      (value) => ({ ok: true as const, value }),
      (thrown: unknown) => ({ ok: false as const, error: thrown }),
    );

const idToken = (claims: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.signature`;

const validClaims = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: "google-sub-1",
  email: "user@example.test",
  email_verified: true,
  name: "Example User",
  picture: "https://example.test/avatar.png",
  ...overrides,
});

const stubTokenEndpoint = (
  status: number,
  body: string,
  contentType = "application/json",
): void => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(body, {
        status,
        headers: { "content-type": contentType },
      }),
  );
};

const stubIdToken = (claims: Record<string, unknown>): void => {
  stubTokenEndpoint(200, JSON.stringify({ id_token: idToken(claims) }));
};

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

    const result = await createGoogleSignInOAuthClient(
      { clientId: CLIENT_ID, clientSecret: "client-secret" },
      { tokenEndpointTimeoutMs: 10 },
    )
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

    expect(isSystemError(result) && result.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("fails an unreachable token endpoint as EXTERNAL_API_ERROR", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    const result = await exchange();

    expect(!result.ok && isSystemError(result.error) && result.error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("translates a rejected code (4xx) into OAUTH_CODE_INVALID", async () => {
    stubTokenEndpoint(400, JSON.stringify({ error: "invalid_grant" }));

    const result = await exchange();

    expect(
      !result.ok && isValidationError(result.error) && result.error.code,
    ).toBe("OAUTH_CODE_INVALID");
  });

  it("translates a provider outage (5xx) into EXTERNAL_API_ERROR", async () => {
    stubTokenEndpoint(503, "service unavailable", "text/plain");

    const result = await exchange();

    expect(!result.ok && isSystemError(result.error) && result.error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("translates a malformed token response into EXTERNAL_API_ERROR", async () => {
    stubTokenEndpoint(200, "not json");

    const result = await exchange();

    expect(!result.ok && isSystemError(result.error) && result.error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("translates a response without an id_token into EXTERNAL_API_ERROR", async () => {
    stubTokenEndpoint(200, JSON.stringify({ access_token: "at" }));

    const result = await exchange();

    expect(!result.ok && isSystemError(result.error) && result.error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("refuses an id_token minted by another issuer", async () => {
    stubIdToken(validClaims({ iss: "https://accounts.evil.test" }));

    const result = await exchange();

    expect(!result.ok && isSystemError(result.error) && result.error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("refuses an id_token issued for another client", async () => {
    stubIdToken(validClaims({ aud: "another-client-id" }));

    const result = await exchange();

    expect(!result.ok && isSystemError(result.error) && result.error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("refuses an expired id_token", async () => {
    stubIdToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 1 }));

    const result = await exchange();

    expect(!result.ok && isSystemError(result.error) && result.error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("refuses an id_token without sub or email", async () => {
    stubIdToken(validClaims({ sub: undefined, email: undefined }));

    const result = await exchange();

    expect(!result.ok && isSystemError(result.error) && result.error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
  });

  it("accepts an id_token whose aud array contains the client id", async () => {
    stubIdToken(validClaims({ aud: ["another-client-id", CLIENT_ID] }));

    const result = await exchange();

    expect(result.ok && result.value.providerAccountId).toBe("google-sub-1");
  });

  it("projects a verified id_token onto the profile", async () => {
    stubIdToken(validClaims());

    const result = await exchange();

    expect(result.ok && result.value).toEqual({
      provider: "google",
      providerAccountId: "google-sub-1",
      email: "user@example.test",
      emailVerified: true,
      displayName: "Example User",
      avatarUrl: "https://example.test/avatar.png",
    });
  });
});
