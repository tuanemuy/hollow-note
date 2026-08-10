import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "../redirect";

const DEL = String.fromCharCode(0x7f);
const NUL = String.fromCharCode(0x00);

describe("safeRedirectPath", () => {
  it("keeps a same-origin absolute path", () => {
    expect(safeRedirectPath("/notes/abc")).toBe("/notes/abc");
    expect(safeRedirectPath("/")).toBe("/");
    expect(safeRedirectPath("/notes?page=2#top")).toBe("/notes?page=2#top");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectPath("//evil.example")).toBe("/notes");
    expect(safeRedirectPath("//evil.example/notes")).toBe("/notes");
  });

  it("rejects backslashes, which some browsers normalize to slashes", () => {
    expect(safeRedirectPath("/\\evil.example")).toBe("/notes");
    expect(safeRedirectPath("\\\\evil.example")).toBe("/notes");
    expect(safeRedirectPath("/notes\\@evil.example")).toBe("/notes");
  });

  it("rejects control characters, which URL parsers strip before resolving", () => {
    expect(safeRedirectPath("/\n/evil.example")).toBe("/notes");
    expect(safeRedirectPath("/\t/evil.example")).toBe("/notes");
    expect(safeRedirectPath("/\r/evil.example")).toBe("/notes");
    expect(safeRedirectPath(`/notes/${DEL}`)).toBe("/notes");
    expect(safeRedirectPath(`/notes/${NUL}`)).toBe("/notes");
  });

  it("rejects scheme-ful values", () => {
    expect(safeRedirectPath("https://evil.example")).toBe("/notes");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/notes");
    expect(safeRedirectPath("data:text/html,<script>")).toBe("/notes");
  });

  it("rejects relative paths", () => {
    expect(safeRedirectPath("notes")).toBe("/notes");
    expect(safeRedirectPath("../notes")).toBe("/notes");
    expect(safeRedirectPath("")).toBe("/notes");
  });

  it("falls back for absent values", () => {
    expect(safeRedirectPath(undefined)).toBe("/notes");
    expect(safeRedirectPath(null)).toBe("/notes");
  });
});
