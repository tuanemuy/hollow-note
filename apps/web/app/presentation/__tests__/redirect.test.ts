import { describe, expect, it } from "vitest";
import {
  boundedRedirectSource,
  REDIRECT_MAX_LENGTH,
  safeRedirectPath,
  signInRedirectOptions,
} from "../redirect";

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

describe("signInRedirectOptions", () => {
  it("carries a same-origin path back as the sign-in destination", () => {
    expect(signInRedirectOptions("/settings/auth")).toEqual({
      to: "/signin",
      search: { redirect: "/settings/auth" },
    });
  });

  it("passes percent-encoded control characters through undecoded", () => {
    // 述語はパーセントエンコードを復号しない。最終消費点は `SignInForm` の
    // `router.history.push` に渡る生文字列なので、`/%0Aevil` は同一オリジン
    // パスとして通るのが正しい。
    expect(signInRedirectOptions("/%0Aevil")).toEqual({
      to: "/signin",
      search: { redirect: "/%0Aevil" },
    });
  });

  it("never lets an off-origin value reach the sign-in search param", () => {
    for (const hostile of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "/\n/evil.example",
      "javascript:alert(1)",
      undefined,
      null,
    ]) {
      expect(signInRedirectOptions(hostile)).toEqual({
        to: "/signin",
        search: { redirect: "/notes" },
      });
    }
  });
});

describe("boundedRedirectSource", () => {
  it("keeps an href at or below the transport limit", () => {
    const atLimit = `/notes?q=${"a".repeat(REDIRECT_MAX_LENGTH - 9)}`;
    expect(atLimit).toHaveLength(REDIRECT_MAX_LENGTH);
    expect(boundedRedirectSource(atLimit)).toBe(atLimit);
    expect(boundedRedirectSource("/notes")).toBe("/notes");
  });

  it("clamps an href past the transport limit to the default destination", () => {
    const overLimit = `/notes?q=${"a".repeat(REDIRECT_MAX_LENGTH - 8)}`;
    expect(overLimit).toHaveLength(REDIRECT_MAX_LENGTH + 1);
    expect(boundedRedirectSource(overLimit)).toBe("/notes");
  });
});
