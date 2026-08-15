import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
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
 * `removable` is answered by `IdentityPolicy` rather than counted here,
 * so the screen and `removeIdentity` never disagree about which sets
 * still allow a removal.
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
    removable: IdentityPolicy.isRemovable(identities),
  };
}
