import type { D1Migration } from "cloudflare:test";
import type { ScopeObject } from "../do/scopeObject";

/**
 * Bindings of the test worker (`../../../../wrangler.test.jsonc`), plus
 * the migration list the Node-side config injects so a test file can
 * apply the global schema with `applyD1Migrations`.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      GLOBAL_DB: D1Database;
      OBJECT_STORAGE: R2Bucket;
      SCOPE_OBJECT: DurableObjectNamespace<ScopeObject>;
      MIGRATIONS: D1Migration[];
    }
  }
}
