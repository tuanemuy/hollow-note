import { describe, expect, it } from "vitest";
import {
  filterAllowedSrcset,
  isAllowedUrl,
  schemeOf,
  type UrlKind,
} from "../services/urlPolicy";

type Row = Readonly<{
  title: string;
  url: string;
  navigation: boolean;
  resource: boolean;
}>;

const TAB = "\u0009";
const NEWLINE = "\u000a";
const NUL = "\u0000";

/**
 * The URL scheme table of spec/adr/013, one row per input. Both columns
 * are asserted for every row so a surface cannot be made stricter or
 * laxer than the save path one kind at a time.
 */
const rows: readonly Row[] = [
  {
    title: "https is allowed everywhere",
    url: "https://example.com/a.png",
    navigation: true,
    resource: true,
  },
  {
    title: "http is allowed everywhere",
    url: "http://example.com/a.png",
    navigation: true,
    resource: true,
  },
  {
    title: "mailto navigates but names no resource",
    url: "mailto:a@example.com",
    navigation: true,
    resource: false,
  },
  {
    title: "tel navigates but names no resource",
    url: "tel:+81312345678",
    navigation: true,
    resource: false,
  },
  {
    title: "a relative path carries no scheme",
    url: "images/a.png",
    navigation: true,
    resource: true,
  },
  {
    title: "a root-relative path carries no scheme",
    url: "/images/a.png",
    navigation: true,
    resource: true,
  },
  {
    title: "a fragment carries no scheme",
    url: "#section",
    navigation: true,
    resource: true,
  },
  {
    title: "a colon inside a path segment is not a scheme",
    url: "images/a:b.png",
    navigation: true,
    resource: true,
  },
  {
    title: "javascript is refused",
    url: "javascript:alert(1)",
    navigation: false,
    resource: false,
  },
  {
    title: "the scheme is matched case-insensitively",
    url: "JAVASCRIPT:alert(1)",
    navigation: false,
    resource: false,
  },
  {
    title: "a mixed-case scheme is refused",
    url: "JavaScript:alert(1)",
    navigation: false,
    resource: false,
  },
  {
    title: "a tab inside the scheme does not hide it",
    url: `java${TAB}script:alert(1)`,
    navigation: false,
    resource: false,
  },
  {
    title: "a newline inside the scheme does not hide it",
    url: `java${NEWLINE}script:alert(1)`,
    navigation: false,
    resource: false,
  },
  {
    title: "a NUL inside the scheme does not hide it",
    url: `java${NUL}script:alert(1)`,
    navigation: false,
    resource: false,
  },
  {
    title: "leading whitespace does not hide the scheme",
    url: "  javascript:alert(1)",
    navigation: false,
    resource: false,
  },
  {
    title: "a leading newline does not hide the scheme",
    url: `${NEWLINE}javascript:alert(1)`,
    navigation: false,
    resource: false,
  },
  {
    title: "a leading control character does not hide the scheme",
    url: `${NUL}javascript:alert(1)`,
    navigation: false,
    resource: false,
  },
  {
    title: "vbscript is refused",
    url: "vbscript:msgbox(1)",
    navigation: false,
    resource: false,
  },
  {
    title: "file is refused",
    url: "file:///etc/passwd",
    navigation: false,
    resource: false,
  },
  {
    title: "blob is refused",
    url: "blob:https://example.com/abcd",
    navigation: false,
    resource: false,
  },
  {
    title: "data:image/png is a resource but never a navigation target",
    url: "data:image/png;base64,AAAA",
    navigation: false,
    resource: true,
  },
  {
    title: "data:image/jpeg is a resource",
    url: "data:image/jpeg;base64,AAAA",
    navigation: false,
    resource: true,
  },
  {
    title: "data:image/gif is a resource",
    url: "data:image/gif,AAAA",
    navigation: false,
    resource: true,
  },
  {
    title: "data:image/webp is a resource",
    url: "data:image/webp;base64,AAAA",
    navigation: false,
    resource: true,
  },
  {
    title: "the data MIME type is matched case-insensitively",
    url: "data:IMAGE/PNG;base64,AAAA",
    navigation: false,
    resource: true,
  },
  {
    title: "data:text/html is refused — it can carry script",
    url: "data:text/html;base64,PHNjcmlwdD4=",
    navigation: false,
    resource: false,
  },
  {
    title: "data:image/svg+xml is refused — it can carry script",
    url: "data:image/svg+xml;base64,AAAA",
    navigation: false,
    resource: false,
  },
  {
    title: "a data URL with no MIME type is refused",
    url: "data:,AAAA",
    navigation: false,
    resource: false,
  },
  {
    title: "a control character inside `data:` does not hide the scheme",
    url: `da${TAB}ta:text/html,<script>`,
    navigation: false,
    resource: false,
  },
];

describe("UrlSchemePolicy.isAllowedUrl — spec/adr/013 「許可する URL スキーム」", () => {
  it.each(rows)("$title", ({ url, navigation, resource }) => {
    expect(isAllowedUrl(url, "navigation")).toBe(navigation);
    expect(isAllowedUrl(url, "resource")).toBe(resource);
  });

  it("rejects every kind for a scheme outside both rows", () => {
    const kinds: readonly UrlKind[] = ["navigation", "resource"];
    for (const kind of kinds) {
      expect(isAllowedUrl("ws://example.com", kind)).toBe(false);
    }
  });
});

describe("UrlSchemePolicy.schemeOf", () => {
  it("lower-cases the scheme it reports", () => {
    expect(schemeOf("JavaScript:alert(1)")).toBe("javascript");
  });

  it("reads the scheme through interleaved control characters", () => {
    expect(schemeOf(`java${TAB}script:alert(1)`)).toBe("javascript");
  });

  it("reports no scheme for a relative path", () => {
    expect(schemeOf("images/a.png")).toBeNull();
  });
});

describe("UrlSchemePolicy.filterAllowedSrcset", () => {
  it("keeps the candidates the resource row allows", () => {
    expect(filterAllowedSrcset("/a.png 1x, https://example.com/b.png 2x")).toBe(
      "/a.png 1x, https://example.com/b.png 2x",
    );
  });

  it("drops a refused candidate and keeps the rest", () => {
    // A candidate is split on ASCII whitespace, so the control character
    // that hides the scheme has to be one the split does not consume.
    const rejected: (string | null)[] = [];
    const value = filterAllowedSrcset(
      `/a.png 1x, java${NUL}script:alert(1) 2x`,
      ({ scheme }) => rejected.push(scheme),
    );

    expect(value).toBe("/a.png 1x");
    expect(rejected).toEqual(["javascript"]);
  });

  it("splits on candidates rather than commas so a data URL survives", () => {
    expect(filterAllowedSrcset("data:image/png;base64,AAAA 1x")).toBe(
      "data:image/png;base64,AAAA 1x",
    );
  });

  it("returns null when no candidate survives", () => {
    expect(filterAllowedSrcset("javascript:alert(1) 1x")).toBeNull();
  });
});
