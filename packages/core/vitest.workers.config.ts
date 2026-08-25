import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const here = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

/**
 * Cloudflare adapter project: the shared port-conformance suites and the
 * backend-local integration tests run inside workerd against the real
 * bindings declared in `wrangler.test.jsonc` (D1, a SQLite-backed
 * Durable Object namespace, and R2). Nothing here is mocked — that is
 * the point of running in this pool rather than the `node` one.
 *
 * Global D1 migrations are read on the Node side and handed to the test
 * worker as the `MIGRATIONS` binding, so a test file applies them with
 * `applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS)`. The Durable Object
 * carries its own schema in its bundle instead (`do/schema.ts`) because
 * nothing outside the object can run DDL against its storage.
 *
 * Storage isolation in this pool is **per test file**, not per test, so
 * the conformance factory namespaces each backend it hands out. See
 * `__tests__/` for the factory.
 */
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: here("./wrangler.test.jsonc") },
      miniflare: {
        bindings: {
          MIGRATIONS: await readD1Migrations(
            here("./src/adapters/cloudflare/d1/migrations"),
          ),
        },
      },
    }),
  ],
  test: {
    name: "workers",
    globals: true,
    include: ["src/adapters/cloudflare/**/__tests__/**/*.test.ts"],
    testTimeout: 30_000,
  },
}));
