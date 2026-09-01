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
 * 128 KB is what makes the ceiling reachable, and it is reachable only
 * because `readSvgDocument` bounds the *shape* of what is accepted as
 * well as its length. For a well-formed document the HTML parser
 * duplicates no element — reconstruction of the active formatting
 * elements needs misnested or unclosed formatting tags, which is not
 * well-formed — so the only growth left is character escaping, at most
 * six bytes for one (`"` inside an attribute becoming `&quot;`), and
 * 131,072 × 6 = 786,432 stays under 800,000. Without that gate the
 * factor is not a constant at all: `<b a="1">…<b a="k"><p>…` is
 * quadratic, and 3 KB of it serializes into 446 KB.
 *
 * The bytes that are actually stored are measured against this same
 * limit again, since the sanitizer's output is what the file becomes.
 */
export const MEDIA_SVG_MAX_BYTES = 128 * 1024;

/**
 * Deepest element nesting an accepted SVG may carry.
 *
 * `HtmlProcessor` walks the parsed tree with plain recursion (sanitize,
 * text extraction, serialization), so the nesting of the input decides
 * how deep the interpreter stack goes: 1,000 levels — 6 KB of
 * `<b><i>…` — is enough for a `RangeError` that carries no `kind` and
 * reaches the user as an unexplained 500. Real drawings nest a handful
 * of groups deep, so 64 leaves a whole order of magnitude of headroom
 * on both sides.
 */
export const MEDIA_SVG_MAX_DEPTH = 64;

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
const opensAsSvg = (head: string): boolean => {
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

// --- XML well-formedness (spec/adr/013, spec/usecases/storage.md#storeMedia) --

/** XML's `S` production — space, tab, CR, LF — and nothing else. */
const XML_SPACE_ONLY = /^[\t\n\r ]*$/;

/**
 * Code points XML 1.0 admits nowhere in a document. `String.prototype`
 * has no ruler for this: the C0 controls other than tab / CR / LF and the
 * two noncharacters below are a *fatal* error to an XML parser, so a
 * document carrying one renders nothing at all.
 */
const XML_FORBIDDEN_CHAR =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are exactly what XML forbids.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

/** XML's `Name`, kept to the ranges a single UTF-16 unit can express. */
const XML_NAME = /^[A-Za-z_:\u00C0-\uFFFD][-.\w:\u00B7\u00C0-\uFFFD]*$/;

/** What ends a name: XML's `S`, plus the delimiters of a tag. */
const NAME_END = /[\t\n\r />=<'"]/;

const PREDEFINED_ENTITY = /^&(?:amp|lt|gt|apos|quot);/;
const NUMERIC_REFERENCE = /^&#(x)?([0-9a-fA-F]+);/;

const isXmlChar = (code: number): boolean =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  (code >= 0x10000 && code <= 0x10ffff);

/**
 * Whether every `&` opens a reference the document itself defines.
 *
 * A `.svg` served on its own carries no DTD, so the only names XML knows
 * are the five predefined ones; `&nbsp;` — which is what an HTML
 * serializer writes U+00A0 as — is an undefined entity and therefore a
 * fatal error. Asked of character data and attribute values only: inside
 * a comment, a processing instruction or a CDATA section an `&` is just
 * a character, and a real drawing's generator comment may carry one.
 */
const referencesAreDefined = (markup: string): boolean => {
  for (
    let index = markup.indexOf("&");
    index !== -1;
    index = markup.indexOf("&", index + 1)
  ) {
    const reference = markup.slice(index, index + 12);
    const numeric = NUMERIC_REFERENCE.exec(reference);
    if (numeric === null) {
      if (!PREDEFINED_ENTITY.test(reference)) {
        return false;
      }
      continue;
    }
    const code = Number.parseInt(
      numeric[2] as string,
      numeric[1] === undefined ? 10 : 16,
    );
    if (!isXmlChar(code)) {
      return false;
    }
  }
  return true;
};

const skipXmlSpace = (markup: string, from: number): number => {
  let index = from;
  while (
    index < markup.length &&
    XML_SPACE_ONLY.test(markup[index] as string)
  ) {
    index += 1;
  }
  return index;
};

/** Index just past the name starting at `from`, or -1 when it is not one. */
const readName = (markup: string, from: number): number => {
  let index = from;
  while (index < markup.length && !NAME_END.test(markup[index] as string)) {
    index += 1;
  }
  const name = markup.slice(from, index);
  return name.length > 0 && XML_NAME.test(name) ? index : -1;
};

type TagEnd = Readonly<{ end: number; selfClosing: boolean }>;

/**
 * Reads the attribute list of the tag whose name ends at `from`. XML
 * demands what HTML forgives — a separating space, an `=`, a quoted
 * value, and no `<` inside it — so all four are required here.
 */
const readAttributes = (markup: string, from: number): TagEnd | null => {
  let index = from;
  for (;;) {
    const at = skipXmlSpace(markup, index);
    if (markup.startsWith("/>", at)) {
      return { end: at + 2, selfClosing: true };
    }
    if (markup[at] === ">") {
      return { end: at + 1, selfClosing: false };
    }
    if (at === index) {
      return null;
    }
    const nameEnd = readName(markup, at);
    if (nameEnd === -1) {
      return null;
    }
    const equals = skipXmlSpace(markup, nameEnd);
    if (markup[equals] !== "=") {
      return null;
    }
    const quoteAt = skipXmlSpace(markup, equals + 1);
    const quote = markup[quoteAt];
    if (quote !== '"' && quote !== "'") {
      return null;
    }
    const close = markup.indexOf(quote, quoteAt + 1);
    const value = close === -1 ? "" : markup.slice(quoteAt + 1, close);
    if (close === -1 || value.includes("<") || !referencesAreDefined(value)) {
      return null;
    }
    index = close + 1;
  }
};

/** Where a namespace declaration goes on a document that has none. */
export type SvgDocumentShape = Readonly<{
  /** Offset just past the root's tag name. */
  rootNameEnd: number;
  /** The root's start tag, delimited by the walk rather than by `>`. */
  rootTag: string;
}>;

/**
 * The shape of `markup` read as a standalone SVG document, or `null`
 * when it is not one.
 *
 * A stored `.svg` is parsed as XML, where every departure from
 * well-formedness is a *fatal* error: the file renders nothing at all,
 * whatever else is right about it. So this asks the whole question and
 * not a part of it — one `svg` root that closes with nothing but XML
 * whitespace outside it, tags that match, names XML admits, references
 * the document defines, characters XML allows, and nesting within
 * `MEDIA_SVG_MAX_DEPTH`.
 *
 * The same predicate answers at both ends of `storeMedia`: on the bytes
 * as they arrive, so nothing the sanitizer cannot bound is handed to it
 * (see `MEDIA_SVG_MAX_BYTES`), and on the markup that comes back, so
 * what is actually stored is a document rather than a fragment that
 * happens to start with `<svg`. Refusing at the first end costs nothing
 * a browser would have rendered.
 */
export const readSvgDocument = (markup: string): SvgDocumentShape | null => {
  if (XML_FORBIDDEN_CHAR.test(markup)) {
    return null;
  }
  const open: string[] = [];
  let root: SvgDocumentShape | null = null;
  let closed = false;
  let index = 0;

  while (index < markup.length) {
    const next = markup.indexOf("<", index);
    const text = markup.slice(index, next === -1 ? undefined : next);
    if (open.length === 0 && !XML_SPACE_ONLY.test(text)) {
      return null;
    }
    if (!referencesAreDefined(text)) {
      return null;
    }
    if (next === -1) {
      break;
    }
    index = next;

    if (markup.startsWith("<!--", index)) {
      const end = markup.indexOf("-->", index + 4);
      if (end === -1) {
        return null;
      }
      index = end + 3;
      continue;
    }
    if (markup.startsWith("<?", index)) {
      const end = markup.indexOf("?>", index + 2);
      if (end === -1) {
        return null;
      }
      index = end + 2;
      continue;
    }
    if (markup.startsWith("<![CDATA[", index)) {
      const end = markup.indexOf("]]>", index + 9);
      if (open.length === 0 || end === -1) {
        return null;
      }
      index = end + 3;
      continue;
    }
    if (markup.startsWith("<!", index)) {
      // A doctype, and only in the prolog. An internal subset is refused
      // rather than parsed: it can define entities, and then what the
      // references above are judged against is no longer fixed.
      const end = markup.indexOf(">", index + 2);
      if (
        root !== null ||
        end === -1 ||
        markup.slice(index, end).includes("[")
      ) {
        return null;
      }
      index = end + 1;
      continue;
    }
    if (markup.startsWith("</", index)) {
      const nameEnd = readName(markup, index + 2);
      if (nameEnd === -1) {
        return null;
      }
      const after = skipXmlSpace(markup, nameEnd);
      if (
        markup[after] !== ">" ||
        open.pop() !== markup.slice(index + 2, nameEnd)
      ) {
        return null;
      }
      closed = open.length === 0;
      index = after + 1;
      continue;
    }
    if (closed) {
      return null;
    }
    const nameEnd = readName(markup, index + 1);
    if (nameEnd === -1) {
      return null;
    }
    const name = markup.slice(index + 1, nameEnd);
    const tag = readAttributes(markup, nameEnd);
    if (tag === null) {
      return null;
    }
    if (root === null) {
      if (name !== "svg") {
        return null;
      }
      root = { rootNameEnd: nameEnd, rootTag: markup.slice(index, tag.end) };
    }
    // A self-closing tag is a level of the tree like any other, and the
    // HTML serializer writes it back as a pair (`<rect/>` → `<rect></rect>`).
    // Counting it only when it is written as a pair would make the same
    // document pass on the way in and fail on the way out.
    if (open.length + 1 > MEDIA_SVG_MAX_DEPTH) {
      return null;
    }
    if (tag.selfClosing) {
      closed = open.length === 0;
    } else {
      open.push(name);
    }
    index = tag.end;
  }
  return closed && open.length === 0 ? root : null;
};

/**
 * Whether the bytes are an SVG this policy will hand to the sanitizer.
 *
 * The prologue decides *what the bytes claim to be*, and the document
 * walk decides whether that claim can be honoured. The walk is skipped
 * for a body past the ceiling on purpose: it is refused for its size a
 * step later, in Storage's own vocabulary, and never reaches the
 * sanitizer — reading a 200 MB body through as XML would be the only
 * thing the check accomplished.
 */
const identifySvg = (body: Uint8Array): boolean => {
  // The BOM never reaches either walk: `TextDecoder` defaults to
  // `ignoreBOM: false`, which means it *consumes* a leading UTF-8 BOM
  // rather than emitting U+FEFF.
  const decoder = new TextDecoder();
  if (!opensAsSvg(decoder.decode(body.subarray(0, SVG_SCAN_BYTES)))) {
    return false;
  }
  return (
    body.byteLength > MEDIA_SVG_MAX_BYTES ||
    readSvgDocument(decoder.decode(body)) !== null
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
  return identifySvg(body) ? MimeType.create("image/svg+xml") : null;
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
