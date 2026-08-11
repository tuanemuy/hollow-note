import { beforeEach, describe, expect, it } from "vitest";
import {
  ByteSize,
  Checksum,
  MimeType,
  ObjectKey,
} from "../../domain/storage/valueObject";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";

const encoder = new TextEncoder();

const sha256Hex = async (body: Uint8Array): Promise<string> => {
  const source = new ArrayBuffer(body.byteLength);
  new Uint8Array(source).set(body);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Shared conformance suite for `ObjectStorage`
 * (ADP-storage-018..020 + `publicUrl`, ADR-011).
 */
export function describeObjectStorageContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`ObjectStorage conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    const key = ObjectKey.create("users/user-1/avatar/file-1.png");
    const body = encoder.encode("avatar-bytes");
    const meta = {
      mimeType: MimeType.create("image/png"),
      size: ByteSize.create(body.byteLength),
      checksum: null,
    };

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-storage-018/019: stores bytes and reports the measured size and checksum", async () => {
      // The declared size and checksum are deliberately wrong: what a
      // caller believes about the bytes must not reach the result.
      const result = await backend.objectStorage.put(key, body, {
        ...meta,
        size: ByteSize.create(0),
        checksum: Checksum.sha256("b".repeat(64)),
      });
      expect(result.size).toBe(body.byteLength);
      expect(result.checksum).toEqual(Checksum.sha256(await sha256Hex(body)));

      const stored = await backend.objectStorage.get(key);
      expect(stored?.bytes).toEqual(body);
      expect(stored?.meta.mimeType).toBe("image/png");
    });

    it("ADP-storage-019: reads back nothing for an unknown key", async () => {
      expect(await backend.objectStorage.get(key)).toBeNull();
    });

    it("ADP-storage-018: overwrites the object under an existing key", async () => {
      await backend.objectStorage.put(key, body, meta);
      const replacement = encoder.encode("new-bytes");
      await backend.objectStorage.put(key, replacement, {
        ...meta,
        size: ByteSize.create(replacement.byteLength),
      });

      expect((await backend.objectStorage.get(key))?.bytes).toEqual(
        replacement,
      );
    });

    it("ADP-storage-020: deletes many keys and tolerates absent ones", async () => {
      const other = ObjectKey.create("users/user-1/avatar/file-2.png");
      await backend.objectStorage.put(key, body, meta);
      await backend.objectStorage.put(other, body, meta);

      await backend.objectStorage.deleteMany([
        key,
        ObjectKey.create("users/user-1/avatar/absent.png"),
      ]);
      expect(await backend.objectStorage.get(key)).toBeNull();
      expect(await backend.objectStorage.get(other)).not.toBeNull();

      // A redelivered deletion must not fail.
      await backend.objectStorage.deleteMany([key]);
      await backend.objectStorage.deleteMany([]);
    });

    it("builds a stable public URL that carries the key", async () => {
      const url = backend.objectStorage.publicUrl(key);
      expect(url).toContain(key);
      expect(backend.objectStorage.publicUrl(key)).toBe(url);
    });
  });
}
