import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ScopeKey } from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import { GLOBAL_TABLES } from "../d1/schema";
import { SCOPE_TABLES } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import { statement } from "../sql/statement";

/**
 * Backend-local: proves the harness itself, not a port contract.
 *
 * What it pins down is exactly what the rest of the Cloudflare adapter
 * assumes about the runtime — that the suites run against real bindings
 * rather than a stand-in, that both schemas apply, that FTS5 and
 * `json_each` are available on both planes, and that `nodejs_compat`
 * really provides the two Node modules the adapters import.
 */
describe("cloudflare test harness", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  it("exposes the D1, R2 and Durable Object bindings", () => {
    expect(env.GLOBAL_DB).toBeDefined();
    expect(env.OBJECT_STORAGE).toBeDefined();
    expect(env.SCOPE_OBJECT).toBeDefined();
  });

  it("applies the global schema, including the contentless FTS5 table", async () => {
    const tables = await env.GLOBAL_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name",
    ).all<{ name: string }>();
    const names = new Set(tables.results.map((row) => row.name));
    for (const table of Object.values(GLOBAL_TABLES)) {
      expect(names).toContain(table);
    }
  });

  it("expands a list through json_each rather than one binding per id", async () => {
    const rows = await env.GLOBAL_DB.prepare(
      "SELECT value FROM json_each(?) ORDER BY value",
    )
      .bind(JSON.stringify(["a", "b", "c"]))
      .all<{ value: string }>();
    expect(rows.results.map((row) => row.value)).toEqual(["a", "b", "c"]);
  });

  it("creates the scope schema on first contact with an object", async () => {
    const scope = ScopeKey.user("user-harness" as UserId);
    const executor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      "harness",
    );
    const rows = await executor.query(
      statement(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ),
    );
    const names = new Set(rows.map((row) => row.name));
    for (const table of Object.values(SCOPE_TABLES)) {
      expect(names).toContain(table);
    }
  });

  it("refuses a scope object addressed as a scope it is not bound to", async () => {
    const scope = ScopeKey.user("user-bound" as UserId);
    const executor = createScopeStubExecutor(
      env.SCOPE_OBJECT,
      scope,
      "harness",
    );
    await executor.query(statement("SELECT 1 AS ok"));

    const stub = env.SCOPE_OBJECT.get(
      env.SCOPE_OBJECT.idFromName("harness/user:user-bound"),
    );
    let thrown: unknown;
    try {
      await stub.query(
        "workspace:workspace-elsewhere",
        statement("SELECT 1 AS ok"),
      );
    } catch (cause) {
      thrown = cause;
    }
    expect(String(thrown)).toMatch(/bound to/);
  });

  it("provides the Node built-ins the adapters rely on", async () => {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const storage = new AsyncLocalStorage<string>();
    expect(storage.run("open", () => storage.getStore())).toBe("open");
    expect(crypto.subtle).toBeDefined();
  });
});
