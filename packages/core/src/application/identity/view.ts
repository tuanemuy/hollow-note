import type { Identity } from "@repo/core/domain/identity/identity";
import type { ActiveUser } from "@repo/core/domain/identity/user";
import type { DistributedOperationState } from "../ports/distributedOperationStore";

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
 * consumed token never issues a second session.
 */
export type VerifyEmailView = Readonly<{
  userId: string;
  sessionToken: string | null;
  alreadyVerified: boolean;
}>;

/**
 * Deliberately empty. `resendVerificationEmail` answers identically for
 * every state of the address, so there is no field it could carry that
 * would not also be the account-existence oracle the uniform response
 * exists to remove — not even "a mail went out".
 */
export type ResendVerificationEmailView = Readonly<Record<string, never>>;

export type SignInView = Readonly<{
  userId: string;
  sessionToken: string;
}>;

/**
 * The session probe's projection. `email` is PII, and it is safe here for
 * one structural reason: the only input this view is reachable through is
 * a session token, so the address it carries is always the caller's own.
 * It is projected because the invitation screen has to tell "the invited
 * address" from "the signed-in account" (WS-04); consumers that only need
 * the shell should narrow the object before it crosses to a client.
 */
export type AuthenticatedUserView = Readonly<{
  userId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  email: string;
}>;

export const toAuthenticatedUserView = (
  user: ActiveUser,
): AuthenticatedUserView => ({
  userId: user.id,
  displayName: user.displayName,
  handle: user.handle,
  avatarUrl: user.avatarUrl,
  email: user.email,
});

export type StartOAuthFlowView = Readonly<{
  /**
   * One-shot secret handed only to the browser that started the flow.
   * The transport boundary carries it in a cookie and the consuming call
   * matches it against the flow row. `state` stays inside the
   * application layer: it round-trips through the provider's URLs, so a
   * binding derived from it would be reproducible by anyone who saw it.
   */
  stateBinding: string;
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
 * started for. Each intent answers with its own shape — only the
 * sign-in arm carries a session token — which is why this is a union
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

/**
 * `abandoned` says a live flow row was taken with the matching binding, so
 * the caller may drop the cookie it carried. It is the only evidence the
 * transport boundary has that the cookie is its own. A matching binding on
 * an already-expired row also releases the row but answers `false`, since
 * the store folds "expired" into "nothing to hand back".
 */
export type AbandonOAuthFlowView = Readonly<{
  abandoned: boolean;
}>;

export type PruneExpiredAuthStateView = Readonly<{
  sessions: number;
  authTokens: number;
  loginAttempts: number;
  oauthFlowStates: number;
  identityRemovalReceipts: number;
  continued: boolean;
}>;

/**
 * Deliberately empty, for the same reason as
 * `ResendVerificationEmailView`: every state of the address — unknown,
 * deleting, password-less, throttled, mailed — answers identically, so
 * there is no field it could carry that would not reintroduce the oracle.
 */
export type RequestPasswordResetView = Readonly<Record<string, never>>;

export type ResetPasswordView = Readonly<{
  userId: string;
}>;

/**
 * One authentication method as the settings screen shows it. Nothing
 * secret is projected: a password identity carries neither its hash nor
 * a label, and an OAuth one is labelled by the address the provider
 * reported.
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
 * would describe the cleanup rather than the outcome.
 */
export type SignOutOtherSessionsView = Readonly<{
  revocationAccepted: true;
}>;

/**
 * The editable profile as the profile settings page shows it and as
 * `updateProfile` answers. Distinct from `AuthenticatedUserView`, which
 * is the session probe's projection and deliberately omits `bio`.
 */
export type ProfileView = Readonly<{
  userId: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  handle: string | null;
}>;

/**
 * Advisory verdict for the handle field. `ownedBySelf` separates "free"
 * from "already yours", which the form shows differently.
 */
export type HandleAvailabilityView = Readonly<{
  handle: string;
  available: boolean;
  ownedBySelf: boolean;
}>;

export const toProfileView = (user: ActiveUser): ProfileView => ({
  userId: user.id,
  displayName: user.displayName,
  bio: user.bio,
  avatarUrl: user.avatarUrl,
  handle: user.handle,
});

/**
 * All the deletion request answers: the operation to follow and the fact
 * that it was taken. Progress is read afterwards through the status
 * ticket, since the session is gone by then.
 */
export type AccountDeletionAcceptedView = Readonly<{
  operationId: string;
  status: "accepted";
}>;

/**
 * Everything a progress poll may learn: the operation it asked about and
 * the state of that one operation. The projection deliberately drops
 * `partitionKey` / `requestKey` / `payload` — the ticket's holder is an
 * already signed-out browser, and those fields carry the user id and the
 * uniqueness keys the deletion is in the middle of erasing.
 */
export type AccountDeletionStatusView = Readonly<{
  operationId: string;
  status: DistributedOperationState;
}>;
