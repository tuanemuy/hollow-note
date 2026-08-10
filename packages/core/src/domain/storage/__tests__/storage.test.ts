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
  it("accepts PNG / JPEG / WebP up to 5 MB", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      expect(
        codeOf(() =>
          UploadValidationPolicy.ensureAcceptable({
            purpose: "avatar",
            mimeType: MimeType.create(mime),
            size: ByteSize.create(5 * MB),
          }),
        ),
      ).toBeNull();
    }
  });

  it("rejects one byte past 5 MB", () => {
    expect(
      codeOf(() =>
        UploadValidationPolicy.ensureAcceptable({
          purpose: "avatar",
          mimeType: MimeType.create("image/png"),
          size: ByteSize.create(5 * MB + 1),
        }),
      ),
    ).toBe(StorageErrorCode.FileTooLarge);
  });

  it("rejects GIF and SVG for an avatar", () => {
    for (const mime of ["image/gif", "image/svg+xml"]) {
      expect(
        codeOf(() =>
          UploadValidationPolicy.ensureAcceptable({
            purpose: "avatar",
            mimeType: MimeType.create(mime),
            size: ByteSize.create(1024),
          }),
        ),
      ).toBe(StorageErrorCode.UnsupportedMimeType);
    }
  });

  it("rejects the purposes whose rules the import slice still owns", () => {
    expect(
      codeOf(() =>
        UploadValidationPolicy.ensureAcceptable({
          purpose: "source",
          mimeType: MimeType.create("application/pdf"),
          size: ByteSize.create(1024),
        }),
      ),
    ).toBe(StorageErrorCode.UnsupportedMimeType);
  });
});
