import { BusinessRuleError } from "@repo/core/domain/error";
import { StorageErrorCode } from "../errorCode";
import { ByteSize, type FilePurpose, MimeType } from "../valueObject";

const MB = 1024 * 1024;

/**
 * The icon bounds, published so an upload form can hint the same limits
 * it will be judged against. The values themselves stay owned by the
 * rule table below — the form only reads them.
 */
export const AVATAR_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const AVATAR_MAX_BYTES = 5 * MB;

type PurposeRule = Readonly<{
  allowedMimeTypes: readonly string[];
  limitBytes: number;
}>;

/**
 * Per-purpose intake rules. Only the `avatar` row is filled in: the
 * other purposes belong to usecases of the import slice, and inventing
 * their tables here would fix limits nobody exercises.
 */
const RULES: Partial<Record<FilePurpose, PurposeRule>> = {
  avatar: {
    allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
    limitBytes: AVATAR_MAX_BYTES,
  },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const WEBP_FORM_OFFSET = 8;

const carries = (
  body: Uint8Array,
  signature: readonly number[],
  offset: number,
): boolean =>
  body.length >= offset + signature.length &&
  signature.every((byte, index) => body[offset + index] === byte);

/**
 * The content type the bytes themselves claim, for the formats the
 * filled-in rules accept. `null` means the leading bytes match none of
 * them — which is the only answer this policy can act on, since it
 * refuses anything outside `allowedMimeTypes` anyway.
 */
const identifyContentType = (body: Uint8Array): MimeType | null => {
  if (carries(body, PNG_SIGNATURE, 0)) {
    return MimeType.create("image/png");
  }
  if (carries(body, JPEG_SIGNATURE, 0)) {
    return MimeType.create("image/jpeg");
  }
  if (
    carries(body, RIFF_SIGNATURE, 0) &&
    carries(body, WEBP_SIGNATURE, WEBP_FORM_OFFSET)
  ) {
    return MimeType.create("image/webp");
  }
  return null;
};

/** What the store may record about bytes this policy accepted. */
export type AcceptedUpload = Readonly<{
  mimeType: MimeType;
  size: ByteSize;
}>;

/**
 * Decides whether an upload may be accepted, before the bytes are
 * stored. `limitFor` exists to keep the table lookup out of
 * `ensureAcceptable`'s body — usecases only ever call the latter.
 *
 * Type and size are both read from the bytes rather than from what the
 * client declared, and `ensureAcceptable` answers with them so a caller
 * cannot record anything else: a declaration only ever describes what
 * the sender wanted the object to be taken for, and the defence against
 * a lie must not depend on how the object is later served.
 */
export const UploadValidationPolicy = {
  limitFor: (purpose: FilePurpose, _mimeType: MimeType): ByteSize => {
    const rule = RULES[purpose];
    if (rule === undefined) {
      throw new BusinessRuleError(
        StorageErrorCode.UnsupportedMimeType,
        `Uploads for purpose ${purpose} are not accepted yet`,
      );
    }
    return ByteSize.create(rule.limitBytes);
  },

  ensureAcceptable: (
    params: Readonly<{
      purpose: FilePurpose;
      body: Uint8Array;
    }>,
  ): AcceptedUpload => {
    const rule = RULES[params.purpose];
    const mimeType =
      rule === undefined ? null : identifyContentType(params.body);
    if (
      rule === undefined ||
      mimeType === null ||
      !rule.allowedMimeTypes.includes(mimeType)
    ) {
      throw new BusinessRuleError(
        StorageErrorCode.UnsupportedMimeType,
        `Unsupported content for ${params.purpose}`,
      );
    }
    const size = ByteSize.create(params.body.byteLength);
    if (
      ByteSize.exceeds(
        size,
        UploadValidationPolicy.limitFor(params.purpose, mimeType),
      )
    ) {
      throw new BusinessRuleError(
        StorageErrorCode.FileTooLarge,
        `File exceeds the ${params.purpose} size limit`,
      );
    }
    return { mimeType, size };
  },
};
