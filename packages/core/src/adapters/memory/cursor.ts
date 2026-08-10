import { ValidationError } from "../../application/errors";

/**
 * Opaque keyset cursor carrying the query fingerprint, so a cursor
 * replayed against different conditions (or a tampered value) is
 * rejected with `ValidationError("INVALID_PAGINATION")` instead of
 * silently returning the wrong page.
 */
export type OpaqueCursor = Readonly<{ fp: string; after: string }>;

export const encodeOpaqueCursor = (payload: OpaqueCursor): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

export const decodeOpaqueCursor = (
  cursor: string,
  fingerprint: string,
): OpaqueCursor => {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
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
    "Tampered or retired pagination cursor",
  );
};
