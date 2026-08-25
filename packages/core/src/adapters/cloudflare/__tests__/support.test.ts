import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  makePendingUser,
  noteId,
  scopeOf,
  userId,
} from "../../conformance/fixtures";
import { decodeOpaqueCursor, encodeOpaqueCursor } from "../cursor";
import { GLOBAL_TABLES } from "../d1/schema";
import { createD1Executor } from "../sql/executor";
import {
  assertBindable,
  deleteRowsFromJson,
  inJsonList,
  insertRowsFromJson,
  jsonList,
} from "../sql/json";
import { statement } from "../sql/statement";
import { makeCloudflareConformanceBackend } from "./conformanceBackend";

/**
 * The shared primitives every Cloudflare repository builds on: list
 * binding through `json_each`, the binding-count guard, and the opaque
 * keyset cursor. Proven against the real driver, because the rule they
 * enforce — 100 bound parameters — is the driver's.
 */
describe("cloudflare adapter primitives", () => {
  const executor = createD1Executor(env.GLOBAL_DB);

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  it("inserts, reads and deletes a list well past the binding limit in one statement each", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `event-${i}`);
    await executor.apply([
      statement(
        insertRowsFromJson({
          table: GLOBAL_TABLES.processedEvents,
          columns: ["consumer", "event_id", "processed_at"],
          conflictKey: ["consumer", "event_id"],
          conflict: "ignore",
        }),
        JSON.stringify(
          ids.map((id) => ({
            consumer: "json-each",
            event_id: id,
            processed_at: 0,
          })),
        ),
      ),
    ]);

    const found = await executor.query(
      statement(
        `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.processedEvents}
          WHERE consumer = 'json-each' AND ${inJsonList("event_id")}`,
        jsonList(ids),
      ),
    );
    expect(found[0]?.n).toBe(250);

    await executor.apply([
      statement(
        deleteRowsFromJson(GLOBAL_TABLES.processedEvents, "event_id"),
        jsonList(ids),
      ),
    ]);
    const left = await executor.query(
      statement(
        `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.processedEvents} WHERE consumer = 'json-each'`,
      ),
    );
    expect(left[0]?.n).toBe(0);
  });

  it("refuses a statement that would exceed the driver's binding limit", () => {
    const params = Array.from({ length: 101 }, (_, i) => `p-${i}`);
    // Anchored: the guard names the count and stops there. A fault the
    // adapter raises about its own statement has no driver cause, and the
    // message must not read as though it lost one.
    expect(() => assertBindable(statement("SELECT 1", ...params))).toThrowError(
      /^Statement binds 101 parameters, above the 100 limit; expand lists with json_each instead$/,
    );
  });

  it("round-trips a cursor and rejects one from a different query", () => {
    const cursor = encodeOpaqueCursor({
      fp: "notes:updatedDesc",
      after: "n-9",
    });
    expect(decodeOpaqueCursor(cursor, "notes:updatedDesc")).toEqual({
      fp: "notes:updatedDesc",
      after: "n-9",
    });
    expect(() => decodeOpaqueCursor(cursor, "notes:titleAsc")).toThrowError(
      /pagination/i,
    );
    expect(() =>
      decodeOpaqueCursor("not-a-cursor", "notes:titleAsc"),
    ).toThrow();
  });
});

/**
 * The two ports whose input caps sit above the driver's 100-binding
 * limit. The shared suites already run them at their cap, but with a
 * single stored row — which proves the statement is accepted, not that
 * the `json_each` expansion carries every id through. These fill the
 * batch so a truncated expansion has somewhere to show.
 */
describe("cloudflare resolveMany at its input cap", () => {
  const HOUR_MS = 60 * 60 * 1000;

  it("resolves all 500 note routes in one statement", async () => {
    const backend = await makeCloudflareConformanceBackend();
    const store = backend.noteRouteStore;
    const ids = Array.from({ length: 500 }, (_, i) => noteId(i + 1));

    for (let i = 0; i < ids.length; i += 50) {
      await Promise.all(
        ids.slice(i, i + 50).map(async (id, offset) => {
          const operationId = `op-${i + offset + 1}`;
          await store.reserveCreate({
            noteId: id,
            scope: scopeOf(1),
            createdBy: userId(1),
            operationId,
            expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
          });
          await store.activateCreate({ noteId: id, operationId });
        }),
      );
    }

    const resolved = await store.resolveMany(ids);
    expect(resolved.size).toBe(500);
    expect(resolved.get(noteId(500))?.state).toBe("active");
  });

  it("resolves all 100 users in one statement", async () => {
    const backend = await makeCloudflareConformanceBackend();
    const now = backend.clock.now();
    const ids = Array.from({ length: 100 }, (_, i) => userId(i + 1));
    for (let n = 1; n <= 100; n += 1) {
      await backend.userRepository.insert(makePendingUser(n, now));
    }

    const resolved = await backend.userBatchReader.resolveMany(ids);
    expect(resolved.size).toBe(100);
    expect(resolved.get(userId(100))?.entity.id).toBe(userId(100));
  });
});
