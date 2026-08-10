import { BusinessRuleError } from "@repo/core/domain/error";

declare const storedFileIdBrand: unique symbol;

/**
 * Minimal Storage vocabulary for the walking-skeleton slice: `Note`
 * references `StoredFileId` (`sourceFileId`, `note.purged` payload). The
 * full Storage domain arrives with the import slice.
 */
export type StoredFileId = string & { readonly [storedFileIdBrand]: true };

export const StoredFileId = {
  create: (id: string): StoredFileId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(
        "STORAGE_INVALID_ID",
        "Invalid stored file id",
      );
    }
    return trimmed as StoredFileId;
  },
};
