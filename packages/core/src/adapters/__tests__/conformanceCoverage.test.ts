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
/**
 * Members a backend declaration may leave out, in **both** syntaxes —
 * `name?(...)` and `name?: ...`. A member is a member whichever way it
 * is written, so watching only the method form would let the property
 * form reopen the hole the case below exists to keep shut.
 *
 * The name class is every identifier the language allows rather than
 * `[a-z][A-Za-z]*`: `seedV2?:` is as much a member as `seed?:`, and a
 * class that stops at letters excuses whichever member happens to carry
 * a digit.
 */
const OPTIONAL_MEMBERS = /^\s{2}([A-Za-z_$][\w$]*)\?[(:]/gm;
/**
 * Runtime opt-outs, in the forms vitest actually offers. `.skip` is
 * matched on the word rather than on a following `(` because the
 * natural way to close a suite on a capability is to bind the modifier
 * to a name first (`const gated = ok ? describe : describe.skip`), which
 * a `.skip(` pattern reads straight past.
 *
 * `.only` and the `f`-prefixed aliases opt *in*, and belong here for
 * that reason: vitest resolves them per collected file, so one of them
 * inside a shared suite drops every **other** suite the backend's entry
 * file called. That is the same "a contract clause goes unverified while
 * the run stays green" failure as `.skip`, over the whole backend rather
 * than one suite.
 *
 * The modifiers deliberately left out are the ones that keep every case
 * in the run: `.each` / `.for` (parametrization), `.concurrent` /
 * `.sequential` (ordering), `.fails` (inverted expectation), `.extend`
 * (fixtures).
 */
const SELF_SKIPS: readonly RegExp[] = [
  /\.(only|skip|skipIf|runIf|todo)\b/,
  /\b(xit|xdescribe|xtest|fit|fdescribe|ftest)\s*\(/,
];

/**
 * The declarations that make up the surface a backend must supply: the
 * root and the scope-plane bundle `forScope` returns. Read one
 * declaration at a time, because the seed-input types alongside them
 * carry optional properties by design — a whole-file scan could only be
 * satisfied by giving those up.
 */
const BACKEND_DECLARATIONS = ["ConformanceBackend", "ScopedConformancePorts"];

const walk = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const matchesIn = (source: string, pattern: RegExp): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) {
      found.add(name);
    }
  }
  return found;
};

const namesIn = (
  files: readonly string[],
  pattern: RegExp = CALL_SITES,
): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const file of files) {
    for (const name of matchesIn(readFileSync(file, "utf8"), pattern)) {
      found.add(name);
    }
  }
  return found;
};

/**
 * The member list of one `export type X = Readonly<{ … }>;`. Throws when
 * the declaration is not found so that renaming or reshaping one turns
 * the check red instead of quietly making it vacuous.
 */
const membersOf = (source: string, name: string): string => {
  const opening = `export type ${name} = Readonly<{`;
  const start = source.indexOf(opening);
  const end = start < 0 ? -1 : source.indexOf("\n}>;", start);
  if (start < 0 || end < 0) {
    throw new Error(`backend.ts declares no \`${opening}\` … \`}>;\``);
  }
  return source.slice(start + opening.length, end);
};

const sorted = (names: ReadonlySet<string>): readonly string[] =>
  [...names].sort();

const testFiles = walk(ADAPTERS_DIR).filter((path) =>
  path.endsWith(".test.ts"),
);

/**
 * One rule, applied to each backend by name. Two hand-written filters
 * drift into different depths, and an asymmetric pair makes the set
 * comparison below lie in both directions: a call site the narrower rule
 * cannot see reads as a suite the backend never runs, and one only the
 * wider rule sees reads as a suite the other backend is missing.
 */
const backendFiles = (backend: string): readonly string[] =>
  testFiles.filter((path) => path.includes(`${join(backend, "__tests__")}`));

const memoryFiles = backendFiles("memory");
const cloudflareFiles = backendFiles("cloudflare");

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
const PERSISTENCE_SUITES = 43;
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
   * An optional member is the third way to lose a contract silently: a
   * suite that needs one has to skip itself when a backend does not offer
   * it, so a harness that drops it stays green with fewer cases —
   * "identically" (ADR 026) then means whatever each backend chose to
   * answer. Every member is therefore required, and the type system is
   * what holds the harnesses to them; reintroducing an optional one has
   * to be a decision that fails here first.
   */
  it("declares no optional backend member", () => {
    const source = readFileSync(join(CONFORMANCE_DIR, "backend.ts"), "utf8");
    expect(
      Object.fromEntries(
        BACKEND_DECLARATIONS.map((name) => [
          name,
          sorted(matchesIn(membersOf(source, name), OPTIONAL_MEMBERS)),
        ]),
      ),
    ).toEqual({ ConformanceBackend: [], ScopedConformancePorts: [] });
  });

  /**
   * The other half of the same rule, stated at the width it can hold: a
   * suite a persistence backend runs may not take itself, or its
   * siblings, out of that backend's run. A `ctx.skip()` inside such a
   * suite reports green while a contract clause goes unverified on that
   * backend; a `.only` reports green while the other 42 suites of the
   * entry file that called it never run at all. Both are the state the
   * required members above exist to prevent.
   *
   * The exemption is the suite no persistence backend calls — today the
   * `SignInOAuthClient` one, whose exchange half needs an authorization
   * code an adapter holding no credentials cannot mint, and which
   * deliberately registers those cases as skipped with the reason in the
   * suite name. It is derived from the call sites rather than listed by
   * hand, so a file earns it only by being wired to neither backend —
   * which the absolute counts above already make a declared decision.
   */
  it("lets no persistence conformance suite opt out of its backend's run", () => {
    const skipping = walk(CONFORMANCE_DIR).filter((path) => {
      const source = readFileSync(path, "utf8");
      const suites = matchesIn(source, EXPORTS);
      const exempt =
        suites.size > 0 && [...suites].every((name) => !memoryCalls.has(name));
      return !exempt && SELF_SKIPS.some((pattern) => pattern.test(source));
    });
    expect(skipping).toEqual([]);
  });

  it("leaves no suite unwired to a backend", () => {
    expect(exported.size).toBe(ALL_SUITES);
    // `signInOAuthClient` is the one suite no persistence backend calls:
    // it belongs to `adapters/oauth/`, which is why the check spans every
    // adapter's tests rather than the two backends'.
    expect(sorted(namesIn(testFiles))).toEqual(sorted(exported));
  });
});
