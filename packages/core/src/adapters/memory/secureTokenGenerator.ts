import { createHash, randomBytes } from "node:crypto";
import type { SecureTokenGenerator } from "../../domain/identity/ports/secureTokenGenerator";
import { TokenHash, UserId } from "../../domain/identity/valueObject";

const SECRET_BYTES = 32;
const LOCATOR_PATTERN = /^[A-Za-z0-9_-]+$/;

const mintSecret = (): string =>
  randomBytes(SECRET_BYTES).toString("base64url");

const sha256 = (token: string): TokenHash =>
  TokenHash.create(createHash("sha256").update(token, "utf8").digest("hex"));

/**
 * `SecureTokenGenerator` over Node's CSPRNG. Secrets carry 256 bits of
 * entropy; hashes are SHA-256 of the whole token, so a bare locator can
 * never authenticate.
 */
export function createNodeSecureTokenGenerator(): SecureTokenGenerator {
  return {
    issue(): Readonly<{ token: string; hash: TokenHash }> {
      const token = mintSecret();
      return { token, hash: sha256(token) };
    },

    issueForUser(userId: UserId): Readonly<{ token: string; hash: TokenHash }> {
      const locator = Buffer.from(userId, "utf8").toString("base64url");
      const token = `${locator}.${mintSecret()}`;
      return { token, hash: sha256(token) };
    },

    locateUser(token: string): UserId | null {
      const separator = token.indexOf(".");
      if (separator <= 0 || separator === token.length - 1) {
        return null;
      }
      const locator = token.slice(0, separator);
      const secret = token.slice(separator + 1);
      if (!LOCATOR_PATTERN.test(locator) || !LOCATOR_PATTERN.test(secret)) {
        return null;
      }
      try {
        const decoded = Buffer.from(locator, "base64url").toString("utf8");
        return decoded.trim().length === 0 ? null : UserId.create(decoded);
      } catch {
        return null;
      }
    },

    hashOf(token: string): TokenHash {
      return sha256(token);
    },
  };
}
