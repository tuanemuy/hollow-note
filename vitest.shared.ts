import { configDefaults } from "vitest/config";

/**
 * The one boundary between the two vitest projects, so that neither can
 * be widened without the other narrowing.
 *
 * `node` excludes this directory wholesale; `workers` includes every test
 * file inside it. Spelled once because the two configs live in different
 * roots: a second spelling that drifted would open a window where a test
 * file belongs to neither project and `pnpm test` stays green without
 * running it.
 */
export const CLOUDFLARE_ADAPTER_DIR = "src/adapters/cloudflare";

/** Path of that directory relative to the repository root. */
export const CLOUDFLARE_ADAPTER_DIR_FROM_ROOT = `packages/core/${CLOUDFLARE_ADAPTER_DIR}`;

/**
 * Test-file patterns confined to one directory.
 *
 * Derived from vitest's own defaults, which is what the `node` project
 * matches everywhere else: the directory exclude above is extension-blind,
 * so an include that recognised fewer extensions would drop a
 * `.test.tsx` / `.test.mts` file out of both projects.
 */
export const testFilesIn = (directory: string): string[] =>
  configDefaults.include.map((pattern) => `${directory}/${pattern}`);
