import { createMemoryObjectStorage } from "@repo/core/adapters/memory/objectStorage";
import { MemoryBackend } from "@repo/core/adapters/memory/store";
import { installContainerStore } from "@repo/core/application/di/containerStore";
import type { RequestContainer } from "@repo/core/application/di/types";
import type { ObjectStorage } from "@repo/core/application/ports/objectStorage";
import { UserId } from "@repo/core/domain/identity/valueObject";
import {
  ByteSize,
  FILE_PURPOSES,
  type FilePurpose,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { beforeEach, describe, expect, it } from "vitest";
import { PUBLICLY_SERVED_PURPOSES, Route } from "../storage.$";

const owner = StorageOwner.user(UserId.create("user-1"));

/**
 * The route's own GET handler. `handlers` is declared as a record here,
 * but its type also admits the builder-function form, so the shape this
 * file relies on is stated once.
 */
type StorageGetHandler = (
  ctx: Readonly<{ params: Readonly<{ _splat: string }> }>,
) => Promise<Response>;

const handler = (
  Route.options.server as unknown as
    | Readonly<{ handlers: Readonly<{ GET: StorageGetHandler }> }>
    | undefined
)?.handlers.GET;

let objectStorage: ObjectStorage;

/** Stores one object under a key of the given purpose and answers its URL. */
async function put(
  purpose: FilePurpose,
  params: Readonly<{ id: string; mimeType: string; bytes: Uint8Array }>,
): Promise<{ key: ObjectKey; url: string }> {
  const key = ObjectKey.build(
    owner,
    purpose,
    StoredFileId.create(params.id),
    null,
  );
  await objectStorage.put(key, params.bytes, {
    mimeType: MimeType.create(params.mimeType),
    size: ByteSize.create(params.bytes.byteLength),
    checksum: null,
  });
  return { key, url: objectStorage.publicUrl(key) };
}

/** Reads a URL back through the route the same way a browser would. */
const get = async (url: string): Promise<Response> => {
  if (typeof handler !== "function") {
    throw new Error("the storage route declares no GET handler");
  }
  const splat = url.slice("/storage/".length);
  return await handler({ params: { _splat: splat } });
};

beforeEach(() => {
  const backend = new MemoryBackend();
  objectStorage = createMemoryObjectStorage(backend);
  installContainerStore({
    getStore: () => ({ objectStorage }) as unknown as RequestContainer,
  });
});

describe("/storage/$", () => {
  it("TC-storage-175: serves the media URL storeMedia hands the editor", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { url } = await put("media", {
      id: "file-1",
      mimeType: "image/png",
      bytes: png,
    });

    const response = await get(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it("TC-storage-176: serves a stored SVG under nosniff and a sandbox policy", async () => {
    const { url } = await put("media", {
      id: "file-2",
      mimeType: "image/svg+xml",
      bytes: new TextEncoder().encode("<svg xmlns='x'></svg>"),
    });

    const response = await get(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "sandbox; default-src 'none'",
    );
  });

  it("serves exactly the purposes spec/domains/storage.md publishes, and refuses the rest of the key space", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    // The canon, restated rather than read from the route: this is the
    // side of the pair that has to fail when the route's set changes.
    const published: readonly FilePurpose[] = ["avatar", "media"];
    expect([...PUBLICLY_SERVED_PURPOSES].sort()).toEqual([...published].sort());

    for (const purpose of published) {
      const stored = await put(purpose, {
        id: `served-${purpose}`,
        mimeType: "image/png",
        bytes,
      });
      expect((await get(stored.url)).status).toBe(200);
    }

    // The complement comes from `FILE_PURPOSES`, so a purpose added to
    // the key space is covered here without this file being edited.
    const refused = FILE_PURPOSES.filter(
      (purpose) => !published.includes(purpose),
    );
    expect(refused.length).toBeGreaterThan(0);
    for (const purpose of refused) {
      const stored = await put(purpose, {
        id: `file-of-${purpose}`,
        mimeType: "application/pdf",
        bytes,
      });
      expect((await get(stored.url)).status).toBe(404);
    }
  });

  it("answers 404 for an unknown key and for a key of another shape", async () => {
    expect((await get("/storage/users/user-1/media/missing")).status).toBe(404);
    expect((await get("/storage/nonsense")).status).toBe(404);
  });
});
