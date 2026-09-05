export const IntegrationErrorCode = {
  InvalidId: "INTEGRATION_INVALID_ID",
  InvalidFileRef: "INTEGRATION_INVALID_FILE_REF",
} as const;

export type IntegrationErrorCode =
  (typeof IntegrationErrorCode)[keyof typeof IntegrationErrorCode];
