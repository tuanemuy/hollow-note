import { defineConfig } from "vitest/config";

// Node-pool config for the whole test suite: domain logic, usecases over
// the in-memory adapters, and the shared port-conformance suites (which
// run at unit speed against the memory backend — ADR-002/003 of Issue #1).
// A future real-backend adapter (D1/DO) brings its own integration config
// and imports the same conformance suites.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.direnv/**",
      "**/*.integration.test.ts",
      "spec/**",
    ],
  },
});
