import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import type { PasswordHasher } from "../../domain/identity/ports/passwordHasher";
import {
  PasswordHash,
  type PlainPassword,
} from "../../domain/identity/valueObject";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const derive = (
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: 128 * n * r * 2 },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      },
    );
  });

/**
 * scrypt-based `PasswordHasher` (Node runtime). The hash string is
 * self-describing (`scrypt$N$r$p$salt$key`, base64url parts) so cost
 * parameters can be raised without invalidating stored hashes.
 */
export function createScryptPasswordHasher(): PasswordHasher {
  return {
    async hash(password: PlainPassword): Promise<PasswordHash> {
      const salt = randomBytes(SALT_LENGTH);
      const key = await derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
      return PasswordHash.create(
        [
          "scrypt",
          String(SCRYPT_N),
          String(SCRYPT_R),
          String(SCRYPT_P),
          salt.toString("base64url"),
          key.toString("base64url"),
        ].join("$"),
      );
    },

    async verify(
      password: PlainPassword,
      hash: PasswordHash,
    ): Promise<boolean> {
      const parts = hash.split("$");
      if (parts.length !== 6 || parts[0] !== "scrypt") {
        return false;
      }
      const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
      const n = Number(nRaw);
      const r = Number(rRaw);
      const p = Number(pRaw);
      if (
        !Number.isInteger(n) ||
        !Number.isInteger(r) ||
        !Number.isInteger(p)
      ) {
        return false;
      }
      const salt = Buffer.from(saltRaw ?? "", "base64url");
      const expected = Buffer.from(keyRaw ?? "", "base64url");
      if (expected.length !== KEY_LENGTH) {
        return false;
      }
      const actual = await derive(password, salt, n, r, p);
      return timingSafeEqual(actual, expected);
    },
  };
}
