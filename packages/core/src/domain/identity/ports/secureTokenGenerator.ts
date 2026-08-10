import type { TokenHash, UserId } from "../valueObject";

/**
 * Generation of unguessable secrets and their storage hashes. `token` is
 * the value handed to the user; `hash` is what gets persisted.
 *
 * `issue` mints a URL-safe token of at least 256 bits of entropy.
 * Identity's sessions / auth tokens use `issueForUser`, whose token takes
 * the `base64url(UserId).secret` locator form. `locateUser` only checks
 * the locator *format* and extracts the UserId — authenticity is always
 * decided by hashing the whole token and comparing against the stored
 * hash; a bare locator is never an authenticated principal.
 *
 * Error contract: `SystemError(ExternalServiceError)`.
 */
export interface SecureTokenGenerator {
  issue(): Readonly<{ token: string; hash: TokenHash }>;
  issueForUser(userId: UserId): Readonly<{ token: string; hash: TokenHash }>;
  locateUser(token: string): UserId | null;
  hashOf(token: string): TokenHash;
}
