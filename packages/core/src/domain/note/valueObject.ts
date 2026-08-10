import type { ConversionFailureReason } from "@repo/core/domain/conversion/valueObject";
import { BusinessRuleError } from "@repo/core/domain/error";
import type {
  PasswordHash,
  TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { NoteErrorCode } from "./errorCode";

declare const noteIdBrand: unique symbol;
declare const revisionIdBrand: unique symbol;
declare const noteHtmlBrand: unique symbol;
declare const plainTextBrand: unique symbol;
declare const excerptBrand: unique symbol;

export type NoteId = string & { readonly [noteIdBrand]: true };
export const NoteId = {
  create: (id: string): NoteId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(NoteErrorCode.InvalidId, "Invalid note id");
    }
    return trimmed as NoteId;
  },
};

export type RevisionId = string & { readonly [revisionIdBrand]: true };
export const RevisionId = {
  create: (id: string): RevisionId => {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      throw new BusinessRuleError(
        NoteErrorCode.InvalidId,
        "Invalid revision id",
      );
    }
    return trimmed as RevisionId;
  },
};

const TITLE_MAX_LENGTH = 200;
const UNTITLED = "無題";

export type NoteTitleOrigin = "auto" | "manual";

/**
 * `origin` records where the title came from: `auto` (file name /
 * conversion result) may be overwritten by later conversion results,
 * `manual` (user input) may not. Equality is on `value` only.
 */
export type NoteTitle = Readonly<{
  value: string;
  origin: NoteTitleOrigin;
}>;

const makeTitle = (raw: string, origin: NoteTitleOrigin): NoteTitle => {
  const trimmed = raw.trim();
  if (trimmed.length > TITLE_MAX_LENGTH) {
    throw new BusinessRuleError(
      NoteErrorCode.InvalidTitle,
      `Note title exceeds maximum length (${TITLE_MAX_LENGTH})`,
    );
  }
  // An empty title never throws — it falls back to the placeholder.
  return { value: trimmed.length === 0 ? UNTITLED : trimmed, origin };
};

export const NoteTitle = {
  create: (raw: string, origin: NoteTitleOrigin): NoteTitle =>
    makeTitle(raw, origin),
  auto: (raw: string): NoteTitle => makeTitle(raw, "auto"),
  manual: (raw: string): NoteTitle => makeTitle(raw, "manual"),
  isAuto: (title: NoteTitle): boolean => title.origin === "auto",
  equals: (a: NoteTitle, b: NoteTitle): boolean => a.value === b.value,
};

const CONTENT_MAX_BYTES = 800_000;

const utf8Encoder = new TextEncoder();

/**
 * A UTF-16 code unit encodes to at most 3 UTF-8 bytes (a surrogate pair
 * spends 2 units on 4 bytes), so `length * 3` is a sound upper bound —
 * below it no encoding pass is needed. The check runs on every
 * `Note.reconstruct`, so avoiding a throwaway 800 KB `Uint8Array` per
 * read matters more than the branch.
 */
const exceedsUtf8Bytes = (value: string, max: number): boolean =>
  value.length * 3 > max && utf8Encoder.encode(value).length > max;

/**
 * Cuts at UTF-16 code units, never inside a surrogate pair: a lone
 * surrogate has no UTF-8 encoding, so `TextEncoder` would replace it
 * with U+FFFD and `JSON.stringify` would emit an unpaired escape once
 * the value reaches the read model. Staying in code units (rather than
 * code points) keeps the result inside the same `length` budget the
 * corresponding `create` guard enforces.
 */
const truncateWithoutSplittingPair = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  const last = value.charCodeAt(max - 1);
  const next = value.charCodeAt(max);
  const splitsPair =
    last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
  return value.slice(0, splitsPair ? max - 1 : max);
};

/**
 * Sanitized HTML fragment. Producers are `HtmlProcessor` results and
 * `NoteHtml.empty()`. The 800,000-byte cap keeps the full `notes` row
 * within the platform's 2,000,000-byte row budget (ADR 017).
 */
export type NoteHtml = string & { readonly [noteHtmlBrand]: true };
export const NoteHtml = {
  create: (value: string): NoteHtml => {
    if (exceedsUtf8Bytes(value, CONTENT_MAX_BYTES)) {
      throw new BusinessRuleError(
        NoteErrorCode.ContentTooLarge,
        `Note HTML exceeds ${CONTENT_MAX_BYTES} bytes`,
      );
    }
    return value as NoteHtml;
  },
  empty: (): NoteHtml => "" as NoteHtml,
};

/**
 * Plain text extracted from the body. Extraction never grows the byte
 * count, so structurally this cannot exceed the `NoteHtml` cap — the
 * explicit check mirrors the same budget.
 */
export type PlainTextContent = string & { readonly [plainTextBrand]: true };
export const PlainTextContent = {
  create: (value: string): PlainTextContent => {
    if (exceedsUtf8Bytes(value, CONTENT_MAX_BYTES)) {
      throw new BusinessRuleError(
        NoteErrorCode.ContentTooLarge,
        `Plain text exceeds ${CONTENT_MAX_BYTES} bytes`,
      );
    }
    return value as PlainTextContent;
  },
};

const EXCERPT_MAX_LENGTH = 200;

export type Excerpt = string & { readonly [excerptBrand]: true };
export const Excerpt = {
  create: (value: string): Excerpt => {
    if (value.length > EXCERPT_MAX_LENGTH) {
      throw new BusinessRuleError(
        NoteErrorCode.ContentTooLarge,
        `Excerpt exceeds ${EXCERPT_MAX_LENGTH} characters`,
      );
    }
    return value as Excerpt;
  },
  fromText: (text: string, max: number = EXCERPT_MAX_LENGTH): Excerpt =>
    truncateWithoutSplittingPair(
      text,
      Math.min(max, EXCERPT_MAX_LENGTH),
    ) as Excerpt,
};

const HEADING_TEXT_MAX_LENGTH = 100;

/** Per-note cap; headings past this are dropped by the entity (ADR 017). */
export const MAX_HEADINGS_PER_NOTE = 200;

/**
 * Table-of-contents entry computed at save time from `HtmlProcessor`
 * output — never recomputed on read. Text past 100 characters is
 * truncated (not rejected).
 */
export type NoteHeading = Readonly<{
  level: number;
  text: string;
  anchorId: string;
}>;
export const NoteHeading = {
  create: (
    params: Readonly<{ level: number; text: string; anchorId: string }>,
  ): NoteHeading => {
    if (
      !Number.isInteger(params.level) ||
      params.level < 1 ||
      params.level > 6 ||
      params.anchorId.length === 0
    ) {
      throw new BusinessRuleError(
        NoteErrorCode.InvalidId,
        "Invalid note heading",
      );
    }
    return {
      level: params.level,
      text: truncateWithoutSplittingPair(params.text, HEADING_TEXT_MAX_LENGTH),
      anchorId: params.anchorId,
    };
  },
};

export type StyleMode = "default" | "preserve";
export const StyleMode = {
  create: (raw: string): StyleMode => {
    if (raw !== "default" && raw !== "preserve") {
      throw new BusinessRuleError(
        NoteErrorCode.InvalidStyleMode,
        `Invalid style mode: ${raw}`,
      );
    }
    return raw;
  },
};

export type NoteOwner =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;

export const NoteOwner = {
  user: (userId: UserId): NoteOwner => ({ type: "user", userId }),
  workspace: (workspaceId: WorkspaceId): NoteOwner => ({
    type: "workspace",
    workspaceId,
  }),
  equals: (a: NoteOwner, b: NoteOwner): boolean =>
    a.type === "user"
      ? b.type === "user" && a.userId === b.userId
      : b.type === "workspace" && a.workspaceId === b.workspaceId,
};

/**
 * Encrypted copy of a share token, kept so the owner can be shown the
 * same share URL again. The plaintext token is never stored; viewer
 * requests compare the hash of the presented token in constant time
 * instead of decrypting this.
 */
export type ProtectedShareToken = Readonly<{
  cipherText: string;
  keyVersion: number;
}>;

export type SharePassword = Readonly<{
  hash: PasswordHash;
  /** When the password was set / changed — invalidates issued passes. */
  updatedAt: Date;
}>;

/**
 * Secret route to an unlisted note. The user-facing token takes the
 * `base64url(NoteId).secret` form: the first half is only a scope
 * locator, access capability comes from the 256-bit secret matching
 * `tokenHash`. The password hash and its update time always travel as a
 * pair — a half-set state is unrepresentable.
 */
export type ShareLink = Readonly<{
  tokenHash: TokenHash;
  protectedToken: ProtectedShareToken;
  password: SharePassword | null;
  issuedAt: Date;
}>;

export const ShareLink = {
  create: (
    params: Readonly<{
      tokenHash: TokenHash;
      protectedToken: ProtectedShareToken;
      password: SharePassword | null;
      issuedAt: Date;
    }>,
  ): ShareLink => {
    if (
      params.protectedToken.cipherText.length === 0 ||
      !Number.isInteger(params.protectedToken.keyVersion) ||
      params.protectedToken.keyVersion <= 0
    ) {
      throw new BusinessRuleError(
        NoteErrorCode.InvalidId,
        "Invalid protected share token",
      );
    }
    return params;
  },
  equals: (a: ShareLink, b: ShareLink): boolean => a.tokenHash === b.tokenHash,
};

const SHARE_PASS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Client-held proof of having passed the share password. Carried as a
 * signed value; tamper detection is a presentation concern.
 */
export type SharePass = Readonly<{
  tokenHash: TokenHash;
  /** The `ShareLink.password.updatedAt` observed when the pass was issued. */
  passwordUpdatedAt: Date;
  issuedAt: Date;
}>;

export const SharePass = {
  ttlMs: SHARE_PASS_TTL_MS,
};

/**
 * Failure vocabulary of a note body: the conversion vocabulary minus
 * `integrationRequired` (represented as `awaitingIntegration` instead)
 * plus `canceled` (a running conversion was terminated from outside —
 * conversion execution itself never returns it).
 */
export type NoteFailureReason =
  | Exclude<ConversionFailureReason, "integrationRequired">
  | "canceled";
