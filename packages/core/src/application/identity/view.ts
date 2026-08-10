import type { ActiveUser } from "@repo/core/domain/identity/user";

/**
 * DTO projections for the identity usecases. Fields are primitives only;
 * branded value objects widen naturally, so projection needs no casts.
 */

export type SignUpView = Readonly<{
  userId: string;
  emailVerificationRequired: boolean;
  sessionToken: string | null;
}>;

/**
 * `sessionToken` is `null` on the `alreadyVerified` replay path — a
 * consumed token never issues a second session (spec/usecases/identity.md
 * verifyEmail 手順3; the spec's output table types it as non-null, which
 * cannot represent that path).
 */
export type VerifyEmailView = Readonly<{
  userId: string;
  sessionToken: string | null;
  alreadyVerified: boolean;
}>;

/**
 * Deliberately empty. `resendVerificationEmail` answers identically for
 * every state of the address (spec/adr/028-account-enumeration-resistance.md),
 * so there is no field it could carry that would not also be the oracle
 * the uniform response exists to remove — not even "a mail went out".
 */
export type ResendVerificationEmailView = Readonly<Record<string, never>>;

export type SignInView = Readonly<{
  userId: string;
  sessionToken: string;
}>;

export type AuthenticatedUserView = Readonly<{
  userId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
}>;

export const toAuthenticatedUserView = (
  user: ActiveUser,
): AuthenticatedUserView => ({
  userId: user.id,
  displayName: user.displayName,
  handle: user.handle,
  avatarUrl: user.avatarUrl,
});

export type StartOAuthFlowView = Readonly<{
  authorizationUrl: string;
}>;

/**
 * `created` distinguishes "this sign-in registered the account" from
 * "it attached to (or reused) an existing one" — the callback screen
 * has nothing else to tell the two apart.
 */
export type CompleteOAuthSignInView = Readonly<{
  userId: string;
  sessionToken: string;
  redirectTo: string | null;
  created: boolean;
}>;

/**
 * Result of the one callback route, tagged with the intent the flow was
 * started for (ADR-007). The later intents (`linkIdentity`,
 * `integration`) answer with their own shapes, which is why this is a
 * union rather than the sign-in view alone.
 */
export type OAuthCallbackView = Readonly<{ intent: "signIn" }> &
  CompleteOAuthSignInView;

export type PruneExpiredAuthStateView = Readonly<{
  sessions: number;
  authTokens: number;
  loginAttempts: number;
  oauthFlowStates: number;
  continued: boolean;
}>;

/**
 * Deliberately empty, for the same reason as
 * `ResendVerificationEmailView`: every state of the address — unknown,
 * deleting, password-less, throttled, mailed — answers identically
 * (spec/adr/028-account-enumeration-resistance.md), so there is no field
 * it could carry that would not reintroduce the oracle.
 */
export type RequestPasswordResetView = Readonly<Record<string, never>>;

export type ResetPasswordView = Readonly<{
  userId: string;
}>;
