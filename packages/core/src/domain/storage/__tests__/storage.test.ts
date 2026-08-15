import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { StorageErrorCode } from "../errorCode";
import { UploadValidationPolicy } from "../services/uploadValidationPolicy";
import { StoredFile } from "../storedFile";
import {
  ByteSize,
  Checksum,
  DEFAULT_MIME_TYPE,
  FileName,
  MimeType,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "../valueObject";

const MB = 1024 * 1024;
const NOW = new Date("2026-05-01T00:00:00.000Z");
const owner = StorageOwner.user(UserId.create("u1"));

const withSignature = (
  signature: readonly number[],
  totalBytes = 64,
  at = 0,
): Uint8Array => {
  const body = new Uint8Array(Math.max(totalBytes, at + signature.length));
  body.set(signature, at);
  return body;
};

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_BYTES = [0xff, 0xd8, 0xff];
const RIFF_BYTES = [0x52, 0x49, 0x46, 0x46];
const WEBP_BYTES = [0x57, 0x45, 0x42, 0x50];
const GIF_BYTES = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

const imageBody = (
  format: "png" | "jpeg" | "webp",
  totalBytes = 64,
): Uint8Array => {
  if (format === "png") {
    return withSignature(PNG_BYTES, totalBytes);
  }
  if (format === "jpeg") {
    return withSignature(JPEG_BYTES, totalBytes);
  }
  const body = withSignature(RIFF_BYTES, totalBytes);
  body.set(WEBP_BYTES, 8);
  return body;
};

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

describe("ObjectKey", () => {
  it("builds an owner- and purpose-scoped key so an owner can be swept at once", () => {
    expect(
      ObjectKey.build(owner, "avatar", StoredFileId.create("f1"), "png"),
    ).toBe("users/u1/avatar/f1.png");
    expect(
      ObjectKey.build(owner, "avatar", StoredFileId.create("f1"), null),
    ).toBe("users/u1/avatar/f1");
  });

  it("refuses traversal, a leading slash, an empty key, and an over-long key", () => {
    expect(codeOf(() => ObjectKey.create("a/../b"))).toBe(
      StorageErrorCode.InvalidObjectKey,
    );
    expect(codeOf(() => ObjectKey.create("/a"))).toBe(
      StorageErrorCode.InvalidObjectKey,
    );
    expect(codeOf(() => ObjectKey.create(""))).toBe(
      StorageErrorCode.InvalidObjectKey,
    );
    expect(codeOf(() => ObjectKey.create("a".repeat(1025)))).toBe(
      StorageErrorCode.InvalidObjectKey,
    );
  });

  it("reads back the purpose it encoded, and nothing from a key of another shape", () => {
    expect(
      ObjectKey.purposeOf(
        ObjectKey.build(owner, "avatar", StoredFileId.create("f1"), "png"),
      ),
    ).toBe("avatar");
    expect(
      ObjectKey.purposeOf(
        ObjectKey.build(owner, "artifact", StoredFileId.create("f1"), null),
      ),
    ).toBe("artifact");
    for (const raw of [
      "users/u1/avatar",
      "users/u1/avatar/nested/f1.png",
      "users//avatar/f1.png",
      "elsewhere/u1/avatar/f1.png",
      "users/u1/portrait/f1.png",
    ]) {
      expect(ObjectKey.purposeOf(ObjectKey.create(raw))).toBeNull();
    }
  });
});

describe("FileName", () => {
  it("sanitizes instead of throwing, and falls back when nothing is left", () => {
    expect(FileName.create(" ../etc/passwd ")).toBe(".._etc_passwd");
    expect(FileName.create("   ")).toBe("file");
    expect(FileName.create("a".repeat(300)).length).toBe(255);
  });
});

describe("MimeType", () => {
  it("normalizes a parameterized type and falls back for a malformed one", () => {
    expect(MimeType.create("Image/PNG; charset=utf-8")).toBe("image/png");
    expect(MimeType.create("not-a-mime")).toBe(DEFAULT_MIME_TYPE);
  });
});

describe("ByteSize / Checksum", () => {
  it("rejects a negative or fractional size", () => {
    expect(codeOf(() => ByteSize.create(-1))).toBe(
      StorageErrorCode.InvalidByteSize,
    );
    expect(codeOf(() => ByteSize.create(1.5))).toBe(
      StorageErrorCode.InvalidByteSize,
    );
    expect(ByteSize.create(0)).toBe(0);
  });

  it("requires a 64-digit hex checksum", () => {
    expect(Checksum.sha256("A".repeat(64)).value).toBe("a".repeat(64));
    expect(codeOf(() => Checksum.sha256("abc"))).toBe(
      StorageErrorCode.InvalidChecksum,
    );
  });
});

describe("StoredFile.register", () => {
  it("registers an avatar and announces it for the usage total", () => {
    const fileId = StoredFileId.create("file-1");
    const registered = StoredFile.register(
      {
        id: "file-1",
        owner,
        objectKey: ObjectKey.build(owner, "avatar", fileId, "png"),
        fileName: "me.png",
        mimeType: "image/png",
        size: 1234,
        checksum: Checksum.sha256("a".repeat(64)),
        purpose: "avatar",
        noteId: null,
        uploadedBy: UserId.create("u1"),
      },
      NOW,
    );

    expect(registered.entity.retention).toBe("persistent");
    expect(registered.entity.noteId).toBeNull();
    expect(registered.entity.version).toBe(0);
    expect(registered.eventDrafts).toHaveLength(1);
    expect(registered.eventDrafts[0]?.type).toBe("storage.fileStored");
    expect(registered.eventDrafts[0]?.payload).toMatchObject({
      fileId: "file-1",
      purpose: "avatar",
      size: 1234,
    });
    expect(StoredFile.isExpired(registered.entity, NOW)).toBe(false);
  });
});

describe("UploadValidationPolicy: avatar", () => {
  it("accepts PNG / JPEG / WebP up to 5 MB and answers with the measured type and size", () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const accepted = UploadValidationPolicy.ensureAcceptable({
        purpose: "avatar",
        body: imageBody(format, 5 * MB),
      });
      expect(accepted.mimeType).toBe(`image/${format}`);
      expect(accepted.size).toBe(5 * MB);
    }
  });

  it("rejects one byte past 5 MB", () => {
    expect(
      codeOf(() =>
        UploadValidationPolicy.ensureAcceptable({
          purpose: "avatar",
          body: imageBody("png", 5 * MB + 1),
        }),
      ),
    ).toBe(StorageErrorCode.FileTooLarge);
  });

  it("rejects GIF and SVG for an avatar", () => {
    const bodies = [
      withSignature(GIF_BYTES),
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ];
    for (const body of bodies) {
      expect(
        codeOf(() =>
          UploadValidationPolicy.ensureAcceptable({ purpose: "avatar", body }),
        ),
      ).toBe(StorageErrorCode.UnsupportedMimeType);
    }
  });

  it("rejects bytes that do not carry an accepted signature, whatever they were declared as", () => {
    const notAnImage = new TextEncoder().encode("<html>not an image</html>");
    expect(
      codeOf(() =>
        UploadValidationPolicy.ensureAcceptable({
          purpose: "avatar",
          body: notAnImage,
        }),
      ),
    ).toBe(StorageErrorCode.UnsupportedMimeType);

    // A RIFF container that is not WebP (e.g. WAVE) is not an avatar.
    const riffWave = withSignature(RIFF_BYTES);
    riffWave.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(
      codeOf(() =>
        UploadValidationPolicy.ensureAcceptable({
          purpose: "avatar",
          body: riffWave,
        }),
      ),
    ).toBe(StorageErrorCode.UnsupportedMimeType);
  });

  it("rejects a body too short to carry a signature", () => {
    expect(
      codeOf(() =>
        UploadValidationPolicy.ensureAcceptable({
          purpose: "avatar",
          body: new Uint8Array(PNG_BYTES.slice(0, 4)),
        }),
      ),
    ).toBe(StorageErrorCode.UnsupportedMimeType);
    expect(
      codeOf(() =>
        UploadValidationPolicy.ensureAcceptable({
          purpose: "avatar",
          body: new Uint8Array(0),
        }),
      ),
    ).toBe(StorageErrorCode.UnsupportedMimeType);
  });

  it("rejects the purposes whose rules the import slice still owns", () => {
    expect(
      codeOf(() =>
        UploadValidationPolicy.ensureAcceptable({
          purpose: "source",
          body: imageBody("png"),
        }),
      ),
    ).toBe(StorageErrorCode.UnsupportedMimeType);
  });
});
