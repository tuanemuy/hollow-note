import { BusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "../errorCode";
import type { Identity, OAuthIdentity, PasswordIdentity } from "../identity";
import type { IdentityId, OAuthProvider } from "../valueObject";

/**
 * Rules over the set of authentication methods a single user holds.
 * Password and OAuth identities count together toward
 * `maxIdentitiesPerUser`, and every identity-adding usecase re-reads the
 * current set inside the final UoW before inserting.
 */
export const IdentityPolicy = {
  maxIdentitiesPerUser: 8,
  minIdentitiesPerUser: 1,

  /**
   * Whether removal is open at all — a property of the *set*, not of a
   * row: with a single method every row is locked. The screen asks this
   * instead of counting, so what it offers and what `ensureRemovable`
   * admits cannot drift apart.
   */
  isRemovable: (identities: readonly Identity[]): boolean =>
    identities.length > IdentityPolicy.minIdentitiesPerUser,

  ensureRemovable: (
    identities: readonly Identity[],
    targetId: IdentityId,
  ): void => {
    const remaining = identities.filter((identity) => identity.id !== targetId);
    if (remaining.length < IdentityPolicy.minIdentitiesPerUser) {
      throw new BusinessRuleError(
        IdentityErrorCode.LastIdentityCannotBeRemoved,
        "The last identity cannot be removed",
      );
    }
  },

  ensureAddable: (identities: readonly Identity[]): void => {
    if (identities.length >= IdentityPolicy.maxIdentitiesPerUser) {
      throw new BusinessRuleError(
        IdentityErrorCode.IdentityLimitExceeded,
        `A user can hold at most ${IdentityPolicy.maxIdentitiesPerUser} identities`,
      );
    }
  },

  ensurePasswordAddable: (identities: readonly Identity[]): void => {
    if (identities.some((identity) => identity.kind === "password")) {
      throw new BusinessRuleError(
        IdentityErrorCode.PasswordIdentityAlreadyExists,
        "A password identity already exists",
      );
    }
  },

  findPassword: (identities: readonly Identity[]): PasswordIdentity | null =>
    identities.find(
      (identity): identity is PasswordIdentity => identity.kind === "password",
    ) ?? null,

  /**
   * The set's own row for one provider account, if it holds one. A user
   * names an external account at most once, so an adding usecase asks
   * this before `ensureAddable` and reuses what it finds instead of
   * growing a second row for the same account.
   */
  findOAuth: (
    identities: readonly Identity[],
    provider: OAuthProvider,
    providerAccountId: string,
  ): OAuthIdentity | null =>
    identities.find(
      (identity): identity is OAuthIdentity =>
        identity.kind === "oauth" &&
        identity.provider === provider &&
        identity.providerAccountId === providerAccountId,
    ) ?? null,
};
