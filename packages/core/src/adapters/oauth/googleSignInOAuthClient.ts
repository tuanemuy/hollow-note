import {
  SystemError,
  SystemErrorCode,
  ValidationError,
} from "../../application/errors";
import type {
  OAuthProfile,
  SignInOAuthClient,
} from "../../domain/identity/ports/signInOAuthClient";
import { OAuthProvider } from "../../domain/identity/valueObject";
import { deriveCodeChallengeS256 } from "./pkce";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "openid email profile";
const DEFAULT_TOKEN_ENDPOINT_TIMEOUT_MS = 10_000;

export type GoogleOAuthCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

export type GoogleOAuthClientOptions = Readonly<{
  /** Wall-clock budget for the token-endpoint round trip. */
  tokenEndpointTimeoutMs?: number;
}>;

const invalidCode = (cause?: unknown): ValidationError =>
  new ValidationError(
    "OAUTH_CODE_INVALID",
    "Authorization code was rejected by the provider",
    undefined,
    cause,
  );

const unreachable = (message: string, cause?: unknown): SystemError =>
  new SystemError(SystemErrorCode.ExternalApiError, message, cause);

type IdTokenClaims = Readonly<{
  sub: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  picture: string | null;
}>;

/**
 * Reads the claims of an `id_token` **without** verifying its signature.
 * That is the one case OIDC Core §3.1.3.7 allows it: the token was just
 * received over TLS directly from the provider's token endpoint in
 * response to our own code, so there is no untrusted hop to protect
 * against.
 */
function readIdTokenClaims(idToken: string): IdTokenClaims {
  const segment = idToken.split(".")[1];
  if (segment === undefined) {
    throw unreachable("Google returned a malformed id_token");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch (cause) {
    throw unreachable("Google returned an unreadable id_token", cause);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw unreachable("Google returned an unreadable id_token");
  }
  const claims = parsed as Record<string, unknown>;
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") {
    throw unreachable("Google returned an id_token without an identity");
  }
  return {
    sub: claims.sub,
    email: claims.email,
    email_verified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}

/**
 * Google OpenID Connect implementation of `SignInOAuthClient`
 * (authorization-code + PKCE S256).
 *
 * Error translation at the adapter boundary: anything the provider
 * itself rejects (4xx on the token endpoint) becomes
 * `ValidationError("OAUTH_CODE_INVALID")`; transport failures, 5xx,
 * malformed responses, and a token request that outlives its timeout
 * budget become `SystemError(EXTERNAL_API_ERROR)`. No provider-native
 * error ever escapes.
 *
 * The exchange is deliberately not retried, unlike the driver-level
 * retries other adapters do: an authorization code is single-use, so a
 * replay after a timeout would be rejected as reused — and the caller
 * (`/auth/callback/$provider`) is a live request that must not wait for
 * a second budget.
 */
export function createGoogleSignInOAuthClient(
  credentials: GoogleOAuthCredentials,
  options: GoogleOAuthClientOptions = {},
): SignInOAuthClient {
  const timeoutMs =
    options.tokenEndpointTimeoutMs ?? DEFAULT_TOKEN_ENDPOINT_TIMEOUT_MS;

  return {
    deriveCodeChallenge: deriveCodeChallengeS256,

    buildAuthorizationUrl(params): string {
      const url = new URL(AUTHORIZATION_ENDPOINT);
      url.searchParams.set("client_id", credentials.clientId);
      url.searchParams.set("redirect_uri", params.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", SCOPE);
      url.searchParams.set("state", params.state);
      url.searchParams.set("code_challenge", params.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      // Without it Google silently reuses the browser's single signed-in
      // account, which makes "link another Google account" impossible.
      url.searchParams.set("prompt", "select_account");
      return url.toString();
    },

    async exchangeCode(params): Promise<OAuthProfile> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        code_verifier: params.codeVerifier,
        redirect_uri: params.redirectUri,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      });

      let response: Response;
      try {
        response = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw unreachable("Google token endpoint is unreachable", cause);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        if (response.status >= 400 && response.status < 500) {
          throw invalidCode(detail);
        }
        throw unreachable(
          `Google token endpoint failed with ${response.status}`,
          detail,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        throw unreachable("Google returned a malformed token response", cause);
      }
      const idToken =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as Record<string, unknown>).id_token === "string"
          ? ((payload as Record<string, unknown>).id_token as string)
          : null;
      if (idToken === null) {
        throw unreachable("Google returned no id_token");
      }

      const claims = readIdTokenClaims(idToken);
      return {
        provider: OAuthProvider.create(params.provider),
        providerAccountId: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified,
        displayName: claims.name,
        avatarUrl: claims.picture,
      };
    },
  };
}
