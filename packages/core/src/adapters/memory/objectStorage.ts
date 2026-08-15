import { createHash } from "node:crypto";
import type {
  ObjectBody,
  ObjectMeta,
  ObjectStorage,
  PutResult,
} from "../../application/ports/objectStorage";
import {
  ByteSize,
  Checksum,
  type ObjectKey,
} from "../../domain/storage/valueObject";
import type { MemoryBackend } from "./store";

/** Path of the delivery route that serves these objects. */
export const MEMORY_OBJECT_URL_PREFIX = "/storage";

/**
 * In-process object store. Bytes live for the process lifetime only,
 * like every other table of this backend.
 */
export function createMemoryObjectStorage(
  backend: MemoryBackend,
): ObjectStorage {
  const table = backend.objects;

  return {
    async put(
      key: ObjectKey,
      body: Uint8Array,
      meta: ObjectMeta,
    ): Promise<PutResult> {
      const size = ByteSize.create(body.byteLength);
      const checksum = Checksum.sha256(
        createHash("sha256").update(body).digest("hex"),
      );
      table.set(key, {
        bytes: new Uint8Array(body),
        meta: { ...meta, size, checksum },
      });
      return { size, checksum };
    },

    async get(key: ObjectKey): Promise<ObjectBody | null> {
      const row = table.get(key);
      if (row === undefined) {
        return null;
      }
      return { bytes: new Uint8Array(row.bytes), meta: row.meta };
    },

    async deleteMany(keys: readonly ObjectKey[]): Promise<void> {
      for (const key of keys) {
        table.delete(key);
      }
    },

    /**
     * An app-relative path, so a stored value keeps working when the
     * deployment's origin changes.
     */
    publicUrl(key: ObjectKey): string {
      return `${MEMORY_OBJECT_URL_PREFIX}/${key}`;
    },
  };
}
