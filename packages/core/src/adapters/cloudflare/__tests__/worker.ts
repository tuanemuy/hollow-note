import { ScopeObject } from "../do/scopeObject";

/**
 * Entry point of the test worker declared by `wrangler.test.jsonc`.
 *
 * The Durable Object class has to be exported from the worker's `main`
 * module for the `SCOPE_OBJECT` binding to resolve; the `fetch` handler
 * exists only because a Worker must have one. Tests drive the adapters
 * directly through `env`, never through this handler.
 */
export { ScopeObject };

export default {
  async fetch(): Promise<Response> {
    return new Response("cloudflare adapter test worker", { status: 200 });
  },
};
