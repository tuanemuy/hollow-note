import { beforeEach, describe, expect, it } from "vitest";
import type { SignInOAuthClient } from "../../domain/identity/ports/signInOAuthClient";
import type { OAuthProvider } from "../../domain/identity/valueObject";
import { expectValidation } from "./asserts";

/**
 * How the adapter under test can be driven through a code exchange.
 * `offline` providers (the dev IdP) can mint their own authorization
 * code, so the exchange contract is verifiable without a network;
 * `live` providers can only be checked up to the request they build.
 */
export type SignInOAuthExchangeMode =
  | Readonly<{
      kind: "offline";
      mintCode: (
        grant: Readonly<{
          providerAccountId: string;
          email: string;
          emailVerified: boolean;
          displayName: string | null;
          codeChallenge: string;
        }>,
      ) => string;
    }>
  | Readonly<{ kind: "live" }>;

export type SignInOAuthClientHarness = Readonly<{
  client: SignInOAuthClient;
  provider: OAuthProvider;
  redirectUri: string;
  exchange: SignInOAuthExchangeMode;
}>;

export type MakeSignInOAuthClientHarness = () =>
  | SignInOAuthClientHarness
  | Promise<SignInOAuthClientHarness>;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Shared conformance suite for `SignInOAuthClient` (ADP-identity-033/034).
 *
 * The PKCE half is a pure function and runs for every adapter; the
 * exchange half needs an adapter that can mint its own code, so a live
 * provider only contributes the authorization-request contract.
 *
 * `enabled: false` keeps the registration line in place while the
 * provider's credentials are absent (AC-6) — the suite is skipped, not
 * deleted, so the missing credentials are visible in the test report.
 */
export function describeSignInOAuthClientContract(
  adapterName: string,
  makeHarness: MakeSignInOAuthClientHarness,
  options: Readonly<{ enabled?: boolean }> = {},
): void {
  const suite = options.enabled === false ? describe.skip : describe;

  suite(`SignInOAuthClient conformance [${adapterName}]`, () => {
    let harness: SignInOAuthClientHarness;

    beforeEach(async () => {
      harness = await makeHarness();
    });

    it("derives a 43-character base64url S256 challenge, deterministically", () => {
      const challenge = harness.client.deriveCodeChallenge("verifier-1");
      expect(challenge).toHaveLength(43);
      expect(challenge).toMatch(BASE64URL);
      expect(harness.client.deriveCodeChallenge("verifier-1")).toBe(challenge);
      expect(harness.client.deriveCodeChallenge("verifier-2")).not.toBe(
        challenge,
      );
    });

    it("builds an authorization URL carrying state, redirect_uri and the S256 challenge", () => {
      const codeChallenge = harness.client.deriveCodeChallenge("verifier-1");
      const url = new URL(
        harness.client.buildAuthorizationUrl({
          provider: harness.provider,
          state: "state-1",
          codeChallenge,
          redirectUri: harness.redirectUri,
        }),
      );
      expect(url.searchParams.get("state")).toBe("state-1");
      expect(url.searchParams.get("redirect_uri")).toBe(harness.redirectUri);
      expect(url.searchParams.get("code_challenge")).toBe(codeChallenge);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("response_type")).toBe("code");
    });

    it("rejects a malformed authorization code with OAUTH_CODE_INVALID", async () => {
      if (harness.exchange.kind === "live") {
        return;
      }
      await expectValidation(
        harness.client.exchangeCode({
          provider: harness.provider,
          code: "not-a-code",
          codeVerifier: "verifier-1",
          redirectUri: harness.redirectUri,
        }),
        "OAUTH_CODE_INVALID",
      );
    });

    it("exchanges a code for the provider profile and propagates emailVerified", async () => {
      const exchange = harness.exchange;
      if (exchange.kind === "live") {
        return;
      }
      const codeVerifier = "verifier-1";
      const code = exchange.mintCode({
        providerAccountId: "provider-account-1",
        email: "oauth-user@example.com",
        emailVerified: false,
        displayName: "OAuth User",
        codeChallenge: harness.client.deriveCodeChallenge(codeVerifier),
      });

      const profile = await harness.client.exchangeCode({
        provider: harness.provider,
        code,
        codeVerifier,
        redirectUri: harness.redirectUri,
      });

      expect(profile).toEqual({
        provider: harness.provider,
        providerAccountId: "provider-account-1",
        email: "oauth-user@example.com",
        emailVerified: false,
        displayName: "OAuth User",
        avatarUrl: null,
      });
    });

    it("rejects a code whose PKCE challenge does not match the verifier", async () => {
      const exchange = harness.exchange;
      if (exchange.kind === "live") {
        return;
      }
      const code = exchange.mintCode({
        providerAccountId: "provider-account-1",
        email: "oauth-user@example.com",
        emailVerified: true,
        displayName: null,
        codeChallenge: harness.client.deriveCodeChallenge("verifier-1"),
      });

      await expectValidation(
        harness.client.exchangeCode({
          provider: harness.provider,
          code,
          codeVerifier: "verifier-2",
          redirectUri: harness.redirectUri,
        }),
        "OAUTH_CODE_INVALID",
      );
    });
  });
}
