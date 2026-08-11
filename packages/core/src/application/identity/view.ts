import type { Identity } from "@repo/core/domain/identity/identity";
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
 * started for (ADR-007). Each intent answers with its own shape — only
 * the sign-in arm carries a session token — which is why this is a union
 * rather than the sign-in view alone. `integration` joins it in the
 * external-connection slice.
 *
 * `redirectTo` is on the link arm because the usecase's DTO is
 * `identityId` alone: the return path belongs to the flow the dispatcher
 * consumed, not to the linking itself.
 */
export type OAuthCallbackView =
  | (Readonly<{ intent: "signIn" }> & CompleteOAuthSignInView)
  | (Readonly<{ intent: "linkIdentity"; redirectTo: string | null }> &
      LinkOAuthIdentityView);

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

/**
 * One authentication method as the settings screen shows it. Nothing
 * secret is projected: a password identity carries neither its hash nor
 * a label, and an OAuth one is labelled by the address the provider
 * reported (spec/usecases/identity.md#listidentities).
 */
export type IdentityListItemView = Readonly<{
  id: string;
  kind: "password" | "oauth";
  provider: string | null;
  accountLabel: string | null;
  createdAt: Date;
}>;

export type ListIdentitiesView = Readonly<{
  /** At most 8 by the `IdentityPolicy` invariant. */
  identities: readonly IdentityListItemView[];
  removable: boolean;
}>;

export const toIdentityListItemView = (
  identity: Identity,
): IdentityListItemView =>
  identity.kind === "password"
    ? {
        id: identity.id,
        kind: "password",
        provider: null,
        accountLabel: null,
        createdAt: identity.createdAt,
      }
    : {
        id: identity.id,
        kind: "oauth",
        provider: identity.provider,
        accountLabel: identity.providerEmail,
        createdAt: identity.createdAt,
      };

export type AddPasswordIdentityView = Readonly<{
  identityId: string;
}>;

/** Deliberately empty — the spec gives `changePassword` no output. */
export type ChangePasswordView = Readonly<Record<string, never>>;

/** Deliberately empty — the spec gives `removeIdentity` no output. */
export type RemoveIdentityView = Readonly<Record<string, never>>;

export type LinkOAuthIdentityView = Readonly<{
  identityId: string;
}>;

/** Deliberately empty — `signOut` always succeeds and reports nothing. */
export type SignOutView = Readonly<Record<string, never>>;

/**
 * `revocationAccepted` rather than a deleted count: revocation is the
 * epoch bump, and the physical rows are reclaimed out of band, so a count
 * would describe the cleanup rather than the outcome
 * (spec/usecases/identity.md#signoutothersessions 手順 3).
 */
export type SignOutOtherSessionsView = Readonly<{
  revocationAccepted: true;
}>;
