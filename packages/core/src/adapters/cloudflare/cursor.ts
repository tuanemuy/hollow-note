import { ValidationError } from "../../application/errors";

/**
 * Opaque keyset cursor for the Cloudflare backend.
 *
 * Same contract as every other backend's: the cursor carries the
 * fingerprint of the query that produced it, so a value replayed against
 * different conditions — or one that does not decode at all — is rejected
 * with `ValidationError("INVALID_PAGINATION")` instead of quietly
 * returning the wrong page. A cursor is opaque and backend-local: it
 * never has to decode against another backend's encoder, which is why
 * this one is free to differ from the memory backend's `Buffer`-based
 * encoding.
 *
 * It is **not authenticated**. The encoding hides the position from a
 * casual reader, but a caller who reconstructs the fingerprint can move
 * `after` wherever it likes, and that is by design: a cursor selects
 * where a page starts and never what it may contain, so every read
 * applies its own visibility predicate regardless of the cursor it was
 * handed. Nothing may treat a cursor as a capability.
 *
 * `after` holds the keyset position — the tuple the next page starts
 * after, joined the same way the `ORDER BY` orders it.
 */
export type OpaqueCursor = Readonly<{ fp: string; after: string }>;

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const encodeOpaqueCursor = (payload: OpaqueCursor): string =>
  toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));

export const decodeOpaqueCursor = (
  cursor: string,
  fingerprint: string,
): OpaqueCursor => {
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(fromBase64Url(cursor)),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "fp" in parsed &&
      "after" in parsed &&
      (parsed as OpaqueCursor).fp === fingerprint &&
      typeof (parsed as OpaqueCursor).after === "string"
    ) {
      return parsed as OpaqueCursor;
    }
  } catch {
    // fall through to the rejection below
  }
  throw new ValidationError(
    "INVALID_PAGINATION",
    "Unreadable or retired pagination cursor",
  );
};
