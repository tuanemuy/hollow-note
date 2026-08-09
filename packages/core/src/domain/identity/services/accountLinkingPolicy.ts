import type { User } from "../user";
import type { UserId } from "../valueObject";

export type LinkDecision =
  | Readonly<{ kind: "createNew" }>
  | Readonly<{ kind: "linkToExisting"; userId: UserId }>
  | Readonly<{
      kind: "refuse";
      reason:
        | "providerEmailUnverified"
        | "existingUserUnverified"
        | "existingUserUnavailable";
    }>;

/**
 * Decides whether an OAuth sign-in may attach to an existing user.
 * An unverified provider email always refuses, regardless of the
 * existing user's state.
 */
export const AccountLinkingPolicy = {
  decide: (
    existingUser: User | null,
    providerEmailVerified: boolean,
  ): LinkDecision => {
    if (!providerEmailVerified) {
      return { kind: "refuse", reason: "providerEmailUnverified" };
    }
    if (existingUser === null) {
      return { kind: "createNew" };
    }
    switch (existingUser.status) {
      case "active":
        return { kind: "linkToExisting", userId: existingUser.id };
      case "pending":
        return { kind: "refuse", reason: "existingUserUnverified" };
      case "deleting":
      case "deleted":
        return { kind: "refuse", reason: "existingUserUnavailable" };
    }
  },
};
