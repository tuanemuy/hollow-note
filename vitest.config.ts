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
    // Password paths derive scrypt keys at production cost (N=16384). A single
    // change-password case chains up to seven derivations, which overruns the
    // 5s default once the files run in parallel on a loaded machine.
    testTimeout: 30_000,
  },
});
