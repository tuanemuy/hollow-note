import type { OAuthProvider } from "../valueObject";

export type OAuthProfile = Readonly<{
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}>;

/**
 * Sign-in OAuth provider exchange.
 *
 * `deriveCodeChallenge` lives here rather than on `SecureTokenGenerator`
 * because the PKCE challenge is a **protocol-defined representation**
 * (`base64url(sha256(verifier))` for S256), not a storage hash whose
 * encoding an adapter may choose freely. Keeping it on the port that
 * already knows the protocol keeps the application layer free of any
 * hash representation.
 *
 * Error contract: `SystemError(EXTERNAL_API_ERROR)` (transport /
 * malformed response), `ValidationError("OAUTH_CODE_INVALID")` (expired
 * or invalid authorization code).
 */
export interface SignInOAuthClient {
  /** PKCE S256 challenge for a verifier. Pure and deterministic. */
  deriveCodeChallenge(codeVerifier: string): string;
  buildAuthorizationUrl(
    params: Readonly<{
      provider: OAuthProvider;
      state: string;
      codeChallenge: string;
      redirectUri: string;
    }>,
  ): string;
  exchangeCode(
    params: Readonly<{
      provider: OAuthProvider;
      code: string;
      codeVerifier: string;
      redirectUri: string;
    }>,
  ): Promise<OAuthProfile>;
}
