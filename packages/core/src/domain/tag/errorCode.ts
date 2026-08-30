export const TagErrorCode = {
  InvalidId: "TAG_INVALID_ID",
} as const;

export type TagErrorCode = (typeof TagErrorCode)[keyof typeof TagErrorCode];
