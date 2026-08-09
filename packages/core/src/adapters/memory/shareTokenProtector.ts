import { SystemError, SystemErrorCode } from "../../application/errors";
import type { ShareTokenProtector } from "../../application/ports/shareTokenProtector";
import type { ProtectedShareToken } from "../../domain/note/valueObject";

export type ShareTokenKeyRing = Readonly<{
  currentVersion: number;
  /** 32-byte AES-256-GCM keys by version. Keys never live in the database. */
  keys: ReadonlyMap<number, Uint8Array>;
}>;

const IV_LENGTH = 12;

const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

const fromBase64Url = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, "base64url"));

/**
 * WebCrypto AES-256-GCM `ShareTokenProtector` with a versioned key ring.
 * `protect` always uses the current key; `reveal` follows the stored
 * `keyVersion`, so rotation only requires adding a key and bumping
 * `currentVersion`.
 */
export function createWebCryptoShareTokenProtector(
  keyRing: ShareTokenKeyRing,
): ShareTokenProtector {
  const importKey = async (version: number): Promise<CryptoKey> => {
    const material = keyRing.keys.get(version);
    if (material === undefined || material.length !== 32) {
      throw new SystemError(
        SystemErrorCode.DataIntegrityError,
        `Unknown share-token key version: ${version}`,
      );
    }
    return crypto.subtle.importKey(
      "raw",
      material.slice().buffer,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  };

  return {
    async protect(token: string): Promise<ProtectedShareToken> {
      const key = await importKey(keyRing.currentVersion);
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
      const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(token),
      );
      const combined = new Uint8Array(iv.length + cipher.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(cipher), iv.length);
      return {
        cipherText: toBase64Url(combined),
        keyVersion: keyRing.currentVersion,
      };
    },

    async reveal(token: ProtectedShareToken): Promise<string> {
      const key = await importKey(token.keyVersion);
      const combined = fromBase64Url(token.cipherText);
      if (combined.length <= IV_LENGTH) {
        throw new SystemError(
          SystemErrorCode.DataIntegrityError,
          "Corrupt share-token ciphertext",
        );
      }
      try {
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: combined.slice(0, IV_LENGTH) },
          key,
          combined.slice(IV_LENGTH),
        );
        return new TextDecoder().decode(plain);
      } catch (error) {
        throw new SystemError(
          SystemErrorCode.DataIntegrityError,
          "Corrupt share-token ciphertext",
          error,
        );
      }
    },
  };
}
