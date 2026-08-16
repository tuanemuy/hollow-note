import type { ProtectedShareToken } from "@repo/core/domain/note/valueObject";

/**
 * Versioned-key encryption of share tokens. `protect` uses the current
 * key version; `reveal` decrypts with the key ring entry the stored
 * `keyVersion` points at. Keys never live in the database — supply and
 * rotation are adapter concerns (`AppConfig`). Decryption is only used
 * to re-display the share URL to the owner, never on the shared-link
 * read path (which compares hashes).
 *
 * Error contract: `SystemError(DataIntegrityError)` (unknown key
 * version, corrupt ciphertext).
 */
export interface ShareTokenProtector {
  protect(token: string): Promise<ProtectedShareToken>;
  reveal(token: ProtectedShareToken): Promise<string>;
}
