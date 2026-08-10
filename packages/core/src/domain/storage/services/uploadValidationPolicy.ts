import { BusinessRuleError } from "@repo/core/domain/error";
import { StorageErrorCode } from "../errorCode";
import { ByteSize, type FilePurpose, type MimeType } from "../valueObject";

const MB = 1024 * 1024;

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
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    limitBytes: 5 * MB,
  },
};

/**
 * Decides whether an upload may be accepted, before the bytes are
 * stored. `limitFor` exists to keep the table lookup out of
 * `ensureAcceptable`'s body — usecases only ever call the latter.
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
      mimeType: MimeType;
      size: ByteSize;
    }>,
  ): void => {
    const rule = RULES[params.purpose];
    if (
      rule === undefined ||
      !rule.allowedMimeTypes.includes(params.mimeType)
    ) {
      throw new BusinessRuleError(
        StorageErrorCode.UnsupportedMimeType,
        `Unsupported content type for ${params.purpose}: ${params.mimeType}`,
      );
    }
    if (
      ByteSize.exceeds(
        params.size,
        UploadValidationPolicy.limitFor(params.purpose, params.mimeType),
      )
    ) {
      throw new BusinessRuleError(
        StorageErrorCode.FileTooLarge,
        `File exceeds the ${params.purpose} size limit`,
      );
    }
  },
};
