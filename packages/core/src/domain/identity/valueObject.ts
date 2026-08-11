import { BusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "./errorCode";
import { SameOriginPolicy } from "./services/sameOriginPolicy";

declare const userIdBrand: unique symbol;
declare const identityIdBrand: unique symbol;
declare const sessionIdBrand: unique symbol;
declare const authTokenIdBrand: unique symbol;
declare const emailBrand: unique symbol;
declare const handleBrand: unique symbol;
declare const displayNameBrand: unique symbol;
declare const bioBrand: unique symbol;
declare const avatarUrlBrand: unique symbol;
declare const passwordHashBrand: unique symbol;
declare const plainPasswordBrand: unique symbol;
declare const tokenHashBrand: unique symbol;
declare const loginAttemptKeyBrand: unique symbol;

const createId = <T>(id: string, brandCast: (v: string) => T): T => {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new BusinessRuleError(IdentityErrorCode.InvalidId, "Invalid id");
  }
  return brandCast(trimmed);
};

export type UserId = string & { readonly [userIdBrand]: true };
export const UserId = {
  create: (id: string): UserId => createId(id, (v) => v as UserId),
};

export type IdentityId = string & { readonly [identityIdBrand]: true };
export const IdentityId = {
  create: (id: string): IdentityId => createId(id, (v) => v as IdentityId),
};

export type SessionId = string & { readonly [sessionIdBrand]: true };
export const SessionId = {
  create: (id: string): SessionId => createId(id, (v) => v as SessionId),
};

export type AuthTokenId = string & { readonly [authTokenIdBrand]: true };
export const AuthTokenId = {
  create: (id: string): AuthTokenId => createId(id, (v) => v as AuthTokenId),
};

const EMAIL_MAX_LENGTH = 254;
// Intentionally permissive `local@domain` shape check — deliverability is
// proven by the verification mail, not by the pattern.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/** Normalized (trimmed, lowercased) email address. */
export type Email = string & { readonly [emailBrand]: true };
export const Email = {
  create: (raw: string): Email => {
    const normalized = raw.trim().toLowerCase();
    if (
      normalized.length === 0 ||
      normalized.length > EMAIL_MAX_LENGTH ||
      !EMAIL_PATTERN.test(normalized)
    ) {
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidEmail,
        "Invalid email address",
      );
    }
    return normalized as Email;
  },
};

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/;
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "settings",
  "api",
  "signin",
  "signup",
  "search",
  "notes",
  "workspaces",
  "jobs",
  "tags",
  "n",
  "s",
  "w",
  "auth",
  "admin",
  "about",
  "terms",
  "privacy",
  "sitemap.xml",
  "robots.txt",
]);

/** Public-URL handle. Compared (and stored) in lowercase. */
export type Handle = string & { readonly [handleBrand]: true };
export const Handle = {
  create: (raw: string): Handle => {
    const normalized = raw.trim().toLowerCase();
    // Reserved words are checked first: some ("sitemap.xml", "n") also
    // violate the shape rule, and the reserved verdict is the useful one.
    if (RESERVED_HANDLES.has(normalized)) {
      throw new BusinessRuleError(
        IdentityErrorCode.HandleReserved,
        "Handle is reserved",
      );
    }
    if (!HANDLE_PATTERN.test(normalized)) {
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidHandle,
        "Invalid handle",
      );
    }
    return normalized as Handle;
  },
};

const DISPLAY_NAME_MAX_LENGTH = 50;

export type DisplayName = string & { readonly [displayNameBrand]: true };
export const DisplayName = {
  create: (raw: string): DisplayName => {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidDisplayName,
        "Invalid display name",
      );
    }
    return trimmed as DisplayName;
  },

  /**
   * Shortens instead of rejecting, for names supplied by a source that
   * never agreed to the limit (an OAuth provider profile). An empty name
   * is still a rejection: the caller owns the fallback.
   */
  truncate: (raw: string): DisplayName =>
    DisplayName.create(raw.trim().slice(0, DISPLAY_NAME_MAX_LENGTH)),
};

const BIO_MAX_LENGTH = 500;

export type Bio = string & { readonly [bioBrand]: true };
export const Bio = {
  create: (raw: string): Bio => {
    if (raw.length > BIO_MAX_LENGTH) {
      throw new BusinessRuleError(IdentityErrorCode.InvalidBio, "Invalid bio");
    }
    return raw as Bio;
  },
};

const AVATAR_URL_MAX_LENGTH = 2048;

/**
 * Same-origin location of the profile picture (ADR-016).
 *
 * Two accepted forms: an app-relative path (`/storage/...`) or an
 * absolute URL on the app's own origin. The relative form is the
 * canonical one — a stored value then survives a change of deployment
 * origin — and the absolute form exists for object stores served from
 * their own public domain.
 *
 * `appUrl` is a parameter rather than something this module reads:
 * a value object never reaches for configuration.
 */
export type AvatarUrl = string & { readonly [avatarUrlBrand]: true };
export const AvatarUrl = {
  create: (raw: string, appUrl: string): AvatarUrl => {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > AVATAR_URL_MAX_LENGTH) {
      throw invalidAvatarUrl();
    }
    if (trimmed.startsWith("/")) {
      if (!SameOriginPolicy.isSameOriginPath(trimmed)) {
        throw invalidAvatarUrl();
      }
      return trimmed as AvatarUrl;
    }
    let candidate: URL;
    let base: URL;
    try {
      candidate = new URL(trimmed);
      base = new URL(appUrl);
    } catch {
      throw invalidAvatarUrl();
    }
    if (candidate.origin !== base.origin) {
      throw invalidAvatarUrl();
    }
    return trimmed as AvatarUrl;
  },
};

const invalidAvatarUrl = () =>
  new BusinessRuleError(
    IdentityErrorCode.InvalidAvatarUrl,
    "Avatar URL must be same-origin",
  );

/**
 * Opaque password hash. The only legitimate producer is the
 * `PasswordHasher` port; comparison goes through `PasswordHasher.verify`,
 * never string equality.
 */
export type PasswordHash = string & { readonly [passwordHashBrand]: true };
export const PasswordHash = {
  create: (value: string): PasswordHash => {
    if (value.length === 0) {
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidId,
        "Password hash cannot be empty",
      );
    }
    return value as PasswordHash;
  },
};

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

/**
 * Plain-text password in transit toward `PasswordHasher`. Never log or
 * serialize; equality is intentionally undefined.
 */
export type PlainPassword = string & { readonly [plainPasswordBrand]: true };
export const PlainPassword = {
  create: (raw: string): PlainPassword => {
    if (
      raw.length < PASSWORD_MIN_LENGTH ||
      raw.length > PASSWORD_MAX_LENGTH ||
      !/[a-zA-Z]/.test(raw) ||
      !/[0-9]/.test(raw)
    ) {
      throw new BusinessRuleError(
        IdentityErrorCode.WeakPassword,
        "Password must be 8-128 characters and contain letters and digits",
      );
    }
    return raw as PlainPassword;
  },
};

/**
 * Stored hash of a secret token. The only legitimate producer is the
 * `SecureTokenGenerator` port.
 */
export type TokenHash = string & { readonly [tokenHashBrand]: true };
export const TokenHash = {
  create: (value: string): TokenHash => {
    if (value.length === 0) {
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidId,
        "Token hash cannot be empty",
      );
    }
    return value as TokenHash;
  },
};

export type OAuthProvider = "google";
export const OAuthProvider = {
  create: (raw: string): OAuthProvider => {
    if (raw !== "google") {
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidProviderAccount,
        `Unknown OAuth provider: ${raw}`,
      );
    }
    return raw;
  },
};

const HOUR_MS = 60 * 60 * 1000;

export type AuthTokenPurpose = "email_verification" | "password_reset";
export const AuthTokenPurpose = {
  create: (raw: string): AuthTokenPurpose => {
    if (raw !== "email_verification" && raw !== "password_reset") {
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidId,
        `Invalid auth token purpose: ${raw}`,
      );
    }
    return raw;
  },
  /** email_verification: 24h, password_reset: 1h. */
  ttlMs: (purpose: AuthTokenPurpose): number =>
    purpose === "email_verification" ? 24 * HOUR_MS : HOUR_MS,
};

/**
 * Namespaced key for `LoginAttemptStore` rows:
 * `{namespace}:{subject}:{clientKey}`. The namespace prefix keeps distinct
 * verification kinds from sharing a row and inducing each other's locks.
 * These two factories are the only construction paths — callers never
 * concatenate strings themselves. The share-password variant takes the
 * token *hash* so the shared secret never appears in `login_attempts.key`.
 */
export type LoginAttemptKey = string & {
  readonly [loginAttemptKeyBrand]: true;
};
export const LoginAttemptKey = {
  forSignIn: (email: Email, clientKey: string): LoginAttemptKey =>
    `signIn:${email}:${clientKey}` as LoginAttemptKey,
  forSharePassword: (
    tokenHash: TokenHash,
    clientKey: string,
  ): LoginAttemptKey => `share:${tokenHash}:${clientKey}` as LoginAttemptKey,
};
