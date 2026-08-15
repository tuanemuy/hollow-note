import type { UserId } from "../valueObject";

export type IdentityUniqueKind = "email" | "handle" | "providerAccount";

/**
 * Global uniqueness directory for email / handle / provider-account keys.
 *
 * Two-phase reservation protocol: `reserve` claims the normalized key for
 * an operation with an expiry; after the owning UoW commits, `activate`
 * (conditional on the expected user version) flips the reservation to a
 * durable claim; `release` frees it on failure. A caller that loses the
 * `activate` / `release` response reconciles by re-reading and re-issuing
 * the same operation's call — both must be idempotent for the same
 * `operationId`.
 *
 * Tearing a durable claim down is the mirrored two-phase move:
 * `beginRelease` marks the `active` row `releasing`, then `release` drops
 * it. It is keyed by `normalizedKey` rather than by the reservation's
 * `operationId` because the operation that created the claim is long
 * past and its id cannot be re-derived by the operation freeing it.
 *
 * Error contract: `ConflictError("EMAIL_ALREADY_USED")` /
 * `ConflictError("HANDLE_ALREADY_USED")` /
 * `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` when the key is held
 * by another user, `SystemError(DatabaseError)` otherwise.
 */
export interface IdentityUniqueDirectory {
  /** Resolves the owner of a durable (`active`) claim; a key that is
   * merely reserved or already `releasing` resolves to `null`. */
  resolve(
    kind: IdentityUniqueKind,
    normalizedKey: string,
  ): Promise<UserId | null>;
  reserve(
    input: Readonly<{
      kind: IdentityUniqueKind;
      normalizedKey: string;
      userId: UserId;
      operationId: string;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  activate(operationId: string, expectedUserVersion: number): Promise<void>;
  /**
   * Moves the owner's durable claim to `releasing` and re-keys the row to
   * the releasing operation, so the following `release(operationId)` can
   * find it. A missing row or a row held by another user is a no-op — a
   * release request can never take a key away from its owner.
   *
   * A row that is still merely `reserved` is a no-op too: this call only
   * tears **durable** claims down. Re-keying a reservation would hand it
   * to the releasing operation, whose `release` drops `reserved` rows as
   * well, and the in-flight operation that took the reservation would
   * lose it mid-saga.
   */
  beginRelease(
    input: Readonly<{
      kind: IdentityUniqueKind;
      normalizedKey: string;
      expectedUserId: UserId;
      operationId: string;
    }>,
  ): Promise<void>;
  /** Drops the operation's `reserved` and `releasing` rows. Activated
   * claims are untouched — freeing one goes through `beginRelease`. */
  release(operationId: string): Promise<void>;
}
