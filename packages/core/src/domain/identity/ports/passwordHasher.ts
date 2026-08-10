import type { PasswordHash, PlainPassword } from "../valueObject";

/**
 * Hashing and constant-time verification of passwords. The only
 * legitimate producer of `PasswordHash` values.
 *
 * Error contract: `SystemError(ExternalServiceError)`.
 */
export interface PasswordHasher {
  hash(password: PlainPassword): Promise<PasswordHash>;
  verify(password: PlainPassword, hash: PasswordHash): Promise<boolean>;
}
