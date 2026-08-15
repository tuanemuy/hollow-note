export const StorageErrorCode = {
  InvalidId: "STORAGE_INVALID_ID",
  InvalidChecksum: "STORAGE_INVALID_CHECKSUM",
  InvalidObjectKey: "STORAGE_INVALID_OBJECT_KEY",
  InvalidByteSize: "STORAGE_INVALID_BYTE_SIZE",
  UnsupportedMimeType: "STORAGE_UNSUPPORTED_MIME_TYPE",
  FileTooLarge: "STORAGE_FILE_TOO_LARGE",
  RefusedUrl: "STORAGE_REFUSED_URL",
  FetchBudgetExceeded: "STORAGE_FETCH_BUDGET_EXCEEDED",
} as const;

export type StorageErrorCode =
  (typeof StorageErrorCode)[keyof typeof StorageErrorCode];
