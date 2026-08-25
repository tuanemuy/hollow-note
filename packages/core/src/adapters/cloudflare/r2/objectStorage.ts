import { SystemError, SystemErrorCode } from "../../../application/errors";
import type {
  ObjectBody,
  ObjectMeta,
  ObjectStorage,
  PutResult,
} from "../../../application/ports/objectStorage";
import {
  ByteSize,
  Checksum,
  DEFAULT_MIME_TYPE,
  MimeType,
  type ObjectKey,
} from "../../../domain/storage/valueObject";

export type R2ObjectStorageOptions = Readonly<{
  bucket: R2Bucket;
  /**
   * Public domain the bucket is served from, without a trailing slash.
   * Keeping it here is the whole point of `publicUrl`
   * ([ADR 049](../../../../../spec/adr/049-object-storage-public-url.md)):
   * the deployment's URL shape never reaches a usecase.
   */
  publicBaseUrl: string;
  /**
   * Prefix every key is stored under. `""` in production; the conformance
   * factory sets one so a single bucket can serve many backends, which is
   * what gives each of them the empty storage the suites contract for.
   */
  keyPrefix?: string;
}>;

/** Checksum of the stored bytes, kept beside the object so `get` can report it. */
const CHECKSUM_METADATA = "sha256";

/**
 * R2 takes at most 1,000 keys in one `delete`. The port puts no ceiling
 * on a batch — the caller's batch is sized by whatever produced it — so
 * the limit is spent here, one chunk at a time. A partial run is safe to
 * repeat: absence is not an error.
 */
const MAX_KEYS_PER_DELETE = 1000;

const externalError = (context: string, cause: unknown): SystemError =>
  new SystemError(
    SystemErrorCode.ExternalApiError,
    `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  );

const sha256Of = async (body: Uint8Array): Promise<Checksum> => {
  // A fresh buffer rather than `body.buffer`: a view may be a window onto
  // a larger (or shared) buffer, which would digest the wrong bytes.
  const source = new ArrayBuffer(body.byteLength);
  new Uint8Array(source).set(body);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Checksum.sha256(
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );
};

/**
 * `ObjectStorage` over an R2 bucket.
 *
 * R2 sits outside every unit of work: `put` runs before the transaction
 * that records the file, and `deleteMany` runs in the subscriber that
 * fires once the metadata row is already gone. That ordering is what
 * makes an orphaned object — never an orphaned row — the only failure
 * mode, and it is why absence is not an error on either read or delete.
 *
 * `put` reports the size and checksum it **measured**, never what the
 * caller declared, so a mistaken `meta` cannot make the metadata row
 * disagree with the bytes.
 */
export function createR2ObjectStorage(
  options: R2ObjectStorageOptions,
): ObjectStorage {
  const prefix = options.keyPrefix ?? "";
  const physical = (key: ObjectKey): string => `${prefix}${key}`;

  return {
    async put(
      key: ObjectKey,
      body: Uint8Array,
      meta: ObjectMeta,
    ): Promise<PutResult> {
      const size = ByteSize.create(body.byteLength);
      const checksum = await sha256Of(body);
      try {
        await options.bucket.put(physical(key), body, {
          httpMetadata: { contentType: meta.mimeType },
          customMetadata: { [CHECKSUM_METADATA]: checksum.value },
        });
      } catch (cause) {
        throw externalError(`Storing object ${key}`, cause);
      }
      return { size, checksum };
    },

    async get(key: ObjectKey): Promise<ObjectBody | null> {
      try {
        const object = await options.bucket.get(physical(key));
        if (object === null) {
          return null;
        }
        const stored = object.customMetadata?.[CHECKSUM_METADATA];
        return {
          bytes: new Uint8Array(await object.arrayBuffer()),
          meta: {
            mimeType: MimeType.create(
              object.httpMetadata?.contentType ?? DEFAULT_MIME_TYPE,
            ),
            size: ByteSize.create(object.size),
            checksum: stored === undefined ? null : Checksum.sha256(stored),
          },
        };
      } catch (cause) {
        throw externalError(`Reading object ${key}`, cause);
      }
    },

    async deleteMany(keys: readonly ObjectKey[]): Promise<void> {
      for (let from = 0; from < keys.length; from += MAX_KEYS_PER_DELETE) {
        const batch = keys.slice(from, from + MAX_KEYS_PER_DELETE);
        try {
          await options.bucket.delete(batch.map(physical));
        } catch (cause) {
          throw externalError("Deleting objects", cause);
        }
      }
    },

    publicUrl(key: ObjectKey): string {
      return `${options.publicBaseUrl}/${physical(key)}`;
    },
  };
}
