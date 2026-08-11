import { NotFoundError } from "../errors";
import type { ServiceArgs } from "../types";
import type { AccountDeletionStatusView } from "./view";

export type GetAccountDeletionStatusInput = Readonly<{ operationId: string }>;

/**
 * Reads the progress of one account deletion.
 *
 * The caller has no session: `deleteAccount` expires it in the same
 * response that hands out the status ticket, so this is the only thing a
 * P-25 that stayed on screen can still ask for. Two properties make that
 * safe. It travels through `deletionOperationReader` — the
 * `Pick<…, "findByOperationId">` read view — so no write unit of work is
 * opened on behalf of an unauthenticated caller, and it answers about
 * exactly the operation it was given: there is no listing, no partition
 * scan, and no way to widen one id into another (TC-identity-048).
 *
 * Authorization is the ticket's, not this usecase's: the presentation
 * layer signs the `operationId` at accept time and hands the verified one
 * back here, so possession of a ticket is what grants the read.
 */
export async function getAccountDeletionStatus({
  container,
  input,
}: ServiceArgs<GetAccountDeletionStatusInput>): Promise<AccountDeletionStatusView> {
  const operation = await container.deletionOperationReader.findByOperationId(
    input.operationId,
  );
  if (operation === null || operation.kind !== "accountDeletion") {
    throw new NotFoundError(
      "DELETION_OPERATION_NOT_FOUND",
      "Deletion operation not found",
    );
  }
  return { operationId: operation.id, status: operation.state };
}
