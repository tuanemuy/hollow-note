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
 * Sign-in OAuth provider exchange. Port definition only in the
 * walking-skeleton slice — the adapter ships with the OAuth slice.
 *
 * Error contract: `SystemError(ExternalServiceError)` (transport /
 * malformed response), `ValidationError("OAUTH_CODE_INVALID")` (expired
 * or invalid authorization code).
 */
export interface SignInOAuthClient {
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
