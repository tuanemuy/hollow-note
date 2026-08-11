import type { ServiceArgs } from "../../types";
import type { AccountDeletionAcceptedView } from "../view";
import { admitAccountDeletion } from "./admission";
import type { DeleteAccountUserRequestInput } from "./input";
import { startAccountDeletionManifestBuild } from "./manifestBuild";

/**
 * Accepts an account deletion (UC-identity-020,
 * spec/usecases/identity.md#deleteaccount).
 *
 * The request path stops at "accepted": it decides the operation, moves
 * the user to `deleting`, takes the personal write barrier and asks the
 * manifest for its first page. Everything after that is a continuation
 * driven on the worker plane, and the caller follows it through the
 * status ticket rather than through this response.
 *
 * Re-requesting is safe by construction: the same `requestId` replays
 * the same operation, a different one joins the operation already
 * running, and each step of the accept path is idempotent for its owner.
 */
export async function deleteAccount({
  container,
  input,
}: ServiceArgs<DeleteAccountUserRequestInput>): Promise<AccountDeletionAcceptedView> {
  const admitted = await admitAccountDeletion(container, input);
  if (admitted.running) {
    await startAccountDeletionManifestBuild(container, admitted);
  }
  return { operationId: admitted.operationId, status: "accepted" };
}
