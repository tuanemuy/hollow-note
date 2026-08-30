import { BusinessRuleError } from "@repo/core/domain/error";
import { IntegrationErrorCode } from "./errorCode";

declare const backupRecordIdBrand: unique symbol;

export type BackupRecordId = string & {
  readonly [backupRecordIdBrand]: true;
};

export const BackupRecordId = {
  create: (id: string): BackupRecordId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(
        IntegrationErrorCode.InvalidId,
        "Invalid backup record id",
      );
    }
    return trimmed as BackupRecordId;
  },
};

/** Where a backed-up file ended up in the user's own Drive. */
export type ExternalFileRef = Readonly<{
  externalFileId: string;
  webViewUrl: string;
}>;

export const ExternalFileRef = {
  create: (externalFileId: string, webViewUrl: string): ExternalFileRef => {
    if (externalFileId.length === 0 || webViewUrl.length === 0) {
      throw new BusinessRuleError(
        IntegrationErrorCode.InvalidFileRef,
        "Invalid external file reference",
      );
    }
    return { externalFileId, webViewUrl };
  },
};
