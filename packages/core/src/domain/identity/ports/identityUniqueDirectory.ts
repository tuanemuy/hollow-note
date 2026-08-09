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
 * Error contract: `ConflictError("EMAIL_ALREADY_USED")` /
 * `ConflictError("HANDLE_ALREADY_USED")` /
 * `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` when the key is held
 * by another user, `SystemError(DatabaseError)` otherwise.
 */
export interface IdentityUniqueDirectory {
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
  release(operationId: string): Promise<void>;
}
