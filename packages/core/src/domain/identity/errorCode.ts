// `IdentityLimitExceeded` is missing from the enum in
// spec/domains/identity.md while `IdentityPolicy.ensureAddable` requires
// it — treated as a spec omission.
export const IdentityErrorCode = {
  InvalidId: "IDENTITY_INVALID_ID",
  InvalidEmail: "IDENTITY_INVALID_EMAIL",
  InvalidHandle: "IDENTITY_INVALID_HANDLE",
  HandleReserved: "IDENTITY_HANDLE_RESERVED",
  InvalidDisplayName: "IDENTITY_INVALID_DISPLAY_NAME",
  InvalidBio: "IDENTITY_INVALID_BIO",
  WeakPassword: "IDENTITY_WEAK_PASSWORD",
  InvalidProviderAccount: "IDENTITY_INVALID_PROVIDER_ACCOUNT",
  TokenExpired: "IDENTITY_TOKEN_EXPIRED",
  LastIdentityCannotBeRemoved: "IDENTITY_LAST_IDENTITY_CANNOT_BE_REMOVED",
  PasswordIdentityAlreadyExists: "IDENTITY_PASSWORD_IDENTITY_ALREADY_EXISTS",
  IdentityLimitExceeded: "IDENTITY_LIMIT_EXCEEDED",
} as const;

export type IdentityErrorCode =
  (typeof IdentityErrorCode)[keyof typeof IdentityErrorCode];
