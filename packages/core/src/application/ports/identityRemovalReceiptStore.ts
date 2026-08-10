import type {
  IdentityId,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import type { PrunePage } from "../../domain/common/pagination";

export type IdentityRemovalReceipt = Readonly<{
  operationId: string;
  identityId: IdentityId;
  userId: UserId;
  kind: "password" | "oauth";
  /** Normalized directory key of the removed OAuth identity — `null` for
   * password identities. Fixed before the row is deleted, since it cannot
   * be reconstructed from an identity that no longer exists. */
  providerAccountKey: string | null;
  expiresAt: Date;
}>;

/**
 * Retention record of an identity removal, kept on the UserId shard for
 * 30 days after the identity row is gone.
 *
 * Two readers depend on it: a re-sent removal of the same identity
 * answers "already removed" from the receipt instead of
 * `IDENTITY_NOT_FOUND`, and the global reservation-release consumer
 * needs the `providerAccountKey` of a row that no longer exists.
 * `record` therefore shares the unit of work that deletes the identity
 * and enqueues `identity.identity.removed`.
 *
 * `record` is idempotent per `operationId`: the first write wins, so a
 * lost-response retry of the same removal cannot rewrite the receipt.
 *
 * Error contract: `SystemError(DatabaseError)`.
 */
export interface IdentityRemovalReceiptStore {
  record(receipt: IdentityRemovalReceipt): Promise<void>;
  findByOperationId(
    operationId: string,
  ): Promise<IdentityRemovalReceipt | null>;
  findByIdentityId(
    identityId: IdentityId,
  ): Promise<IdentityRemovalReceipt | null>;
  /** Bounded keyset sweep of rows with `expiresAt <= now`. */
  deleteExpired(
    now: Date,
    cursor: string | null,
    limit: number,
  ): Promise<PrunePage>;
}
