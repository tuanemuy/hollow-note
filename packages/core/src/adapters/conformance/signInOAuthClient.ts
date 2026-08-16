import { beforeEach, describe, expect, it } from "vitest";
import type { SignInOAuthClient } from "../../domain/identity/ports/signInOAuthClient";
import type { OAuthProvider } from "../../domain/identity/valueObject";
import { expectValidation } from "./asserts";

export type MintAuthorizationCode = (
  grant: Readonly<{
    providerAccountId: string;
    email: string;
    emailVerified: boolean;
    displayName: string | null;
    codeChallenge: string;
  }>,
) => string;

/**
 * How the adapter under test can be driven through a code exchange.
 * `offline` providers (the dev IdP) can mint their own authorization
 * code, so the exchange contract is verifiable here; for anything else
 * the caller states why it cannot be, and the exchange cases register as
 * skipped instead of running empty.
 */
export type SignInOAuthExchangeMode =
  | Readonly<{ kind: "offline"; mintCode: MintAuthorizationCode }>
  | Readonly<{ kind: "unverifiable"; reason: string }>;

export type SignInOAuthClientHarness = Readonly<{
  client: SignInOAuthClient;
  provider: OAuthProvider;
  redirectUri: string;
}>;

export type MakeSignInOAuthClientHarness = () =>
  | SignInOAuthClientHarness
  | Promise<SignInOAuthClientHarness>;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Shared conformance suite for `SignInOAuthClient`
 * (ADP-identity-033, ADP-identity-034, ADP-identity-040).
 *
 * Split in two so that each half reports honestly (AC-6): the
 * authorization-request half is pure — challenge derivation and URL
 * building never talk to anyone — and runs for every registered adapter,
 * while the exchange half needs an authorization code the harness can
 * mint. An adapter that cannot mint one registers the exchange cases as
 * skipped, carrying the reason in the suite name, so "not verified here"
 * never reads as a passing case.
 */
export function describeSignInOAuthClientContract(
  adapterName: string,
  makeHarness: MakeSignInOAuthClientHarness,
  exchange: SignInOAuthExchangeMode,
): void {
  const gated = exchange.kind === "offline" ? describe : describe.skip;
  const exchangeSuite =
    exchange.kind === "offline"
      ? `SignInOAuthClient code exchange [${adapterName}]`
      : `SignInOAuthClient code exchange [${adapterName}] (unverifiable: ${exchange.reason})`;
  // `describe.skip` still collects its body, so the skipped half needs a
  // minter to close over. It throws rather than returning a dummy code:
  // if the gate is ever widened by mistake, the cases fail loudly
  // instead of passing without touching the adapter.
  const mintCode: MintAuthorizationCode =
    exchange.kind === "offline"
      ? exchange.mintCode
      : () => {
          throw new Error(
            `[${adapterName}] cannot mint an authorization code: ${exchange.reason}`,
          );
        };

  describe(`SignInOAuthClient authorization request [${adapterName}]`, () => {
    let harness: SignInOAuthClientHarness;

    beforeEach(async () => {
      harness = await makeHarness();
    });

    it("ADP-identity-040: derives a 43-character base64url S256 challenge, deterministically", () => {
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
  });

  gated(exchangeSuite, () => {
    let harness: SignInOAuthClientHarness;

    beforeEach(async () => {
      harness = await makeHarness();
    });

    it("rejects a malformed authorization code with OAUTH_CODE_INVALID", async () => {
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
      const codeVerifier = "verifier-1";
      const code = mintCode({
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
      const code = mintCode({
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
