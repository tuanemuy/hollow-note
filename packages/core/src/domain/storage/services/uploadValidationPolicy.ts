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

export const MEDIA_IMAGE_MAX_BYTES = 20 * MB;
export const MEDIA_VIDEO_MAX_BYTES = 200 * MB;

/**
 * SVG's own ceiling, well below the raster one.
 *
 * An SVG is the one media format that is *rewritten* before it is
 * stored: `storeMedia` runs it through `HtmlProcessor`, whose result is
 * a note-body fragment and therefore bound by that value object's
 * 800,000-byte cap. A limit above what the sanitizer can return would
 * be unreachable — the upload would fail on the body's invariant, in
 * Note's vocabulary, for a file Storage said it would accept.
 *
 * 128 KB is what makes the ceiling reachable for *any* input: HTML
 * serialization expands a byte by at most six (`"` inside an attribute
 * becoming `&quot;`), and 131,072 × 6 = 786,432 stays under 800,000. The
 * bytes that are actually stored are measured against this same limit
 * again, since the sanitizer's output is what the file becomes.
 */
export const MEDIA_SVG_MAX_BYTES = 128 * 1024;

const MEDIA_LIMIT_BYTES = {
  "image/png": MEDIA_IMAGE_MAX_BYTES,
  "image/jpeg": MEDIA_IMAGE_MAX_BYTES,
  "image/gif": MEDIA_IMAGE_MAX_BYTES,
  "image/webp": MEDIA_IMAGE_MAX_BYTES,
  "image/svg+xml": MEDIA_SVG_MAX_BYTES,
  "video/mp4": MEDIA_VIDEO_MAX_BYTES,
  "video/webm": MEDIA_VIDEO_MAX_BYTES,
} as const;

/** The editor's counterpart of `AVATAR_ALLOWED_MIME_TYPES`. */
export const MEDIA_ALLOWED_MIME_TYPES: readonly string[] =
  Object.keys(MEDIA_LIMIT_BYTES);

/**
 * Per-purpose intake rules. The ceiling table doubles as the allow list,
 * so a type cannot be accepted without a limit to judge it by. The
 * purposes still missing belong to usecases of the import slice, and
 * inventing their tables here would fix limits nobody exercises.
 */
const RULES: Partial<Record<FilePurpose, Readonly<Record<string, number>>>> = {
  avatar: Object.fromEntries(
    AVATAR_ALLOWED_MIME_TYPES.map((mimeType) => [mimeType, AVATAR_MAX_BYTES]),
  ),
  media: MEDIA_LIMIT_BYTES,
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const WEBP_FORM_OFFSET = 8;
const FTYP_SIGNATURE = [0x66, 0x74, 0x79, 0x70];
const FTYP_OFFSET = 4;
const FTYP_BRAND_OFFSET = 8;
const FTYP_BRAND_LENGTH = 4;
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];

/**
 * ISO base media brands that mean "an MP4 a browser will play". The
 * `ftyp` box alone does not: HEIC, 3GP and QuickTime carry the same box
 * with their own brand, and accepting them would store a file the
 * `video/mp4` we serve it as cannot decode.
 */
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "avc1",
  "mp41",
  "mp42",
  "mmp4",
  "dash",
]);

/**
 * How far into an EBML header the `webm` DocType is looked for. The
 * signature is shared with Matroska, and only the DocType tells the two
 * apart; a real header carries it within the first few dozen bytes.
 */
const EBML_DOCTYPE_SCAN_BYTES = 64;
const WEBM_DOCTYPE = [0x77, 0x65, 0x62, 0x6d];

/** Prefix of a text upload read to decide whether it opens as SVG. */
const SVG_SCAN_BYTES = 4096;

/** What an XML prologue may hold before the root element. */
const PROLOGUE_PARTS = [
  { open: "<!--", close: "-->" },
  { open: "<?", close: "?>" },
  { open: "<!", close: ">" },
] as const;

const carries = (
  body: Uint8Array,
  signature: readonly number[],
  offset: number,
): boolean =>
  body.length >= offset + signature.length &&
  signature.every((byte, index) => body[offset + index] === byte);

const containsWithin = (
  body: Uint8Array,
  signature: readonly number[],
  limit: number,
): boolean => {
  const last = Math.min(body.length, limit) - signature.length;
  for (let offset = 0; offset <= last; offset += 1) {
    if (carries(body, signature, offset)) {
      return true;
    }
  }
  return false;
};

const asciiAt = (body: Uint8Array, offset: number, length: number): string =>
  body.length < offset + length
    ? ""
    : String.fromCharCode(...body.subarray(offset, offset + length));

const isSpace = (character: string): boolean =>
  character === " " ||
  character === "\t" ||
  character === "\n" ||
  character === "\r" ||
  character === "\f";

/**
 * Whether the bytes open as an SVG document. SVG carries no signature,
 * so the prologue is walked instead: a BOM, an XML declaration, comments
 * and a doctype may precede the root element, and the root element must
 * then be `svg`. A doctype with an internal subset ends the walk early
 * and the upload is refused rather than guessed at — the guess would be
 * about a construct no editor emits.
 */
const opensAsSvg = (body: Uint8Array): boolean => {
  // The BOM never reaches the walk below: `TextDecoder` defaults to
  // `ignoreBOM: false`, which means it *consumes* a leading UTF-8 BOM
  // rather than emitting U+FEFF. Only the rest of the prologue is left
  // to skip here.
  const head = new TextDecoder().decode(body.subarray(0, SVG_SCAN_BYTES));
  let index = 0;
  for (;;) {
    while (index < head.length && isSpace(head[index] ?? "")) {
      index += 1;
    }
    // `<!--` has to be tried before `<!`, or a comment would end at the
    // first `>` inside it.
    const part = PROLOGUE_PARTS.find((candidate) =>
      head.startsWith(candidate.open, index),
    );
    if (part === undefined) {
      break;
    }
    const end = head.indexOf(part.close, index + part.open.length);
    if (end === -1) {
      return false;
    }
    index = end + part.close.length;
  }
  if (!head.startsWith("<svg", index)) {
    return false;
  }
  const delimiter = head[index + "<svg".length];
  return (
    delimiter === ">" ||
    delimiter === "/" ||
    (delimiter !== undefined && isSpace(delimiter))
  );
};

/**
 * The content type the bytes themselves claim, for the formats the
 * filled-in rules accept. `null` means the leading bytes match none of
 * them — which is the only answer this policy can act on, since it
 * refuses anything outside the rule table anyway.
 *
 * The textual test comes last because it is the only one that has to
 * decode the body rather than compare bytes at a fixed offset.
 */
const identifyContentType = (body: Uint8Array): MimeType | null => {
  if (carries(body, PNG_SIGNATURE, 0)) {
    return MimeType.create("image/png");
  }
  if (carries(body, JPEG_SIGNATURE, 0)) {
    return MimeType.create("image/jpeg");
  }
  if (
    carries(body, GIF87A_SIGNATURE, 0) ||
    carries(body, GIF89A_SIGNATURE, 0)
  ) {
    return MimeType.create("image/gif");
  }
  if (
    carries(body, RIFF_SIGNATURE, 0) &&
    carries(body, WEBP_SIGNATURE, WEBP_FORM_OFFSET)
  ) {
    return MimeType.create("image/webp");
  }
  if (
    carries(body, FTYP_SIGNATURE, FTYP_OFFSET) &&
    MP4_BRANDS.has(asciiAt(body, FTYP_BRAND_OFFSET, FTYP_BRAND_LENGTH))
  ) {
    return MimeType.create("video/mp4");
  }
  if (
    carries(body, EBML_SIGNATURE, 0) &&
    containsWithin(body, WEBM_DOCTYPE, EBML_DOCTYPE_SCAN_BYTES)
  ) {
    return MimeType.create("video/webm");
  }
  if (opensAsSvg(body)) {
    return MimeType.create("image/svg+xml");
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
 *
 * Accepting a type is not the same as trusting its content. An accepted
 * `image/svg+xml` still carries whatever markup it was uploaded with;
 * sanitizing it is `HtmlProcessor`'s job, which spec/adr/013 fixes as
 * the single application point of that rule set, and `storeMedia` runs
 * the bytes through it before they are stored.
 */
export const UploadValidationPolicy = {
  limitFor: (purpose: FilePurpose, mimeType: MimeType): ByteSize => {
    const limit = RULES[purpose]?.[mimeType];
    if (limit === undefined) {
      throw new BusinessRuleError(
        StorageErrorCode.UnsupportedMimeType,
        `Uploads of ${mimeType} for purpose ${purpose} are not accepted`,
      );
    }
    return ByteSize.create(limit);
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
      rule[mimeType] === undefined
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
