import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GlobalUnitOfWorkContext } from "../../../application/execution/unitOfWork";
import { EventId } from "../../../domain/common/event";
import { GLOBAL_TABLES } from "../d1/schema";
import { SCHEDULED_TASKS_TABLE } from "../do/schema";
import { createGlobalUnitOfWorkProvider } from "../execution/globalUnitOfWork";
import { opaque, remove, upsert, WriteSet } from "../execution/writeSet";
import { createD1Executor } from "../sql/executor";
import { occGuard } from "../sql/occGuard";
import {
  ALL_ROWS,
  createAutocommitSession,
  createStagedSession,
  type SqlSession,
} from "../sql/session";
import { MAX_STATEMENTS_PER_COMMIT, statement } from "../sql/statement";

/**
 * The guards the write-set mechanism puts around its own weak spots: the
 * set read whose overlay cannot repair a `LIMIT`, the `opaque` statement
 * whose table has commit-time bookkeeping behind it, and the atomic write
 * that would spend more of the D1 invocation budget than one may.
 */

const clock = new Date("2026-08-26T00:00:00.000Z");

const insertUser = (id: string) =>
  statement(
    `INSERT INTO ${GLOBAL_TABLES.users}
       (id, status, auth_epoch, version, created_at, updated_at)
     VALUES (?, 'pending', 0, 0, ?, ?)`,
    id,
    clock.getTime(),
    clock.getTime(),
  );

describe("staged set reads", () => {
  const executor = createD1Executor(env.GLOBAL_DB);

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  beforeEach(async () => {
    await env.GLOBAL_DB.prepare(`DELETE FROM ${GLOBAL_TABLES.users}`).run();
    await executor.apply(["u-1", "u-2", "u-3"].map(insertUser));
  });

  const pageOf = (session: SqlSession, limit: number) =>
    session.readRows({
      table: GLOBAL_TABLES.users,
      statement: statement(
        `SELECT * FROM ${GLOBAL_TABLES.users} ORDER BY id LIMIT ${limit}`,
      ),
      keyOf: (row) => String(row.id),
      matches: ALL_ROWS,
      compare: (a, b) => String(a.id).localeCompare(String(b.id)),
      limit,
    });

  const removeUser = (id: string) =>
    remove({
      table: GLOBAL_TABLES.users,
      key: id,
      statement: statement(
        `DELETE FROM ${GLOBAL_TABLES.users} WHERE id = ?`,
        id,
      ),
    });

  const pendingPageOf = (session: SqlSession, limit: number) =>
    session.readRows({
      table: GLOBAL_TABLES.users,
      statement: statement(
        `SELECT * FROM ${GLOBAL_TABLES.users}
          WHERE status = 'pending' ORDER BY id LIMIT ${limit}`,
      ),
      keyOf: (row) => String(row.id),
      matches: (row) => row.status === "pending",
      compare: (a, b) => String(a.id).localeCompare(String(b.id)),
      limit,
    });

  const activateUser = (id: string) =>
    upsert({
      table: GLOBAL_TABLES.users,
      key: id,
      row: { id, status: "active" },
      statement: statement(
        `UPDATE ${GLOBAL_TABLES.users} SET status = 'active' WHERE id = ?`,
        id,
      ),
    });

  const epochPageOf = (session: SqlSession, limit: number) =>
    session.readRows({
      table: GLOBAL_TABLES.users,
      statement: statement(
        `SELECT * FROM ${GLOBAL_TABLES.users}
          ORDER BY auth_epoch, id LIMIT ${limit}`,
      ),
      keyOf: (row) => String(row.id),
      matches: ALL_ROWS,
      compare: (a, b) =>
        Number(a.auth_epoch) - Number(b.auth_epoch) ||
        String(a.id).localeCompare(String(b.id)),
      limit,
    });

  const bumpEpoch = (id: string, epoch: number) =>
    upsert({
      table: GLOBAL_TABLES.users,
      key: id,
      row: { id, status: "pending", auth_epoch: epoch },
      statement: statement(
        `UPDATE ${GLOBAL_TABLES.users} SET auth_epoch = ? WHERE id = ?`,
        epoch,
        id,
      ),
    });

  it("refuses a full page that a staged delete has punched a hole in", async () => {
    const writeSet = new WriteSet();
    const session = createStagedSession(executor, writeSet);
    await session.write([removeUser("u-1")]);

    // Storage holds three rows and the statement asked for two, so the
    // row that should fill the gap is one this session cannot reach.
    await expect(pageOf(session, 2)).rejects.toThrow(
      /combines LIMIT 2 with a row this unit of work deleted/,
    );
  });

  it("refuses a full page a staged update moved out of the predicate", async () => {
    const writeSet = new WriteSet();
    const session = createStagedSession(executor, writeSet);
    await session.write([activateUser("u-1")]);

    // The row is still stored, but it no longer answers the predicate, so
    // the page loses it and the row that should fill the gap is the one
    // the statement left behind in storage.
    await expect(pendingPageOf(session, 2)).rejects.toThrow(
      /combines LIMIT 2 with a row this unit of work updated out of the predicate/,
    );
  });

  it("refuses a full ordered page the staged update can push past its edge", async () => {
    const writeSet = new WriteSet();
    const session = createStagedSession(executor, writeSet);
    await session.write([bumpEpoch("u-1", 9)]);

    // Storage orders u-1, u-2, u-3 at epoch 0; the staged epoch sends u-1
    // behind u-3, so the true page is u-2, u-3 and the overlay holds no
    // u-3 to put there.
    await expect(epochPageOf(session, 2)).rejects.toThrow(
      /combines LIMIT 2 with a row this unit of work updated in a way the ORDER BY may move past the page boundary/,
    );
  });

  it("serves a full ordered page whose staged row the statement never returned", async () => {
    const writeSet = new WriteSet();
    const session = createStagedSession(executor, writeSet);
    await session.write([
      upsert({
        table: GLOBAL_TABLES.users,
        key: "u-0",
        row: { id: "u-0", status: "pending", auth_epoch: 0 },
        statement: insertUser("u-0"),
      }),
    ]);

    const rows = await epochPageOf(session, 2);
    expect(rows.map((row) => row.id)).toEqual(["u-0", "u-1"]);
  });

  it("still serves a page the statement did not fill", async () => {
    const writeSet = new WriteSet();
    const session = createStagedSession(executor, writeSet);
    await session.write([removeUser("u-1")]);

    const rows = await pageOf(session, 10);
    expect(rows.map((row) => row.id)).toEqual(["u-2", "u-3"]);
  });
});

describe("write-set bookkeeping", () => {
  it("counts an opaque write against its table only when it names one", () => {
    const writeSet = new WriteSet();
    writeSet.stage([
      opaque(occGuard(statement(`SELECT 1 FROM ${SCHEDULED_TASKS_TABLE}`))),
    ]);
    expect(writeSet.touchedTables()).toEqual([]);

    writeSet.stage([
      opaque({
        table: SCHEDULED_TASKS_TABLE,
        statement: statement(
          `DELETE FROM ${SCHEDULED_TASKS_TABLE} WHERE status = 'failed'`,
        ),
      }),
    ]);
    expect(writeSet.touchedTables()).toEqual([SCHEDULED_TASKS_TABLE]);
  });
});

describe("global commit budget", () => {
  const executor = createD1Executor(env.GLOBAL_DB);

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  const repositories = (session: SqlSession) =>
    ({
      filler: {
        stage(count: number): Promise<void> {
          return session.write(
            Array.from({ length: count }, () => opaque(statement("SELECT 1"))),
          );
        },
      },
    }) as unknown as Omit<GlobalUnitOfWorkContext, "collectEvents">;

  const provider = createGlobalUnitOfWorkProvider({
    executor,
    mintEventId: () => EventId.create("event-1"),
    buildRepositories: repositories,
    stageOutbox: async () => {},
  });

  const stage = (count: number): Promise<void> =>
    provider.run(async (ctx) => {
      await (
        ctx as unknown as { filler: { stage(n: number): Promise<void> } }
      ).filler.stage(count);
    });

  it("commits a write-set at the cap", async () => {
    await expect(stage(MAX_STATEMENTS_PER_COMMIT)).resolves.toBeUndefined();
  });

  it("refuses a write-set one statement past the cap", async () => {
    await expect(stage(MAX_STATEMENTS_PER_COMMIT + 1)).rejects.toThrow(
      new RegExp(`above the ${MAX_STATEMENTS_PER_COMMIT}`),
    );
  });

  it("holds an autocommit write to the same cap", async () => {
    const session = createAutocommitSession(executor);
    const fill = (count: number): Promise<void> =>
      session.write(
        Array.from({ length: count }, () => opaque(statement("SELECT 1"))),
      );

    await expect(fill(MAX_STATEMENTS_PER_COMMIT)).resolves.toBeUndefined();
    await expect(fill(MAX_STATEMENTS_PER_COMMIT + 1)).rejects.toThrow(
      new RegExp(`above the ${MAX_STATEMENTS_PER_COMMIT}`),
    );
  });
});
