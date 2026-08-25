import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ObjectStorage } from "../../../application/ports/objectStorage";
import {
  ByteSize,
  MimeType,
  ObjectKey,
} from "../../../domain/storage/valueObject";
import { createR2ObjectStorage } from "../r2/objectStorage";

/**
 * AC-4, the object-store half.
 *
 * R2 sits outside every unit of work, so its two failure modes are the
 * ones the ordering around it is designed to survive: two writers landing
 * on one key, and a delete for bytes that are already gone. Neither is a
 * port contract — the shared suite covers what `ObjectStorage` promises —
 * so both are observed here against the real bucket.
 */

const encoder = new TextEncoder();

let seq = 0;
const freshStorage = (): ObjectStorage => {
  seq += 1;
  return createR2ObjectStorage({
    bucket: env.OBJECT_STORAGE,
    publicBaseUrl: "https://files.example.com",
    keyPrefix: `r2-${seq}/`,
  });
};

const metaFor = (bytes: Uint8Array) => ({
  mimeType: MimeType.create("text/plain"),
  size: ByteSize.create(bytes.byteLength),
  checksum: null,
});

describe("cloudflare R2 object storage", () => {
  const key = ObjectKey.create("users/user-1/media/file-1.txt");

  it("leaves one whole object behind when two writes race for a key", async () => {
    const storage = freshStorage();
    const first = encoder.encode("first-writer");
    const second = encoder.encode("second-writer-and-longer");

    const [left, right] = await Promise.all([
      storage.put(key, first, metaFor(first)),
      storage.put(key, second, metaFor(second)),
    ]);
    // Each caller is told about the bytes it wrote, whoever won.
    expect(left.size).toBe(first.byteLength);
    expect(right.size).toBe(second.byteLength);

    const stored = await storage.get(key);
    if (stored === null) {
      throw new Error("object missing after concurrent writes");
    }
    // Last writer wins, and the object is one of the two bodies — never a
    // splice of both, and never a body whose recorded checksum belongs to
    // the other writer.
    const text = new TextDecoder().decode(stored.bytes);
    expect(["first-writer", "second-writer-and-longer"]).toContain(text);
    expect(stored.meta.size).toBe(stored.bytes.byteLength);
    const winner = text === "first-writer" ? left : right;
    expect(stored.meta.checksum?.value).toBe(winner.checksum.value);
  });

  it("treats a delete of absent keys as done", async () => {
    const storage = freshStorage();
    const present = ObjectKey.create("users/user-1/media/present.txt");
    const absent = ObjectKey.create("users/user-1/media/absent.txt");
    const bytes = encoder.encode("kept-until-deleted");
    await storage.put(present, bytes, metaFor(bytes));

    await expect(storage.deleteMany([])).resolves.toBeUndefined();
    await expect(storage.deleteMany([absent])).resolves.toBeUndefined();
    // The subscriber that deletes runs after the row is already gone, so
    // a batch mixing a live object with one a previous delivery already
    // removed is the normal case, not an error.
    await expect(
      storage.deleteMany([present, absent]),
    ).resolves.toBeUndefined();
    expect(await storage.get(present)).toBeNull();

    await expect(storage.deleteMany([present])).resolves.toBeUndefined();
  });

  it("keeps two prefixed storages from reaching each other's keys", async () => {
    const mine = freshStorage();
    const theirs = freshStorage();
    const bytes = encoder.encode("mine");
    await mine.put(key, bytes, metaFor(bytes));

    expect(await theirs.get(key)).toBeNull();
    await theirs.deleteMany([key]);
    expect(await mine.get(key)).not.toBeNull();
  });
});
