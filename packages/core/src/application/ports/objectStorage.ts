import type {
  ByteSize,
  Checksum,
  MimeType,
  ObjectKey,
} from "@repo/core/domain/storage/valueObject";

export type ObjectMeta = Readonly<{
  mimeType: MimeType;
  size: ByteSize;
  checksum: Checksum | null;
}>;

export type ObjectBody = Readonly<{
  bytes: Uint8Array;
  meta: ObjectMeta;
}>;

export type PutResult = Readonly<{ size: ByteSize; checksum: Checksum }>;

/**
 * The object store behind the metadata rows. It lives outside every unit
 * of work: `put` runs before the transaction that records the file, and
 * `deleteMany` runs in the `storage.fileDeleted` subscriber after the
 * row is already gone.
 *
 * Only the plural `deleteMany` exists, since the single path to deleting
 * objects is that subscriber receiving a batch — one file is an array of
 * one. `put` returns the size and checksum **measured from the bytes it
 * wrote**, so nothing has to ask the store about an object it just wrote
 * and a mistaken `meta` cannot make the metadata row disagree with the
 * object: `meta` says how the object should be served and what the
 * caller believed it was sending, never what the answer will be.
 *
 * `publicUrl` builds the address a publicly served object is read from,
 * keeping the deployment's URL shape inside the adapter: the in-memory
 * adapter answers with the app's own delivery path, an R2
 * adapter with its public domain. Use it only for objects that really
 * are public — today `avatar` and `media`, the two purposes the delivery
 * route serves without a session. `media` is on that list because a body
 * embeds the URL verbatim and a published note is read anonymously; both
 * rest on a key nobody can guess and no listing path. The purposes here,
 * the ones the delivery route admits, and the table in
 * `spec/domains/storage.md` are one decision written in three places and
 * have to be changed together.
 *
 * Absence is not an error: `get` answers `null` for an unknown key and
 * `deleteMany` tolerates keys that are already gone.
 *
 * Error contract: `SystemError(EXTERNAL_API_ERROR)`.
 */
export interface ObjectStorage {
  put(key: ObjectKey, body: Uint8Array, meta: ObjectMeta): Promise<PutResult>;
  get(key: ObjectKey): Promise<ObjectBody | null>;
  deleteMany(keys: readonly ObjectKey[]): Promise<void>;
  publicUrl(key: ObjectKey): string;
}
