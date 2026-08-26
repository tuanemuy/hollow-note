import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The shared port-conformance suites are the executable form of the port
 * contracts (ADR 026), and "every backend passes them identically" is
 * only worth as much as the call sites make it. Two ways to break it
 * silently: a backend quietly stops calling a suite, or a suite is
 * written and never wired to any backend at all. Both are invisible in a
 * green run, so they are pinned here.
 *
 * The check is textual on purpose — importing the suites would run them —
 * and it counts only calls at the start of a line, so commenting one out
 * is as visible as deleting it.
 */

const ADAPTERS_DIR = fileURLToPath(new URL("../", import.meta.url));
const CONFORMANCE_DIR = join(ADAPTERS_DIR, "conformance");

const CALL_SITES = /^(describe[A-Za-z]*Contract)\s*\(/gm;
const EXPORTS = /\bexport\s+function\s+(describe[A-Za-z]*Contract)\b/g;
const FACTORIES = /\b(make[A-Za-z]*ConformanceBackend)\b/g;
/** Members a `ConformanceBackend` may leave out — `name?(...)`. */
const OPTIONAL_MEMBERS = /^\s{2}([a-z][A-Za-z]*)\?\(/gm;

const walk = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const namesIn = (
  files: readonly string[],
  pattern: RegExp = CALL_SITES,
): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      const name = match[1];
      if (name !== undefined) {
        found.add(name);
      }
    }
  }
  return found;
};

const sorted = (names: ReadonlySet<string>): readonly string[] =>
  [...names].sort();

const testFiles = walk(ADAPTERS_DIR).filter((path) =>
  path.endsWith(".test.ts"),
);

const HARNESSES = ["memory", "cloudflare"].map((backend) => ({
  backend,
  path: join(ADAPTERS_DIR, backend, "__tests__", "conformanceBackend.ts"),
}));

const memoryFiles = testFiles.filter((path) =>
  path.includes(`${join("memory", "__tests__")}`),
);
const cloudflareFiles = testFiles.filter((path) =>
  path.includes(`${join("cloudflare", "__tests__", "conformance")}`),
);

const memoryCalls = namesIn(memoryFiles);
const cloudflareCalls = namesIn(cloudflareFiles);

const exported = new Set<string>();
for (const file of walk(CONFORMANCE_DIR)) {
  for (const match of readFileSync(file, "utf8").matchAll(EXPORTS)) {
    const name = match[1];
    if (name !== undefined) {
      exported.add(name);
    }
  }
}

/**
 * Absolute, because the two set comparisons below are relative: deleting
 * a suite together with both of its call sites satisfies them. Changing
 * either number is the declaration that a port contract was added or
 * withdrawn.
 */
const PERSISTENCE_SUITES = 30;
const ALL_SUITES = PERSISTENCE_SUITES + 1;

describe("port-conformance suite coverage", () => {
  it("runs the same suites against the memory and Cloudflare backends", () => {
    expect(sorted(cloudflareCalls)).toEqual(sorted(memoryCalls));
    expect(memoryCalls.size).toBe(PERSISTENCE_SUITES);
  });

  it("hands each backend's suites that backend's own factory", () => {
    // The suite names above match whichever factory is passed, and both
    // factories share one type, so a file that imported the other one
    // would still run green — against the wrong backend.
    expect(sorted(namesIn(memoryFiles, FACTORIES))).toEqual([
      "makeMemoryConformanceBackend",
    ]);
    expect(sorted(namesIn(cloudflareFiles, FACTORIES))).toEqual([
      "makeCloudflareConformanceBackend",
    ]);
  });

  /**
   * An optional member is the third way to lose a contract silently: the
   * suites that need one skip themselves when a backend does not offer
   * it, so a harness that drops it stays green with fewer cases. The
   * option exists for backends that genuinely cannot answer, and today
   * both do — pinning that here is what makes dropping one a decision
   * rather than an accident.
   */
  it("has every harness offer every optional backend member", () => {
    const optional = sorted(
      namesIn([join(CONFORMANCE_DIR, "backend.ts")], OPTIONAL_MEMBERS),
    );
    expect(optional).not.toEqual([]);
    for (const harness of HARNESSES) {
      const source = readFileSync(harness.path, "utf8");
      for (const member of optional) {
        expect(
          new RegExp(`^\\s+(async\\s+)?${member}\\(`, "m").test(source),
          `${harness.backend} must implement ${member}`,
        ).toBe(true);
      }
    }
  });

  it("leaves no suite unwired to a backend", () => {
    expect(exported.size).toBe(ALL_SUITES);
    // `signInOAuthClient` is the one suite no persistence backend calls:
    // it belongs to `adapters/oauth/`, which is why the check spans every
    // adapter's tests rather than the two backends'.
    expect(sorted(namesIn(testFiles))).toEqual(sorted(exported));
  });
});
