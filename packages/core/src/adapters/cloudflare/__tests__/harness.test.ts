import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ScopeKey } from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import {
  ByteSize,
  MimeType,
  ObjectKey,
} from "../../../domain/storage/valueObject";
import {
  makeBlankNote,
  makePendingUser,
  noteId,
  scopeOf,
  userId,
} from "../../conformance/fixtures";
import { GLOBAL_TABLES, GLOBAL_TABLES_TO_WIPE } from "../d1/schema";
import { SCOPE_TABLES } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import { statement } from "../sql/statement";
import { makeCloudflareConformanceBackend } from "./conformanceBackend";

/**
 * Backend-local: proves the harness itself, not a port contract.
 *
 * What it pins down is exactly what the rest of the Cloudflare adapter
 * assumes about the runtime — that the suites run against real bindings
 * rather than a stand-in, that both schemas apply, that FTS5 and
 * `json_each` are available on both planes, and that `nodejs_compat`
 * really provides the two Node modules the adapters import.
 */
const globalTableNames = async (): Promise<readonly string[]> => {
  const tables = await env.GLOBAL_DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all<{ name: string }>();
  return tables.results.map((row) => row.name);
};

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
    const names = new Set(await globalTableNames());
    for (const table of Object.values(GLOBAL_TABLES)) {
      expect(names).toContain(table);
    }
  });

  /**
   * The other direction: a migration that adds a table the adapter never
   * names would leave rows behind between conformance backends, and the
   * symptom is an incidental red that depends on test order.
   */
  it("leaves no migrated table out of the wipe", async () => {
    const migrated = (await globalTableNames()).filter(
      (name) =>
        name !== "d1_migrations" &&
        !name.startsWith("sqlite_") &&
        !name.startsWith("_cf_") &&
        !name.startsWith(GLOBAL_TABLES.publicNoteSearchFts),
    );
    expect(new Set(migrated)).toEqual(new Set(GLOBAL_TABLES_TO_WIPE));
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

  /**
   * The suites skip the cases an optional backend member feeds rather
   * than failing them, so a harness that stopped offering one would take
   * three contract cases out of the run and stay green. This backend can
   * seed membership edges — the D1 directory table is right there — so
   * the run has to keep spending them.
   */
  it("offers the optional membership-edge seed the suites need", async () => {
    const backend = await makeCloudflareConformanceBackend();
    expect(backend.seedMembershipEdges).toBeDefined();
  });

  /**
   * The suites contract for a fresh backend per test while this pool
   * isolates storage per *file*, so two backends built here — as two
   * suites in one bundle would be — must not see each other on any of the
   * three planes.
   */
  it("hands out backends that cannot see one another on any plane", async () => {
    const first = await makeCloudflareConformanceBackend();
    const now = first.clock.now();
    const scope = scopeOf(1);
    const key = ObjectKey.create("users/user-1/avatar/file-1.png");
    const bytes = new Uint8Array([1, 2, 3]);

    await first.userRepository.insert(makePendingUser(1, now));
    await first
      .forScope(scope)
      .noteRepository.insert(makeBlankNote(1, userId(1), now));
    await first.objectStorage.put(key, bytes, {
      mimeType: MimeType.create("image/png"),
      size: ByteSize.create(bytes.byteLength),
      checksum: null,
    });

    const second = await makeCloudflareConformanceBackend();
    expect(await second.userRepository.findById(userId(1))).toBeNull();
    expect(
      await second.forScope(scope).noteRepository.findById(noteId(1)),
    ).toBeNull();
    expect(await second.objectStorage.get(key)).toBeNull();

    // The scope object and the bucket are namespaced rather than wiped,
    // so the first backend still holds what it wrote; only D1 is shared
    // and emptied.
    expect(
      await first.forScope(scope).noteRepository.findById(noteId(1)),
    ).not.toBeNull();
    expect(await first.objectStorage.get(key)).not.toBeNull();
  });
});
