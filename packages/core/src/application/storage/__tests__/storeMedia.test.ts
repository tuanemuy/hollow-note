import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { StorageErrorCode } from "@repo/core/domain/storage/errorCode";
import type { FileStoredEvent } from "@repo/core/domain/storage/events";
import { MEDIA_SVG_MAX_BYTES } from "@repo/core/domain/storage/services/uploadValidationPolicy";
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

const HOSTILE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <foreignObject width="10" height="10"><p>escaped</p></foreignObject>
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
 * An attribute value carrying what looks like the end of the document.
 * The serializer escapes `&` and `"` in a value but not `<` or `>`, so
 * anything that delimits tags by searching for those characters closes
 * the root here and refuses a document that is perfectly well formed.
 */
const CLOSING_TAG_IN_ATTRIBUTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" data-note="a>b </svg> more"><rect width="4" height="4"/></svg>`;

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
    // Every `&` comes back as `&amp;`, so bytes the policy accepted turn
    // into bytes it would not have. What is stored is what has to obey
    // the limit.
    const growing = `<svg xmlns="http://www.w3.org/2000/svg"><text>${"&".repeat(
      MEDIA_SVG_MAX_BYTES / 2,
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

  it("TC-storage-256: an attribute value that looks like the end of the document does not end it", async () => {
    const h = harness();
    const noteId = await createPersonalNote(h);

    await upload(h, noteId, {
      body: svg(CLOSING_TAG_IN_ATTRIBUTE_SVG),
      fileName: "quoted.svg",
    });

    const stored = await storedBytes(h, onlyFile(h, personalScope).objectKey);
    expect(stored).toContain('data-note="a>b </svg> more"');
    expect(stored.endsWith("</svg>")).toBe(true);
    // One declaration, inserted into the root's real start tag.
    expect(stored.split(SVG_NAMESPACE)).toHaveLength(2);
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
