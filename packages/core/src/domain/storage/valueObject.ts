import { BusinessRuleError } from "@repo/core/domain/error";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteId } from "@repo/core/domain/note/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { StorageErrorCode } from "./errorCode";

declare const storedFileIdBrand: unique symbol;
declare const objectKeyBrand: unique symbol;
declare const fileNameBrand: unique symbol;
declare const mimeTypeBrand: unique symbol;
declare const byteSizeBrand: unique symbol;

export type StoredFileId = string & { readonly [storedFileIdBrand]: true };

export const StoredFileId = {
  create: (id: string): StoredFileId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(
        StorageErrorCode.InvalidId,
        "Invalid stored file id",
      );
    }
    return trimmed as StoredFileId;
  },
};

/** Who the stored bytes count against. Mirrors `ScopeKey` in shape. */
export type StorageOwner =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;

export const StorageOwner = {
  user: (userId: UserId): StorageOwner => ({ type: "user", userId }),
  workspace: (workspaceId: WorkspaceId): StorageOwner => ({
    type: "workspace",
    workspaceId,
  }),
  equals: (a: StorageOwner, b: StorageOwner): boolean =>
    a.type === "user"
      ? b.type === "user" && a.userId === b.userId
      : b.type === "workspace" && a.workspaceId === b.workspaceId,
};

export const FILE_PURPOSES = [
  "source",
  "media",
  "reference",
  "artifact",
  "avatar",
] as const;

export type FilePurpose = (typeof FILE_PURPOSES)[number];

const isFilePurpose = (value: string): value is FilePurpose =>
  (FILE_PURPOSES as readonly string[]).includes(value);

export type FileProvenance =
  | Readonly<{
      purpose: "source" | "media" | "reference";
      noteId: NoteId;
      uploadedBy: UserId;
    }>
  | Readonly<{ purpose: "avatar"; noteId: null; uploadedBy: UserId }>
  | Readonly<{
      purpose: "artifact";
      noteId: NoteId;
      noteVersion: number;
      uploadedBy: UserId | null;
    }>
  | Readonly<{
      purpose: "artifact";
      noteId: null;
      noteVersion: null;
      uploadedBy: UserId | null;
    }>;

const OBJECT_KEY_MAX_LENGTH = 1024;

export type ObjectKey = string & { readonly [objectKeyBrand]: true };

const ownerSegment = (owner: StorageOwner): string =>
  owner.type === "user"
    ? `users/${owner.userId}`
    : `workspaces/${owner.workspaceId}`;

export const ObjectKey = {
  create: (raw: string): ObjectKey => {
    if (
      raw.length === 0 ||
      raw.length > OBJECT_KEY_MAX_LENGTH ||
      raw.includes("..") ||
      raw.startsWith("/")
    ) {
      throw new BusinessRuleError(
        StorageErrorCode.InvalidObjectKey,
        "Invalid object key",
      );
    }
    return raw as ObjectKey;
  },
  /**
   * Owner and purpose form the leading path segments so that everything
   * belonging to one owner can be swept together.
   */
  build: (
    owner: StorageOwner,
    purpose: FilePurpose,
    fileId: StoredFileId,
    extension: string | null,
  ): ObjectKey => {
    const suffix =
      extension === null || extension.trim().length === 0
        ? ""
        : `.${extension.trim().replace(/^\./, "")}`;
    return ObjectKey.create(
      `${ownerSegment(owner)}/${purpose}/${fileId}${suffix}`,
    );
  },
  /**
   * The purpose `build` encoded, or `null` for a key that does not have
   * that shape. Reading the purpose back out is what lets a delivery
   * path decide whether a key may be served publicly without loading
   * the metadata row.
   */
  purposeOf: (key: ObjectKey): FilePurpose | null => {
    const [ownerType, ownerId, purpose, ...rest] = key.split("/");
    if (
      (ownerType !== "users" && ownerType !== "workspaces") ||
      ownerId === undefined ||
      ownerId.length === 0 ||
      purpose === undefined ||
      rest.length !== 1
    ) {
      return null;
    }
    return isFilePurpose(purpose) ? purpose : null;
  },
};

const FILE_NAME_MAX_LENGTH = 255;
const FALLBACK_FILE_NAME = "file";
const SPACE_CODE = 0x20;
const DELETE_CODE = 0x7f;
const SLASH_CODE = 0x2f;
const BACKSLASH_CODE = 0x5c;

// Character codes rather than a regular expression: the range this needs
// includes the C0 controls, which a regex literal cannot spell without
// embedding raw control bytes.
const isUnsafeFileNameChar = (code: number): boolean =>
  code < SPACE_CODE ||
  code === DELETE_CODE ||
  code === SLASH_CODE ||
  code === BACKSLASH_CODE;

/**
 * Sanitized display name. Never throws: an upload is not worth refusing
 * over the name its client happened to send, so unsafe characters are
 * replaced and an empty result falls back to `"file"`.
 */
export type FileName = string & { readonly [fileNameBrand]: true };

export const FileName = {
  create: (raw: string): FileName => {
    const sanitized = [...raw]
      .map((char) =>
        isUnsafeFileNameChar(char.codePointAt(0) ?? 0) ? "_" : char,
      )
      .join("")
      .trim()
      .slice(0, FILE_NAME_MAX_LENGTH);
    return (
      sanitized.length === 0 ? FALLBACK_FILE_NAME : sanitized
    ) as FileName;
  },
};

const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
export const DEFAULT_MIME_TYPE = "application/octet-stream";

/** Falls back to `application/octet-stream` rather than throwing — the
 * upload policy is what decides whether a type is acceptable. */
export type MimeType = string & { readonly [mimeTypeBrand]: true };

export const MimeType = {
  create: (raw: string): MimeType => {
    const normalized = raw.trim().toLowerCase().split(";")[0]?.trim() ?? "";
    return (
      MIME_TYPE_PATTERN.test(normalized) ? normalized : DEFAULT_MIME_TYPE
    ) as MimeType;
  },
};

export type ByteSize = number & { readonly [byteSizeBrand]: true };

export const ByteSize = {
  create: (value: number): ByteSize => {
    if (!Number.isInteger(value) || value < 0) {
      throw new BusinessRuleError(
        StorageErrorCode.InvalidByteSize,
        `Invalid byte size: ${value}`,
      );
    }
    return value as ByteSize;
  },
  /** Used by `UploadValidationPolicy.ensureAcceptable`, not by usecases. */
  exceeds: (size: ByteSize, limit: ByteSize): boolean => size > limit,
};

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type Checksum = Readonly<{ algorithm: "sha256"; value: string }>;

export const Checksum = {
  sha256: (value: string): Checksum => {
    const normalized = value.trim().toLowerCase();
    if (!SHA256_PATTERN.test(normalized)) {
      throw new BusinessRuleError(
        StorageErrorCode.InvalidChecksum,
        "Invalid checksum",
      );
    }
    return { algorithm: "sha256", value: normalized };
  },
};
