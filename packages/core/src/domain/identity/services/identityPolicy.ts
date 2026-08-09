import { BusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "../errorCode";
import type { Identity, PasswordIdentity } from "../identity";
import type { IdentityId } from "../valueObject";

/**
 * Rules over the set of authentication methods a single user holds.
 * `maxIdentitiesPerUser = 8` is the canonical value: password and OAuth
 * identities count together, and every identity-adding usecase re-reads
 * the current set inside the final UoW before inserting.
 */
export const IdentityPolicy = {
  maxIdentitiesPerUser: 8,

  ensureRemovable: (
    identities: readonly Identity[],
    targetId: IdentityId,
  ): void => {
    const remaining = identities.filter((identity) => identity.id !== targetId);
    if (remaining.length === 0) {
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
};
