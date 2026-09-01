import {
  isBusinessRuleError,
  isRehydrationError,
} from "@repo/core/domain/error";
import { describe, expect, it } from "vitest";
import { BackupRecord } from "../backupRecord";
import { IntegrationErrorCode } from "../errorCode";
import { BackupRecordId, ExternalFileRef } from "../valueObject";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

const AT = new Date("2026-01-01T00:00:00.000Z");

const input = (overrides: Record<string, unknown> = {}) => ({
  id: "backup-1",
  userId: "user-1",
  noteId: "note-1",
  sourceFileId: "file-1",
  externalFileId: "drive-1",
  webViewUrl: "https://drive.example.test/1",
  checksumValue: "a".repeat(64),
  version: 0,
  backedUpAt: AT,
  updatedAt: AT,
  ...overrides,
});

describe("DOM-integration-002: BackupRecordId", () => {
  it("trims and refuses an id that is nothing but whitespace", () => {
    expect(BackupRecordId.create("  backup-1  ")).toBe("backup-1");
    expect(codeOf(() => BackupRecordId.create("   "))).toBe(
      IntegrationErrorCode.InvalidId,
    );
  });
});

describe("DOM-integration-007: ExternalFileRef", () => {
  it("keeps both halves of the address and refuses a missing one", () => {
    expect(
      ExternalFileRef.create("drive-1", "https://drive.example.test/1"),
    ).toEqual({
      externalFileId: "drive-1",
      webViewUrl: "https://drive.example.test/1",
    });
    // Half an address is not an address: with either side empty the
    // record cannot point back at the copy it describes.
    expect(
      codeOf(() => ExternalFileRef.create("", "https://drive.example.test/1")),
    ).toBe(IntegrationErrorCode.InvalidFileRef);
    expect(codeOf(() => ExternalFileRef.create("drive-1", ""))).toBe(
      IntegrationErrorCode.InvalidFileRef,
    );
  });

  it("trims both halves and refuses one that is nothing but whitespace", () => {
    expect(
      ExternalFileRef.create("  drive-1  ", "  https://drive.example.test/1  "),
    ).toEqual({
      externalFileId: "drive-1",
      webViewUrl: "https://drive.example.test/1",
    });
    // Whitespace is no more an address than emptiness is.
    expect(
      codeOf(() =>
        ExternalFileRef.create("   ", "https://drive.example.test/1"),
      ),
    ).toBe(IntegrationErrorCode.InvalidFileRef);
    expect(codeOf(() => ExternalFileRef.create("drive-1", "   "))).toBe(
      IntegrationErrorCode.InvalidFileRef,
    );
  });
});

describe("DOM-integration-009: BackupRecord.reconstruct", () => {
  it("rehydrates a stored row whole", () => {
    const record = BackupRecord.reconstruct(input());

    expect(record.external.externalFileId).toBe("drive-1");
    expect(record.checksum.value).toBe("a".repeat(64));
    expect(record.version).toBe(0);
  });

  it("refuses a row that lost a field storage cannot have emptied", () => {
    for (const overrides of [
      { id: " " },
      { noteId: " " },
      { sourceFileId: " " },
      { externalFileId: "" },
      { externalFileId: " " },
      { webViewUrl: "" },
      { webViewUrl: " " },
    ]) {
      const thrown = ((): unknown => {
        try {
          return BackupRecord.reconstruct(input(overrides));
        } catch (error) {
          return error;
        }
      })();

      expect(isRehydrationError(thrown)).toBe(true);
    }
  });
});
