import { createHash } from "node:crypto";
import { ValidationError } from "../../application/errors";
import type {
  OAuthProfile,
  SignInOAuthClient,
} from "../../domain/identity/ports/signInOAuthClient";
import { OAuthProvider } from "../../domain/identity/valueObject";
import { deriveCodeChallengeS256 } from "./pkce";

/** Consent-screen route the dev IdP redirects to (ADR-021). */
export const DEV_AUTHORIZE_PATH = "/dev/oauth/authorize";

/** Grant the dev consent screen encodes into its authorization code. */
export type DevAuthorizationGrant = Readonly<{
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  /** PKCE challenge of the authorization request this grant answers. */
  codeChallenge: string;
}>;

/**
 * Stable provider-account id for a dev address, so signing in twice with
 * the same address lands on the same identity instead of forever
 * creating new accounts.
 */
export function devProviderAccountId(email: string): string {
  return createHash("sha256")
    .update(`dev-oauth:${email.trim().toLowerCase()}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * The dev authorization code is a plain base64url JSON envelope — it
 * carries no signature on purpose. The consent route (`apps/web`) and
 * this adapter run in the same process but in **separate module graphs**
 * (SSR / RSC), so a module-level secret would differ between the writer
 * and the reader. Integrity adds nothing here anyway: the whole IdP is
 * the developer's own machine and the route only exists while
 * `OAUTH_DEV_MODE` is on (ADR-003 forbids it in production).
 */
export function encodeDevAuthorizationCode(
  grant: DevAuthorizationGrant,
): string {
  return Buffer.from(JSON.stringify({ v: 1, ...grant }), "utf8").toString(
    "base64url",
  );
}

const invalidCode = (): ValidationError =>
  new ValidationError("OAUTH_CODE_INVALID", "Authorization code is invalid");

function decodeDevAuthorizationCode(code: string): DevAuthorizationGrant {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(code, "base64url").toString("utf8"));
  } catch {
    throw invalidCode();
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw invalidCode();
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.v !== 1 ||
    typeof record.providerAccountId !== "string" ||
    record.providerAccountId.length === 0 ||
    typeof record.email !== "string" ||
    typeof record.emailVerified !== "boolean" ||
    typeof record.codeChallenge !== "string" ||
    (record.displayName !== null && typeof record.displayName !== "string")
  ) {
    throw invalidCode();
  }
  return {
    providerAccountId: record.providerAccountId,
    email: record.email,
    emailVerified: record.emailVerified,
    displayName: record.displayName,
    codeChallenge: record.codeChallenge,
  };
}

/**
 * Loopback identity provider for local development and manual testing
 * (ADR-003). This is a peer provider implementation, not a degraded
 * Google: it owns a real consent screen (`/dev/oauth/authorize`) so the
 * approve **and** cancel paths can both be exercised without Google
 * credentials.
 */
export function createDevSignInOAuthClient(
  options: Readonly<{ appUrl: string }>,
): SignInOAuthClient {
  return {
    deriveCodeChallenge: deriveCodeChallengeS256,

    buildAuthorizationUrl(params): string {
      const url = new URL(DEV_AUTHORIZE_PATH, options.appUrl);
      url.searchParams.set("client_id", `dev-${params.provider}`);
      url.searchParams.set("redirect_uri", params.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", params.state);
      url.searchParams.set("code_challenge", params.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async exchangeCode(params): Promise<OAuthProfile> {
      const grant = decodeDevAuthorizationCode(params.code);
      // The verifier is checked against the challenge the consent screen
      // was asked for, so a code stolen from the redirect is useless
      // without the flow's verifier — the same property PKCE gives the
      // real provider.
      if (
        grant.codeChallenge !== deriveCodeChallengeS256(params.codeVerifier)
      ) {
        throw invalidCode();
      }
      return {
        provider: OAuthProvider.create(params.provider),
        providerAccountId: grant.providerAccountId,
        email: grant.email,
        emailVerified: grant.emailVerified,
        displayName: grant.displayName,
        avatarUrl: null,
      };
    },
  };
}
