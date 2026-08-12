import { defineConfig } from "vitest/config";

// Node-pool config for the whole test suite: domain logic, usecases over
// the in-memory adapters, and the shared port-conformance suites, which run
// at unit speed against the memory backend. A future real-backend adapter
// (D1/DO) brings its own integration config and imports the same suites.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/.direnv/**", "spec/**"],
    // scrypt(N=16384) at production cost makes the password cases the slowest
    // in the suite (~300ms against single-digit ms elsewhere), and on a loaded
    // machine running files in parallel they have overrun the 5s default.
    testTimeout: 10_000,
  },
});
