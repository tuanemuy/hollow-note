import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteErrorCode } from "@repo/core/domain/note/errorCode";
import { HtmlProcessorLimit } from "@repo/core/domain/note/ports/htmlProcessor";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { StorageErrorCode } from "@repo/core/domain/storage/errorCode";
import type { FileStoredEvent } from "@repo/core/domain/storage/events";
import {
  MEDIA_SVG_MAX_BYTES,
  MEDIA_SVG_MAX_DEPTH,
  UploadValidationPolicy,
} from "@repo/core/domain/storage/services/uploadValidationPolicy";
import { ObjectKey } from "@repo/core/domain/storage/valueObject";
import { UsageErrorCode } from "@repo/core/domain/usage/errorCode";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import { QuotaSubject } from "@repo/core/domain/usage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import type { TestHarness } from "../../__tests__/helpers";
import type { RequestContainer } from "../../di/types";
import { createBlankNote } from "../../note/createBlankNote";
import { moveNote } from "../../note/moveNote";
import { trashNote } from "../../note/trashNote";
import { ScopeKey } from "../../scope";
import { recalculateStorageUsage } from "../../usage/recalculateStorageUsage";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectNotFound,
  outboxPayloads,
  seedUser,
  seedWorkspace,
} from "../../workspace/__tests__/harness";
import { type StoreMediaInput, storeMedia } from "../storeMedia";

const ACTOR = "user-1";
const BOSS = "owner-1";
const WORKSPACE_ID = "workspace-1";
const MB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;
/** `ByteQuota.defaultFor` for a personal subject. */
const USER_STORAGE_LIMIT_BYTES = 5 * GIB;

const actorId = UserId.create(ACTOR);
const personalScope = ScopeKey.user(actorId);
const workspaceScope = ScopeKey.workspace(WorkspaceId.create(WORKSPACE_ID));

// --- bodies ---------------------------------------------------------------

const ascii = (text: string): readonly number[] =>
  [...text].map((character) => character.charCodeAt(0));

const withSignature = (
  bytes: number,
  parts: readonly Readonly<{ offset: number; signature: readonly number[] }>[],
): Uint8Array => {
  const end = Math.max(
    ...parts.map((part) => part.offset + part.signature.length),
  );
  const body = new Uint8Array(Math.max(bytes, end));
  for (const part of parts) {
    body.set(part.signature, part.offset);
  }
  return body;
};

const png = (bytes = 32): Uint8Array =>
  withSignature(bytes, [
    { offset: 0, signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ]);

const gif = (bytes = 32): Uint8Array =>
  withSignature(bytes, [{ offset: 0, signature: ascii("GIF89a") }]);

const mp4 = (bytes = 32): Uint8Array =>
  withSignature(bytes, [
    { offset: 4, signature: ascii("ftyp") },
    { offset: 8, signature: ascii("isom") },
  ]);

const svg = (markup: string): Uint8Array => new TextEncoder().encode(markup);

/** Neither a signature nor an SVG prologue: the rule table has no row. */
const plainText = (): Uint8Array =>
  new TextEncoder().encode("# just some markdown\n");

// The payload inside `foreignObject` is a `<label>` rather than the `<p>`
// such a file usually carries: `p` is one of the element names the intake
// refuses outright (TC-storage-269), so this document would never reach
// the sanitizer at all and the case below would test nothing.
const HOSTILE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <foreignObject width="10" height="10"><label>escaped</label></foreignObject>
  <use xlink:href="https://evil.example/sprite.svg#icon"/>
  <use href="/other.svg#icon"/>
  <rect width="10" height="10" fill="#ffffff"/>
</svg>`;

const DRAWING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 20">
  <defs>
    <linearGradient id="grad"><stop offset="0%" stop-color="#fff"/></linearGradient>
    <path id="glyph" d="M0 0 L10 10"/>
  </defs>
  <rect width="20" height="20" fill="url(#grad)"/>
  <circle cx="10" cy="10" r="5" stroke="#000" stroke-width="2"/>
  <text x="1" y="18" font-size="4">hello</text>
  <use href="#glyph"/>
  <use xlink:href="#glyph"/>
</svg>`;

/**
 * Allow-list-clean markup that is nonetheless not an SVG document: the
 * sanitizer keeps everything after `</svg>`, and XML treats content past
 * the root element as a fatal error. Text and an element are separate
 * cases — nothing outside the root may survive, whatever its kind.
 */
const TRAILING_SVG = {
  text: `<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>trailing text`,
  element: `<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg><p>and a paragraph</p>`,
  sibling: `<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg><svg><circle r="1"/></svg>`,
} as const;

/**
 * Characters `String.prototype.trim` drops but XML's `S` production does
 * not admit: after the root element they are character data, and content
 * in the Misc that follows the root is a fatal XML error. Judging "the
 * root is alone" with `trim` stores each of these as an `image/svg+xml`
 * that renders nothing.
 */
const NON_XML_SPACE_TRAILERS = {
  bom: "\uFEFF",
  emSpace: "\u2003",
  lineSeparator: "\u2028",
} as const;

const trailedBy = (trailer: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>${trailer}`;

/**
 * An attribute value carrying what looks like the end of a tag. The
 * serializer escapes `&` and `"` in a value but not `>`, so anything
 * that delimits tags by searching for that character ends the root's
 * start tag here and refuses a document that is perfectly well formed.
 * (`<` cannot join it: XML forbids one inside an attribute value, which
 * is a separate case below.)
 */
const CLOSING_TAG_IN_ATTRIBUTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" data-note="a>b /svg> more"><rect width="4" height="4"/></svg>`;

/**
 * U+00A0 in text and in an attribute value. The HTML serializer writes
 * both as `&nbsp;`, and a `.svg` carries no DTD to define that name, so
 * storing it verbatim is an undefined entity — a fatal XML error.
 */
const NBSP_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg">` +
  `<text>a\u00A0b</text><rect data-x="c\u00A0d" width="4" height="4"/></svg>`;

/**
 * A `<` written the only way XML admits one — as `&lt;` — in an
 * attribute value and in text. HTML serialization escapes `<` in text
 * but not in an attribute value, so the attribute comes back holding
 * the character raw, which XML forbids.
 */
const LESS_THAN_ATTRIBUTE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg">` +
  `<text aria-label="x &lt; y" data-note="p&lt;q">a&lt;b</text>` +
  `<rect width="4" height="4"/></svg>`;

/**
 * `desc` and `title` are HTML integration points: the parser resumes
 * HTML parsing under them, so without a rule of its own the whole HTML
 * allow list gets in — `<style>`, which XML then reads as SVG's own
 * `style` element applying to the document, and void elements that
 * serialize with no closing tag at all.
 */
// `img`, `br` and `b` — the elements this case used to carry — are
// refused by name at the intake now (TC-storage-269), so the void
// element and the formatting element here are the ones the HTML parser
// keeps inside foreign content: `wbr`, `input` and `label`.
const INTEGRATION_POINT_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg"><desc>` +
  `<style>rect{fill:red}</style><input value="x"/>a<wbr/>b</desc>` +
  `<title><label>bold</label></title><rect width="4" height="4"/></svg>`;

/**
 * Markup no XML parser opens, each broken in its own way. All of them
 * are what the *uploaded* bytes look like, and a browser refuses every
 * one of them, so refusing at the intake costs nothing that would have
 * rendered.
 */
const MALFORMED_SVG = {
  controlCharacter: `<svg xmlns="http://www.w3.org/2000/svg"><desc>a\u0001b</desc><rect width="4" height="4"/></svg>`,
  unclosedTag: `<svg xmlns="http://www.w3.org/2000/svg"><desc><wbr></desc><rect width="4" height="4"/></svg>`,
  undefinedEntity: `<svg xmlns="http://www.w3.org/2000/svg"><text>a&nbsp;b</text></svg>`,
  rawLessThan: `<svg xmlns="http://www.w3.org/2000/svg" data-note="a<b"><rect width="4" height="4"/></svg>`,
} as const;

/** A document `levels` elements deep, the root included. */
const nestedSvg = (levels: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg">${"<g>".repeat(levels - 1)}` +
  `x${"</g>".repeat(levels - 1)}</svg>`;

const repeatedInsideDesc = (unit: string, bytes: number): string => {
  const head = `<svg xmlns="http://www.w3.org/2000/svg"><desc>`;
  return `${head}${unit.repeat(Math.floor((bytes - head.length) / unit.length))}`;
};

const SVG_NAMESPACE = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK_NAMESPACE = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

/**
 * An SVG of exactly `bytes` bytes whose sanitized form is the same
 * length: the sanitizer drops the `xmlns` and `asStandaloneSvg` puts
 * back the identical declaration, and nothing in the text expands.
 */
const svgOfExactly = (bytes: number): Uint8Array => {
  const head = `<svg ${SVG_NAMESPACE}><text>`;
  const tail = "</text></svg>";
  const body = svg(
    `${head}${"a".repeat(bytes - head.length - tail.length)}${tail}`,
  );
  if (body.byteLength !== bytes) {
    throw new Error(`built ${body.byteLength} bytes, wanted ${bytes}`);
  }
  return body;
};

/**
 * `levels` nested `<name a="i">` elements and the closing tags for them.
 * The attributes differ so the parser's Noah's Ark clause — which keeps
 * at most three identical entries on the list of active formatting
 * elements — does not thin the list out.
 */
const nested = (name: string, levels: number): readonly [string, string] => [
  Array.from({ length: levels }, (_, index) => `<${name} a="${index}">`).join(
    "",
  ),
  `</${name}>`.repeat(levels),
];

/**
 * The review's counterexample, built to `bytes`: well formed, every tag
 * closed, nesting within `MEDIA_SVG_MAX_DEPTH`, and inside the byte
 * ceiling. `<table>` is what takes the parser out of foreign content,
 * and each `<tr>` clears the stack back to the table while leaving the
 * formatting elements on the list of active formatting elements — so
 * every row reconstructs all 61 of them. 131,064 bytes of it serialized
 * into 11,300,523 (86×) in 886 ms.
 */
const fosterParentingSvg = (formatting: string, bytes: number): string => {
  // svg > table > formatting… > tr, so the rows sit exactly at the cap.
  const [open, close] = nested(formatting, MEDIA_SVG_MAX_DEPTH - 3);
  const head = `<svg ${SVG_NAMESPACE}><table>${open}`;
  const tail = `${close}</table></svg>`;
  const row = "<tr>X</tr>";
  const rows = Math.floor((bytes - head.length - tail.length) / row.length);
  return `${head}${row.repeat(rows)}${tail}`;
};

/**
 * The same document with the breakout tag hidden from the intake walk.
 *
 * `readSvgDocument` reads a comment to `-->` and a processing
 * instruction to `?>`, which is what XML says. The HTML tokenizer ends
 * `<?a>` at the first `>` (a bogus comment) and treats `<!-->` as a
 * complete abrupt-closing comment, so everything after it is markup to
 * the parser and invisible to the walk. Eight characters therefore put
 * a `<table>` on exactly one side of the gate.
 *
 * Both forms are *accepted* by the intake and refused by `storeMedia`,
 * in Storage's vocabulary, because the sanitizer stops at its own
 * resource ceiling (spec/adr/013).
 */
const HIDDEN_BREAKOUT_WRAPPERS = {
  processingInstruction: ["<?a>", "<?b?>"],
  comment: ["<!-->", "-->"],
} as const;

const hiddenBreakoutSvg = (
  wrapper: keyof typeof HIDDEN_BREAKOUT_WRAPPERS,
  bytes: number,
): string => {
  const [hide, reveal] = HIDDEN_BREAKOUT_WRAPPERS[wrapper];
  const [open, close] = nested("b", MEDIA_SVG_MAX_DEPTH - 3);
  const head = `<svg ${SVG_NAMESPACE}>${hide}<table>${open}`;
  const tail = `${close}</table>${reveal}</svg>`;
  const row = "<tr>X</tr>";
  const rows = Math.floor((bytes - head.length - tail.length) / row.length);
  return `${head}${row.repeat(rows)}${tail}`;
};

/**
 * The escape ratio, in its simplest form: an attribute value of nothing
 * but raw `"`, quoted with `'` so XML reads the whole run as one
 * well-formed value.
 *
 * The expansion meter charges `attribute.value.length` — the value
 * *before* escaping — while the serializer writes each `"` back as
 * `&quot;`. One byte charged, six bytes out. At the 128 KB ceiling that
 * is a measured 786,073 bytes of output from an input the meter never
 * came close to refusing, which is the review's counterexample to the
 * derivation this ceiling used to carry.
 */
const quoteStuffedSvg = (bytes: number): string => {
  const head = `<svg ${SVG_NAMESPACE}><text transform='`;
  const tail = `'/></svg>`;
  return `${head}${'"'.repeat(bytes - head.length - tail.length)}${tail}`;
};

/**
 * The same ratio behind a hidden `<table>`, where reconstruction
 * multiplies it.
 *
 * Each `<tr>` clears the stack back to the table and reconstructs the
 * formatting element, so the quote-stuffed attribute is written out once
 * per row — six output bytes for every byte the meter charged, times the
 * rows. 20 KB of this serializes past the note body's 800,000-byte cap
 * while spending well under the expansion allowance, so what `process`
 * raises is `NOTE_CONTENT_TOO_LARGE` rather than the ceiling's own code:
 * the second Note code this usecase's boundary has to answer for.
 */
const quoteStuffedFosterSvg = (valueLength: number, rows: number): string => {
  const [hide, reveal] = HIDDEN_BREAKOUT_WRAPPERS.comment;
  const open = `<b title='${'"'.repeat(valueLength)}'>`;
  return (
    `<svg ${SVG_NAMESPACE}>${hide}<table>${open}` +
    `${"<tr>X</tr>".repeat(rows)}</b></table>${reveal}</svg>`
  );
};

/**
 * The same shape with no breakout tag in it: the parser never leaves
 * foreign content, so `<a>` and `<font>` are SVG elements rather than
 * HTML formatting elements and nothing is reconstructed at all.
 */
const foreignOnlySvg = (formatting: string, bytes: number): string => {
  const [open, close] = nested(formatting, MEDIA_SVG_MAX_DEPTH - 2);
  const head = `<svg ${SVG_NAMESPACE}>${open}`;
  const tail = `${close}</svg>`;
  const row = "<text>X</text>";
  const rows = Math.floor((bytes - head.length - tail.length) / row.length);
  return `${head}${row.repeat(rows)}${tail}`;
};

// --- helpers --------------------------------------------------------------

const harness = (): TestHarness => createWorkspaceHarness();

const createPersonalNote = async (h: TestHarness): Promise<string> => {
  seedUser(h, { userId: ACTOR });
  const view = await createBlankNote({
    container: h.container,
    input: { userId: ACTOR, ownerType: "user" },
  });
  return view.noteId;
};

const upload = (
  h: TestHarness,
  noteId: string,
  overrides: Partial<StoreMediaInput> = {},
  container: RequestContainer = h.container,
) =>
  storeMedia({
    container,
    input: {
      userId: ACTOR,
      noteId,
      fileName: "picture.png",
      body: png(),
      ...overrides,
    },
  });

/** The business code `process` refuses `markup` with, in Note's own vocabulary. */
const processRefusalCode = (h: TestHarness, markup: string): string => {
  try {
    h.container.htmlProcessor.process(markup);
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : String(error);
  }
  throw new Error("HtmlProcessor.process accepted the markup");
};

const filesIn = (h: TestHarness, scope: ScopeKey) =>
  h.backend.scope(scope).storedFiles.values();

const storedBytes = async (
  h: TestHarness,
  objectKey: string,
): Promise<string> => {
  const object = await h.container.objectStorage.get(
    ObjectKey.create(objectKey),
  );
  if (object === null) {
    throw new Error(`no object stored at ${objectKey}`);
  }
  return new TextDecoder().decode(object.bytes);
};

const onlyFile = (h: TestHarness, scope: ScopeKey) => {
  const files = filesIn(h, scope);
  const file = files[0];
  if (files.length !== 1 || file === undefined) {
    throw new Error(`expected exactly one stored file, got ${files.length}`);
  }
  return file;
};

/** Fills the personal subject's quota so only `headroom` bytes remain. */
const seedPersonalQuota = async (
  h: TestHarness,
  headroom: number,
): Promise<void> => {
  const now = h.clock.now();
  const quota = StorageQuota.add(
    StorageQuota.initialize(QuotaSubject.user(actorId), now),
    USER_STORAGE_LIMIT_BYTES - headroom,
    now,
  );
  await h.container.scopeUnitOfWorkProvider.run(personalScope, (ctx) =>
    ctx.storageQuotaRepository.insert(quota),
  );
};

/**
 * Runs a real move of the note between the route resolution and the scope
 * read that follows it — the window in which the first scope answers with
 * nothing because the note now lives somewhere else.
 */
const movingAfterFirstResolve = (
  h: TestHarness,
  noteId: string,
): RequestContainer => {
  let moved = false;
  return {
    ...h.container,
    scopeRouter: {
      ...h.container.scopeRouter,
      resolveNote: async (id) => {
        const resolved = await h.container.scopeRouter.resolveNote(id);
        if (!moved) {
          moved = true;
          await moveNote({
            container: h.container,
            input: {
              noteId,
              userId: ACTOR,
              expectedVersion: null,
              targetOwnerType: "workspace",
              targetWorkspaceId: WORKSPACE_ID,
            },
          });
        }
        return resolved;
      },
    },
  };
};

describe("storeMedia", () => {
  it("TC-storage-175: stores a PNG and answers with its delivery URL", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    const view = await upload(h, noteId, { body: png(64) });

    const file = onlyFile(h, personalScope);
    expect(view.fileId).toBe(file.id);
    expect(view.mimeType).toBe("image/png");
    expect(view.size).toBe(64);
    expect(file.objectKey).toBe(`users/${ACTOR}/media/${view.fileId}.png`);
    expect(view.url).toBe(`/storage/${file.objectKey}`);
    expect(
      await h.container.objectStorage.get(ObjectKey.create(file.objectKey)),
    ).not.toBeNull();
  });

  it("TC-storage-176: an SVG is stored as HtmlProcessor.process leaves it, not as it was uploaded", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    const view = await upload(h, noteId, {
      fileName: "icon.svg",
      body: svg(HOSTILE_SVG),
    });

    const file = onlyFile(h, personalScope);
    const stored = await storedBytes(h, file.objectKey);
    expect(stored).not.toBe(HOSTILE_SVG);
    // The bytes are the sanitizer's own output, and nothing but the
    // namespace a standalone document has to carry is added to it.
    expect(stored.replace(` ${SVG_NAMESPACE}`, "")).toBe(
      h.container.htmlProcessor.process(HOSTILE_SVG).html,
    );
    expect(view.size).toBe(new TextEncoder().encode(stored).byteLength);
    expect(file.size).toBe(view.size);
  });

  it("TC-storage-176: the stored SVG declares the namespaces it needs to stand on its own", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId, {
      fileName: "drawing.svg",
      body: svg(DRAWING_SVG),
    });

    // `HtmlProcessor` strips every `xmlns*` — an inline `<svg>` inherits
    // the namespace from the HTML parser. A file served as
    // `image/svg+xml` is parsed as XML: without `xmlns` it renders
    // nothing, and an undeclared `xlink:` prefix is a fatal parse error.
    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored.startsWith(`<svg ${SVG_NAMESPACE} ${XLINK_NAMESPACE}`)).toBe(
      true,
    );
    expect(stored.split(SVG_NAMESPACE)).toHaveLength(2);
    expect(stored.split(XLINK_NAMESPACE)).toHaveLength(2);
  });

  it("TC-storage-176: no xlink namespace is declared when no xlink attribute survives", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    // The only `xlink:href` here points outward, so the sanitizer removes
    // it and the declaration would bind nothing.
    await upload(h, noteId, { fileName: "icon.svg", body: svg(HOSTILE_SVG) });

    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored).toContain(SVG_NAMESPACE);
    expect(stored).not.toContain(XLINK_NAMESPACE);
  });

  it("TC-storage-177: script, foreignObject, on* and outward-pointing href / xlink:href do not survive an SVG", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId, { fileName: "icon.svg", body: svg(HOSTILE_SVG) });

    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored).not.toContain("script");
    expect(stored).not.toContain("alert(");
    expect(stored).not.toContain("foreignObject");
    expect(stored).not.toContain("onload");
    expect(stored).not.toContain("evil.example");
    expect(stored).not.toContain("/other.svg");
    // The drawing that was wrapped around the payload still arrives.
    expect(stored).toContain("<rect");
    expect(stored).toContain('fill="#ffffff"');
  });

  it("TC-storage-178: shapes, paths, text, gradients and a same-document use are stored untouched", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId, {
      fileName: "drawing.svg",
      body: svg(DRAWING_SVG),
    });

    // Serialization is the parser's (`<rect/>` comes back as
    // `<rect></rect>`), so the claim under test is that every drawing
    // construct survives with its attributes, not byte identity.
    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored).toContain('viewBox="0 0 20 20"');
    expect(stored).toContain('<linearGradient id="grad">');
    expect(stored).toContain('<stop offset="0%" stop-color="#fff">');
    expect(stored).toContain('<path id="glyph" d="M0 0 L10 10">');
    expect(stored).toContain('<rect width="20" height="20" fill="url(#grad)">');
    expect(stored).toContain(
      '<circle cx="10" cy="10" r="5" stroke="#000" stroke-width="2">',
    );
    expect(stored).toContain('<text x="1" y="18" font-size="4">hello</text>');
    expect(stored).toContain('<use href="#glyph">');
    expect(stored).toContain('<use xlink:href="#glyph">');
  });

  it("TC-storage-179: an unsupported format is refused as UnsupportedMimeType", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await expectBusinessRule(
      upload(h, noteId, { fileName: "notes.md", body: plainText() }),
      StorageErrorCode.UnsupportedMimeType,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-180: a 21 MB image is refused as FileTooLarge", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await expectBusinessRule(
      upload(h, noteId, { body: gif(21 * MB), fileName: "big.gif" }),
      StorageErrorCode.FileTooLarge,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-181: a 20 MB image is accepted at the boundary", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    const view = await upload(h, noteId, {
      body: gif(20 * MB),
      fileName: "boundary.gif",
    });

    expect(view.size).toBe(20 * MB);
    expect(view.mimeType).toBe("image/gif");
    expect(onlyFile(h, personalScope).size).toBe(20 * MB);
  });

  it("TC-storage-182: a 201 MB video is refused as FileTooLarge", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await expectBusinessRule(
      upload(h, noteId, { body: mp4(201 * MB), fileName: "clip.mp4" }),
      StorageErrorCode.FileTooLarge,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
  });

  it("TC-storage-251: an SVG past its own ceiling is refused as FileTooLarge, not as a body that is too long", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    const oversized = `<svg xmlns="http://www.w3.org/2000/svg"><!--${"a".repeat(
      MEDIA_SVG_MAX_BYTES,
    )}--></svg>`;

    // The sanitizer answers a note-body fragment, so an SVG whose limit
    // sat above what that value object accepts used to fail as
    // `NOTE_CONTENT_TOO_LARGE` — Note's invariant, for a Storage intake.
    await expectBusinessRule(
      upload(h, noteId, { body: svg(oversized), fileName: "huge.svg" }),
      StorageErrorCode.FileTooLarge,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-252: an SVG that grows past the ceiling while being sanitized is refused before it is stored", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    // U+00A0 is two bytes in and six out — the sanitizer writes it as
    // `&nbsp;`, which storing rewrites into the numeric form XML defines
    // — so bytes the policy accepted turn into bytes it would not have.
    // What is stored is what has to obey the limit.
    const growing = `<svg xmlns="http://www.w3.org/2000/svg"><text>${"\u00A0".repeat(
      MEDIA_SVG_MAX_BYTES / 4,
    )}</text></svg>`;
    expect(new TextEncoder().encode(growing).byteLength).toBeLessThan(
      MEDIA_SVG_MAX_BYTES,
    );

    await expectBusinessRule(
      upload(h, noteId, { body: svg(growing), fileName: "growing.svg" }),
      StorageErrorCode.FileTooLarge,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-253: an SVG of exactly 128 KB that does not grow while being sanitized is accepted at the boundary", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    const body = svgOfExactly(MEDIA_SVG_MAX_BYTES);

    const view = await upload(h, noteId, { body, fileName: "boundary.svg" });

    expect(view.mimeType).toBe("image/svg+xml");
    // The row and the capacity both carry the sanitized length, which is
    // what the ceiling is applied to, so the boundary is only reachable
    // for an input that survives the rewrite at the same size.
    expect(view.size).toBe(MEDIA_SVG_MAX_BYTES);
    expect(onlyFile(h, personalScope).size).toBe(MEDIA_SVG_MAX_BYTES);
  });

  it("TC-storage-256: an SVG with anything left after </svg> is refused, since it would not open as a document", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    // The sanitizer answers a body fragment and keeps what follows the
    // root, so accepting these stores an `image/svg+xml` no XML parser
    // reads past the root element.
    expect(
      h.container.htmlProcessor.process(TRAILING_SVG.element).html,
    ).toContain("and a paragraph");

    for (const [shape, markup] of Object.entries(TRAILING_SVG)) {
      await expectBusinessRule(
        upload(h, noteId, { body: svg(markup), fileName: `${shape}.svg` }),
        StorageErrorCode.UnsupportedMimeType,
      );
    }
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-261: a character trim() calls whitespace but XML calls content is refused after </svg>", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    for (const [shape, trailer] of Object.entries(NON_XML_SPACE_TRAILERS)) {
      const markup = trailedBy(trailer);
      // The sanitizer keeps the character, so refusing is this usecase's
      // job alone — without it the byte is stored inside the document.
      expect(h.container.htmlProcessor.process(markup).html).toContain(trailer);
      await expectBusinessRule(
        upload(h, noteId, { body: svg(markup), fileName: `${shape}.svg` }),
        StorageErrorCode.UnsupportedMimeType,
      );
    }
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-268: XML's own whitespace around the root is accepted, the four characters it admits being the ruler", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId, {
      body: svg(`\r\n\t ${trailedBy("\n\t  ")}`),
      fileName: "padded.svg",
    });

    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("TC-storage-260: an upload into a trashed note is refused as NoteIsTrashed, the body being closed to it too", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    await trashNote({
      container: h.container,
      input: {
        noteId,
        userId: ACTOR,
        expectedVersion: 0,
        excludingJobId: null,
      },
    });

    // `NoteAccessPolicy` leaves `canEdit` true for the owner of a trashed
    // note, so nothing below this gate would have stopped the upload: the
    // bytes would fill the subject's capacity while `updateNoteBody`
    // refuses every reference to them.
    await expectBusinessRule(upload(h, noteId), NoteErrorCode.NoteIsTrashed);
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-256: an attribute value that looks like the end of the document does not end it", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId, {
      body: svg(CLOSING_TAG_IN_ATTRIBUTE_SVG),
      fileName: "quoted.svg",
    });

    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored).toContain('data-note="a>b /svg> more"');
    expect(stored.endsWith("</svg>")).toBe(true);
    // One declaration, inserted into the root's real start tag.
    expect(stored.split(SVG_NAMESPACE)).toHaveLength(2);
  });

  it("TC-storage-262: stores U+00A0 as the reference XML defines, not the &nbsp; the serializer writes", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    // The sanitizer's own output carries the undefined entity, in the
    // text and in the attribute value alike, so this is the usecase's to
    // resolve before the bytes become a document.
    expect(h.container.htmlProcessor.process(NBSP_SVG).html).toContain(
      "&nbsp;",
    );

    await upload(h, noteId, { body: svg(NBSP_SVG), fileName: "space.svg" });

    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored).not.toContain("&nbsp;");
    expect(stored).toContain("a&#160;b");
    expect(stored).toContain('data-x="c&#160;d"');
  });

  it("TC-storage-275: stores the `<` of an attribute value as the reference XML requires, the serializer having written it raw", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    // The sanitizer's own output carries the raw character: an HTML
    // attribute value escapes `&`, `"` and U+00A0 and nothing else,
    // while a text node escapes `<` as well.
    const sanitized = h.container.htmlProcessor.process(
      LESS_THAN_ATTRIBUTE_SVG,
    ).html;
    expect(sanitized).toContain('aria-label="x < y"');
    expect(sanitized).toContain("a&lt;b");

    await upload(h, noteId, {
      body: svg(LESS_THAN_ATTRIBUTE_SVG),
      fileName: "compared.svg",
    });

    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored).toContain('aria-label="x &lt; y"');
    expect(stored).toContain('data-note="p&lt;q"');
    // The text node's own escape is left exactly as it was: the walk
    // rewrites what is inside an attribute value and nothing else.
    expect(stored).toContain("a&lt;b");
  });

  it("TC-storage-263: keeps the SVG subset under desc / title, where HTML parsing resumes", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId, {
      body: svg(INTEGRATION_POINT_SVG),
      fileName: "described.svg",
    });

    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    // `<style>` is the one that matters twice over: ADR 013 keeps it out
    // of the SVG subset, and XML reads a surviving one as SVG's own
    // `style` element, applying its CSS to the whole document.
    expect(stored).not.toContain("<style");
    expect(stored).not.toContain("fill:red");
    // Void elements have no closing tag in HTML serialization, so one
    // left inside the root is a mismatched tag to an XML parser.
    expect(stored).not.toContain("<input");
    expect(stored).not.toContain("<wbr");
    expect(stored).not.toContain("<label");
    expect(stored).toContain("<desc>ab</desc>");
    expect(stored).toContain("<rect");
  });

  it("TC-storage-265: refuses markup XML cannot open, whatever it is that breaks it", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    for (const [shape, markup] of Object.entries(MALFORMED_SVG)) {
      await expectBusinessRule(
        upload(h, noteId, { body: svg(markup), fileName: `${shape}.svg` }),
        StorageErrorCode.UnsupportedMimeType,
      );
    }
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-264: accepts an ampersand where XML reads one as a character rather than a reference", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    // A generator comment is where a real drawing carries one, and the
    // references rule has no business there — inside a comment, a
    // processing instruction or CDATA an `&` opens nothing.
    await upload(h, noteId, {
      body: svg(
        `<svg xmlns="http://www.w3.org/2000/svg"><!-- Drawn & exported --><rect width="4" height="4"/></svg>`,
      ),
      fileName: "commented.svg",
    });

    expect(filesIn(h, personalScope)).toHaveLength(1);
  });

  it("TC-storage-266: refuses an SVG nested past the depth the sanitizer's recursion can walk", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    // The two sides below are relative to the constant, so the literal
    // the ledger row names (64 / 65) is pinned here rather than moving
    // with it.
    expect(MEDIA_SVG_MAX_DEPTH).toBe(64);

    await upload(h, noteId, {
      body: svg(nestedSvg(MEDIA_SVG_MAX_DEPTH)),
      fileName: "deep.svg",
    });
    expect(filesIn(h, personalScope)).toHaveLength(1);

    await expectBusinessRule(
      upload(h, noteId, {
        body: svg(nestedSvg(MEDIA_SVG_MAX_DEPTH + 1)),
        fileName: "deeper.svg",
      }),
      StorageErrorCode.UnsupportedMimeType,
    );
    // 6 KB of this used to reach `sanitizeNodes` and answer a bare
    // `RangeError`, which carries no `kind` and reaches the user as an
    // unexplained 500.
    await expectBusinessRule(
      upload(h, noteId, {
        body: svg(repeatedInsideDesc("<b><i>", 8 * 1024)),
        fileName: "recursive.svg",
      }),
      StorageErrorCode.UnsupportedMimeType,
    );
    expect(filesIn(h, personalScope)).toHaveLength(1);
  });

  it("TC-storage-267: refuses an SVG whose parse would multiply before any length is weighed", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    // Unclosed formatting elements across blocks are what makes the HTML
    // parser reconstruct — and duplicate — them: 128 KB of this
    // serialized into a value the note body's 800,000-byte invariant
    // refused, so an accepted upload failed in Note's vocabulary. The
    // last unit carries no breakout tag, so it is the well-formedness
    // walk alone that refuses it rather than the element-name gate.
    for (const unit of ["<b><p>", "<em><p>", "<a><g>"]) {
      await expectBusinessRule(
        upload(h, noteId, {
          body: svg(repeatedInsideDesc(unit, MEDIA_SVG_MAX_BYTES)),
          fileName: "quadratic.svg",
        }),
        StorageErrorCode.UnsupportedMimeType,
      );
    }
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-269: refuses a well-formed SVG carrying a breakout tag, which is what foster parenting needs", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    const markup = fosterParentingSvg("b", MEDIA_SVG_MAX_BYTES);
    // Nothing about this document is malformed and nothing about it is
    // oversized: every tag closes, the nesting is inside the depth cap,
    // and it is under the ceiling. Only the element names are refused.
    expect(new TextEncoder().encode(markup).byteLength).toBeLessThanOrEqual(
      MEDIA_SVG_MAX_BYTES,
    );

    await expectBusinessRule(
      upload(h, noteId, { body: svg(markup), fileName: "foster.svg" }),
      StorageErrorCode.UnsupportedMimeType,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-272: refuses an SVG whose breakout tag is hidden from the intake, in Storage's vocabulary", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    for (const wrapper of ["processingInstruction", "comment"] as const) {
      const markup = hiddenBreakoutSvg(wrapper, MEDIA_SVG_MAX_BYTES);
      const body = svg(markup);
      expect(body.byteLength).toBeLessThanOrEqual(MEDIA_SVG_MAX_BYTES);
      // The gate does not see the `<table>`, so the upload is accepted
      // as an SVG and the sanitizer is what stops it. The point of the
      // case is which vocabulary the failure comes back in: the note
      // body's `NOTE_HTML_TOO_COMPLEX` is not in this usecase's error
      // table and tells an uploader nothing they can act on.
      expect(
        UploadValidationPolicy.ensureAcceptable({ purpose: "media", body })
          .mimeType,
      ).toBe("image/svg+xml");

      await expectBusinessRule(
        upload(h, noteId, { body, fileName: `${wrapper}.svg` }),
        StorageErrorCode.FileTooLarge,
      );
    }
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-270: an SVG of the same shape without a breakout tag is stored at the ceiling", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    // `a` and `font` are the formatting elements that survive the gate,
    // and this is the boundary the ceiling is chosen against: with no
    // breakout tag the parser never leaves foreign content, so nothing
    // is reconstructed and `process` answers a fragment the note body's
    // 800,000-byte invariant accepts instead of `NOTE_CONTENT_TOO_LARGE`.
    for (const [index, formatting] of ["a", "font"].entries()) {
      const markup = foreignOnlySvg(formatting, MEDIA_SVG_MAX_BYTES);
      expect(new TextEncoder().encode(markup).byteLength).toBeGreaterThan(
        MEDIA_SVG_MAX_BYTES - 16,
      );

      const view = await upload(h, noteId, {
        body: svg(markup),
        fileName: `${formatting}.svg`,
      });

      expect(view.mimeType).toBe("image/svg+xml");
      expect(view.size).toBeLessThanOrEqual(MEDIA_SVG_MAX_BYTES);
      expect(filesIn(h, personalScope)).toHaveLength(index + 1);
    }
  });

  it("TC-storage-273: an accepted SVG serializes far past the expansion bound the ceiling used to be derived from", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    const markup = quoteStuffedSvg(MEDIA_SVG_MAX_BYTES);
    const body = svg(markup);
    expect(body.byteLength).toBe(MEDIA_SVG_MAX_BYTES);
    expect(
      UploadValidationPolicy.ensureAcceptable({ purpose: "media", body })
        .mimeType,
    ).toBe("image/svg+xml");

    // The retired derivation read "an input of 131,072 bytes cannot
    // serialize past `maxExpansionFactor` × that". It can: the meter
    // charges an attribute value before it is escaped, and this one
    // measures 786,073 bytes out. That it lands under the body's 800,000
    // is a 1.7% margin, not a promise — which is why the promise moved
    // to `processSvg`'s translation instead.
    const sanitized = h.container.htmlProcessor.process(markup).html;
    expect(sanitized.length).toBeGreaterThan(
      MEDIA_SVG_MAX_BYTES * HtmlProcessorLimit.maxExpansionFactor,
    );
    expect(sanitized.length).toBeLessThan(800_000);

    // Storage answers on its own re-measure of the sanitized bytes,
    // which is the whole job this ceiling has.
    await expectBusinessRule(
      upload(h, noteId, { body, fileName: "quotes.svg" }),
      StorageErrorCode.FileTooLarge,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-274: an SVG whose sanitized form passes the note body's cap is refused in Storage's vocabulary, not Note's", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    const markup = quoteStuffedFosterSvg(20_000, 6);
    const body = svg(markup);
    // Twenty kilobytes, an eighth of the ceiling: the reach of this shape
    // has nothing to do with how much of the ceiling it spends.
    expect(body.byteLength).toBeLessThan(MEDIA_SVG_MAX_BYTES / 4);
    expect(
      UploadValidationPolicy.ensureAcceptable({ purpose: "media", body })
        .mimeType,
    ).toBe("image/svg+xml");

    // The resource meter never fires — it is charged the pre-escape
    // length and the parse completes inside its allowance — so the code
    // that comes out is the note body's own. It is in neither this
    // usecase's error table nor anything an uploader can act on.
    expect(processRefusalCode(h, markup)).toBe(NoteErrorCode.ContentTooLarge);

    await expectBusinessRule(
      upload(h, noteId, { body, fileName: "foster-quotes.svg" }),
      StorageErrorCode.FileTooLarge,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-183: an upload larger than the remaining capacity is refused before any byte is written", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    await seedPersonalQuota(h, 63);

    await expectBusinessRule(
      upload(h, noteId, { body: png(64) }),
      UsageErrorCode.StorageQuotaExceeded,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-183: an upload that exactly fills the remaining capacity is accepted", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    await seedPersonalQuota(h, 64);

    await upload(h, noteId, { body: png(64) });

    expect(filesIn(h, personalScope)).toHaveLength(1);
  });

  it("TC-storage-184: a workspace viewer is answered NOTE_NOT_FOUND", async () => {
    const h = harness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE_ID,
      members: [
        { userId: BOSS, role: "owner" },
        { userId: ACTOR, role: "viewer", membershipId: "membership-actor" },
      ],
    });
    const note = await createBlankNote({
      container: h.container,
      input: {
        userId: BOSS,
        ownerType: "workspace",
        ownerWorkspaceId: WORKSPACE_ID,
      },
    });

    await expectNotFound(upload(h, note.noteId), "NOTE_NOT_FOUND");
    expect(filesIn(h, workspaceScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-185: an unknown note is answered NOTE_NOT_FOUND", async () => {
    const h = harness();
    await createPersonalNote(h);

    await expectNotFound(upload(h, "no-such-note"), "NOTE_NOT_FOUND");
    expect(filesIn(h, personalScope)).toHaveLength(0);
  });

  it("TC-storage-186: a note that moves between the route read and the scope read is stored in the target scope alone", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    await seedWorkspace(h, {
      workspaceId: WORKSPACE_ID,
      members: [{ userId: ACTOR, role: "owner", membershipId: "m-actor" }],
    });

    const view = await upload(
      h,
      noteId,
      { body: png(48) },
      movingAfterFirstResolve(h, noteId),
    );

    const file = onlyFile(h, workspaceScope);
    expect(file.id).toBe(view.fileId);
    expect(file.objectKey).toBe(
      `workspaces/${WORKSPACE_ID}/media/${view.fileId}.png`,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
  });

  it("TC-storage-187: a route being purged is answered NOTE_NOT_FOUND, and nothing is written", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    const route = await h.container.scopeRouter.resolveNote(
      NoteId.create(noteId),
    );
    await h.container.noteRouteStore.beginPurge({
      noteId: NoteId.create(noteId),
      scope: personalScope,
      expectedRouteVersion: route.routeVersion,
      operationId: "purge-op-1",
    });

    await expectNotFound(upload(h, noteId), "NOTE_NOT_FOUND");
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-188: the row records purpose, the note it was inserted into, and who uploaded it", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId);

    const file = onlyFile(h, personalScope);
    expect(file.purpose).toBe("media");
    expect(file.noteId).toBe(noteId);
    expect(file.uploadedBy).toBe(ACTOR);
    expect(file.retention).toBe("persistent");
  });

  it("TC-storage-189: the stored bytes count toward the subject's capacity", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId, { body: png(1024) });

    const stored = outboxPayloads<FileStoredEvent["payload"]>(
      h,
      "storage.fileStored",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.size).toBe(1024);
    const usage = await recalculateStorageUsage({
      container: h.container,
      input: { userId: ACTOR, subjectType: "user", subjectId: ACTOR },
    });
    expect(usage.consumedBytes).toBe(1024);
  });

  it("TC-storage-271: the capacity is weighed on the sanitized length, the one the row records", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    // Everything inside `<script>` is dropped, so what arrives is far
    // longer than what is stored. The gate has to ask about the bytes
    // that fill the quota, or an upload is refused for room it never
    // takes.
    const shrinking = svg(
      `<svg ${SVG_NAMESPACE}><script>${"a".repeat(8 * 1024)}</script>` +
        `<rect width="4" height="4"/></svg>`,
    );
    await seedPersonalQuota(h, 4096);
    expect(shrinking.byteLength).toBeGreaterThan(4096);

    const view = await upload(h, noteId, {
      body: shrinking,
      fileName: "shrinking.svg",
    });

    expect(view.size).toBeLessThan(4096);
    const usage = await recalculateStorageUsage({
      container: h.container,
      input: { userId: ACTOR, subjectType: "user", subjectId: ACTOR },
    });
    expect(usage.consumedBytes).toBe(view.size);
  });

  it("TC-storage-271: an SVG that grows while being sanitized is refused for the capacity it will actually take", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);
    // U+00A0 is two bytes in and six out (`&#160;`), so measuring the
    // received bytes lets a subject overrun its quota by what the
    // rewrite adds.
    const growing = svg(
      `<svg ${SVG_NAMESPACE}><text>${"\u00A0".repeat(512)}</text></svg>`,
    );
    await seedPersonalQuota(h, growing.byteLength + 16);

    await expectBusinessRule(
      upload(h, noteId, { body: growing, fileName: "growing.svg" }),
      UsageErrorCode.StorageQuotaExceeded,
    );
    expect(filesIn(h, personalScope)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("rolls the stored object back when the transaction fails", async () => {
    const failure = new Error("transaction rolled back");
    const h = harness();
    const noteId = await createPersonalNote(h);
    const container: RequestContainer = {
      ...h.container,
      scopeUnitOfWorkProvider: {
        ...h.container.scopeUnitOfWorkProvider,
        run: () => Promise.reject(failure),
      },
    };

    await expect(upload(h, noteId, {}, container)).rejects.toBe(failure);

    expect(filesIn(h, personalScope)).toHaveLength(0);
    // Bytes without a metadata row are reachable by no cleanup at all:
    // no owner scan and no `storage.fileDeleted` would ever name them.
    expect(h.backend.objects.size).toBe(0);
  });
});
