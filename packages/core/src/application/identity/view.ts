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
 * cannot represent that path — noted as a spec-sync candidate).
 */
export type VerifyEmailView = Readonly<{
  userId: string;
  sessionToken: string | null;
  alreadyVerified: boolean;
}>;

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

export type PruneExpiredAuthStateView = Readonly<{
  sessions: number;
  authTokens: number;
  loginAttempts: number;
  oauthFlowStates: number;
  continued: boolean;
}>;
