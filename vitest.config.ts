import { defineConfig } from "vitest/config";
import { CLOUDFLARE_ADAPTER_DIR_FROM_ROOT } from "./vitest.shared";

/**
 * Two projects, one run. `node` keeps the whole existing suite — domain
 * logic, usecases over the in-memory adapters, and the shared
 * port-conformance suites at unit speed. `workers` runs the Cloudflare
 * adapters against real D1 / Durable Object / R2 bindings inside
 * workerd, and owns its own config next to the package that declares
 * `@cloudflare/vitest-plugin` and `wrangler`.
 *
 * The two projects partition the tree at `vitest.shared.ts`: everything
 * under `adapters/cloudflare/` belongs to `workers` and is excluded here,
 * so `pnpm test` is their union with nothing left over.
 * `--project node` / `--project workers` runs one of them alone.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          name: "node",
          globals: true,
          environment: "node",
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.direnv/**",
            "spec/**",
            `${CLOUDFLARE_ADAPTER_DIR_FROM_ROOT}/**`,
          ],
          // Pinned to a non-UTC zone on purpose: UTC-only assertions
          // (BillingPeriod's UTC calendar month) are indistinguishable from
          // local-time implementations when the runner itself is UTC, which
          // CI is. The workers pool cannot set `TZ` at all, which is why
          // zone-sensitive tests stay in this project.
          env: { TZ: "Asia/Tokyo" },
          // scrypt(N=16384) at production cost makes the password cases the
          // slowest in the suite (~300ms against single-digit ms elsewhere),
          // and on a loaded machine running files in parallel they can
          // overrun the 5s default.
          testTimeout: 10_000,
        },
      },
      "./packages/core/vitest.workers.config.ts",
    ],
  },
});
