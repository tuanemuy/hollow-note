import { UserId } from "@repo/core/domain/identity/valueObject";
import type { ServiceArgs } from "../types";
import { type ListIdentitiesView, toIdentityListItemView } from "./view";

export type ListIdentitiesInput = Readonly<{
  userId: string;
}>;

/**
 * Lists the authentication methods a user holds (UC-identity-016,
 * spec/usecases/identity.md#listidentities).
 *
 * `removable` is a property of the *set*, not of a row: the last method
 * can never be removed, so with a single identity every row is locked.
 * Answering it here keeps the screen from re-deriving the rule.
 */
export async function listIdentities({
  container,
  input,
}: ServiceArgs<ListIdentitiesInput>): Promise<ListIdentitiesView> {
  const identities = await container.identityReader.listByUserId(
    UserId.create(input.userId),
  );
  return {
    identities: identities.map(toIdentityListItemView),
    removable: identities.length >= 2,
  };
}
