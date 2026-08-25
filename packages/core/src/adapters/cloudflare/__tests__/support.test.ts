import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
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
    expect(() => assertBindable(statement("SELECT 1", ...params))).toThrowError(
      /json_each/,
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
