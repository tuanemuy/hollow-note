import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A server function reachable only from a `"use client"` component misses
 * the RSC manifest, which is frozen before the client build phase, so its
 * provider module has to be pulled into `routes/__root.tsx` with a bare
 * `import "…/action";` (docs/frontend_implementation_example.md).
 *
 * Nothing in the type system or the build says a line is missing: the
 * module still compiles, the island still imports it, and the call only
 * fails at runtime — where the caller's `catch` can bury it. This test is
 * the substitute, and it derives the requirement instead of listing it, so
 * a new island wired to a new `action.ts` fails here rather than in the
 * browser.
 */

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), "../..");
const ROOT_ROUTE = path.join(APP_DIR, "routes/__root.tsx");

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((entry) => {
    const child = path.join(dir, entry);
    if (statSync(child).isDirectory()) return sourceFiles(child);
    return /\.tsx?$/.test(child) ? [child] : [];
  });

/** Type-only imports are erased, so they never register anything. */
const valueImportsOf = (source: string): readonly string[] =>
  [
    ...source
      .replace(/import\s+type\s+[^"]*"[^"]*";/g, "")
      .matchAll(/(?:^|\s)(?:from|import)\s+"([^"]+)"/g),
  ].map((match) => match[1] as string);

const resolveSpecifier = (from: string, specifier: string): string | null => {
  const base = specifier.startsWith("@/")
    ? path.join(APP_DIR, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return (
    candidates.find((candidate) => {
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    }) ?? null
  );
};

const isClientModule = (source: string): boolean =>
  /^\s*(?:\/\/[^\n]*\n|\s)*["']use client["'];/.test(source);

const rel = (file: string): string => path.relative(APP_DIR, file);

const files = sourceFiles(APP_DIR);
const sources = new Map(
  files.map((file) => [file, readFileSync(file, "utf8")]),
);

const registered = new Set(
  [...(sources.get(ROOT_ROUTE) ?? "").matchAll(/^import\s+"([^"]+)";$/gm)].map(
    (match) => resolveSpecifier(ROOT_ROUTE, match[1] as string),
  ),
);

describe("server function registration", () => {
  it("registers every provider module a client island imports", () => {
    const providers = files.filter((file) =>
      /createServerFn\s*\(/.test(sources.get(file) ?? ""),
    );
    const clientReachable = providers.filter((provider) =>
      files.some(
        (file) =>
          isClientModule(sources.get(file) ?? "") &&
          valueImportsOf(sources.get(file) ?? "").some(
            (specifier) => resolveSpecifier(file, specifier) === provider,
          ),
      ),
    );

    expect(clientReachable.length).toBeGreaterThan(0);
    expect(
      clientReachable.filter((provider) => !registered.has(provider)).map(rel),
    ).toEqual([]);
  });

  it("keeps every registration pointing at a module that declares one", () => {
    const unresolved = [
      ...(sources.get(ROOT_ROUTE) ?? "").matchAll(/^import\s+"([^"]+)";$/gm),
    ]
      .map((match) => match[1] as string)
      .filter((specifier) => {
        const target = resolveSpecifier(ROOT_ROUTE, specifier);
        return (
          target === null ||
          !/createServerFn\s*\(/.test(sources.get(target) ?? "")
        );
      });

    expect(unresolved).toEqual([]);
  });
});
