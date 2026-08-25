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
