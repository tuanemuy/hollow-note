import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isSystemError } from "../../../application/errors";
import { PlainPassword, UserId } from "../../../domain/identity/valueObject";
import { createScryptPasswordHasher } from "../passwordHasher";
import { createNodeSecureTokenGenerator } from "../secureTokenGenerator";
import { createWebCryptoShareTokenProtector } from "../shareTokenProtector";

describe("createScryptPasswordHasher (ADP-identity-027/028)", () => {
  const hasher = createScryptPasswordHasher();

  it("hashes and verifies a password round-trip", async () => {
    const password = PlainPassword.create("correct-horse-1");
    const hash = await hasher.hash(password);
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await hasher.verify(password, hash)).toBe(true);
    expect(
      await hasher.verify(PlainPassword.create("wrong-horse-1"), hash),
    ).toBe(false);
  });

  it("salts hashes so equal passwords produce distinct hashes", async () => {
    const password = PlainPassword.create("correct-horse-1");
    expect(await hasher.hash(password)).not.toBe(await hasher.hash(password));
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(
      await hasher.verify(
        PlainPassword.create("correct-horse-1"),
        "plain-not-scrypt" as Parameters<typeof hasher.verify>[1],
      ),
    ).toBe(false);
  });

  it("rejects stored hashes with out-of-range cost parameters or salt length", async () => {
    const password = PlainPassword.create("correct-horse-1");
    const hash = await hasher.hash(password);
    const [, n, r, p, salt, key] = hash.split("$");
    const forged = (parts: {
      n?: string;
      r?: string;
      p?: string;
      salt?: string;
    }) =>
      [
        "scrypt",
        parts.n ?? n,
        parts.r ?? r,
        parts.p ?? p,
        parts.salt ?? salt,
        key,
      ].join("$") as Parameters<typeof hasher.verify>[1];

    // N over the cap / not a power of two.
    expect(await hasher.verify(password, forged({ n: String(2 ** 20) }))).toBe(
      false,
    );
    expect(await hasher.verify(password, forged({ n: "12345" }))).toBe(false);
    // r / p over their caps.
    expect(await hasher.verify(password, forged({ r: "64" }))).toBe(false);
    expect(await hasher.verify(password, forged({ p: "16" }))).toBe(false);
    // Salt length mismatch.
    expect(
      await hasher.verify(
        password,
        forged({ salt: randomBytes(8).toString("base64url") }),
      ),
    ).toBe(false);
    expect(await hasher.verify(password, hash)).toBe(true);
  });
});

describe("createNodeSecureTokenGenerator (ADP-identity-029..032)", () => {
  const generator = createNodeSecureTokenGenerator();

  it("issue mints a URL-safe token of at least 256 bits with its hash", () => {
    const { token, hash } = generator.issue();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(generator.hashOf(token)).toBe(hash);
    expect(generator.issue().token).not.toBe(token);
  });

  it("issueForUser takes the base64url(UserId).secret locator form", () => {
    const { token, hash } = generator.issueForUser(UserId.create("user-1"));
    expect(generator.locateUser(token)).toBe("user-1");
    expect(generator.hashOf(token)).toBe(hash);
  });

  it("locateUser checks only the locator format and never authenticates", () => {
    const { token } = generator.issueForUser(UserId.create("user-1"));
    const [locator] = token.split(".");
    expect(generator.locateUser(`${locator}.forged-secret`)).toBe("user-1");
    expect(generator.locateUser("no-separator")).toBeNull();
    expect(generator.locateUser(".secret-only")).toBeNull();
    expect(generator.locateUser("locator.")).toBeNull();
    expect(generator.locateUser("bad!chars.secret")).toBeNull();
  });
});

describe("createWebCryptoShareTokenProtector (ADP-note-048/049)", () => {
  const keyRing = {
    currentVersion: 2,
    keys: new Map<number, Uint8Array>([
      [1, new Uint8Array(randomBytes(32))],
      [2, new Uint8Array(randomBytes(32))],
    ]),
  };

  it("protect/reveal round-trips with the current key version", async () => {
    const protector = createWebCryptoShareTokenProtector(keyRing);
    const protectedToken = await protector.protect("share-token-secret");
    expect(protectedToken.keyVersion).toBe(2);
    expect(await protector.reveal(protectedToken)).toBe("share-token-secret");
  });

  it("reveal follows the stored key version after rotation", async () => {
    const oldRing = { currentVersion: 1, keys: keyRing.keys };
    const oldProtector = createWebCryptoShareTokenProtector(oldRing);
    const protectedToken = await oldProtector.protect("legacy-token");

    const rotated = createWebCryptoShareTokenProtector(keyRing);
    expect(await rotated.reveal(protectedToken)).toBe("legacy-token");
  });

  it("an unknown key version or corrupt ciphertext raises SystemError", async () => {
    const protector = createWebCryptoShareTokenProtector(keyRing);
    const protectedToken = await protector.protect("share-token-secret");

    const unknownVersion = await protector
      .reveal({ ...protectedToken, keyVersion: 9 })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isSystemError(unknownVersion)).toBe(true);

    const corrupt = await protector
      .reveal({
        keyVersion: 2,
        cipherText: Buffer.from(randomBytes(48)).toString("base64url"),
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isSystemError(corrupt)).toBe(true);
  });
});
