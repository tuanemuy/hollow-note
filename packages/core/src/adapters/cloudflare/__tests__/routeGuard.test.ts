import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, SystemError } from "../../../application/errors";
import { ScopeKey } from "../../../application/scope";
import { type DomainEvent, EventId } from "../../../domain/common/event";
import type { UserId } from "../../../domain/identity/valueObject";
import { NoteId } from "../../../domain/note/valueObject";
import { createTestClock } from "../../conformance/testClock";
import { createD1NoteRouteStore } from "../d1/repositories/noteRouteStore";
import { createD1OutboxRepository } from "../d1/repositories/outboxRepository";
import { GLOBAL_TABLES, GLOBAL_WIPE_STATEMENTS } from "../d1/schema";
import type { RowMutation } from "../execution/writeSet";
import { WriteSet } from "../execution/writeSet";
import { createD1Executor } from "../sql/executor";
import {
  createAutocommitSession,
  createStagedSession,
  type SqlSession,
} from "../sql/session";

/**
 * The routing bundle's concurrency backstop, against the real D1.
 *
 * The conformance suites call `NoteRouteStore` sequentially, so every
 * transition is settled by the branch that reads the row and the
 * `_occ_guard` staged ahead of the write never fires. What that guard
 * costs when it does fire — and whether the driver error it raises
 * reaches the caller as the port's `ConflictError` rather than a raw
 * `CHECK constraint failed` — is therefore only observable here, by
 * holding one transition between its read and its write while another
 * moves the same row.
 *
 * The outbox cases are the same shape of backend-specific property: what
 * the repository refuses before it reaches the driver.
 */

const OWNER = "user-route-guard" as UserId;
const SCOPE = ScopeKey.user(OWNER);
const TARGET = ScopeKey.user("user-route-target" as UserId);
const NOTE = NoteId.create("note-route-guard");

/**
 * A session whose writes wait on `gate`, announcing through `reached`
 * that the caller has finished reading and is about to write. That is
 * the window a second writer has to move the row.
 */
const gatedWrites = (
  session: SqlSession,
  reached: () => void,
  gate: Promise<void>,
): SqlSession => ({
  ...session,
  async write(mutations: readonly RowMutation[]): Promise<void> {
    reached();
    await gate;
    await session.write(mutations);
  },
});

describe("cloudflare note_routes under a concurrent transition", () => {
  const clock = createTestClock();
  const executor = createD1Executor(env.GLOBAL_DB);
  const session = createAutocommitSession(executor);

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  beforeEach(async () => {
    await env.GLOBAL_DB.batch(
      GLOBAL_WIPE_STATEMENTS.map((sql) => env.GLOBAL_DB.prepare(sql)),
    );
  });

  const storedState = async (): Promise<string | undefined> => {
    const row = await env.GLOBAL_DB.prepare(
      `SELECT state FROM ${GLOBAL_TABLES.noteRoutes} WHERE note_id = ?`,
    )
      .bind(NOTE)
      .first<{ state: string }>();
    return row?.state;
  };

  const activeRoute = async (): Promise<void> => {
    const store = createD1NoteRouteStore({ session, clock });
    await store.reserveCreate({
      noteId: NOTE,
      scope: SCOPE,
      createdBy: OWNER,
      operationId: "op-create",
      expiresAt: new Date(clock.now().getTime() + 60_000),
    });
    await store.activateCreate({ noteId: NOTE, operationId: "op-create" });
  };

  it("rejects the transition whose row moved between its read and its write", async () => {
    await activeRoute();

    let reached = (): void => {};
    const readDone = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = createD1NoteRouteStore({
      session: gatedWrites(session, () => reached(), gate),
      clock,
    });

    const contested = slow.beginMove({
      noteId: NOTE,
      expectedRouteVersion: 1,
      target: TARGET,
      migrationId: "mig-1",
    });
    await readDone;

    // The winner takes the row through a transition the loser's guard no
    // longer matches: same version, different state and operation.
    await createD1NoteRouteStore({ session, clock }).beginPurge({
      noteId: NOTE,
      scope: SCOPE,
      expectedRouteVersion: 1,
      operationId: "op-purge",
    });
    release();

    const error = await contested.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe("OPTIMISTIC_LOCK_FAILURE");

    // The point of the guard: the loser's whole-row write did not land.
    expect(await storedState()).toBe("purging");
  });

  it("rejects a delete whose row moved between its read and its write", async () => {
    const store = createD1NoteRouteStore({ session, clock });
    await store.reserveCreate({
      noteId: NOTE,
      scope: SCOPE,
      createdBy: OWNER,
      operationId: "op-create",
      expiresAt: new Date(clock.now().getTime() + 60_000),
    });

    let reached = (): void => {};
    const readDone = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = createD1NoteRouteStore({
      session: gatedWrites(session, () => reached(), gate),
      clock,
    });

    const contested = slow.abandonCreate({
      noteId: NOTE,
      operationId: "op-create",
    });
    await readDone;
    await store.activateCreate({ noteId: NOTE, operationId: "op-create" });
    release();

    const error = await contested.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe("OPTIMISTIC_LOCK_FAILURE");
    expect(await storedState()).toBe("active");
  });
});

describe("cloudflare outbox refusals", () => {
  const clock = createTestClock();
  const executor = createD1Executor(env.GLOBAL_DB);

  const event = (
    id: string,
    payload: Record<string, unknown>,
  ): DomainEvent => ({
    id: EventId.create(id),
    type: "test.happened",
    payload,
    occurredAt: clock.now(),
    aggregateId: "note-001",
  });

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  beforeEach(async () => {
    await env.GLOBAL_DB.batch(
      GLOBAL_WIPE_STATEMENTS.map((sql) => env.GLOBAL_DB.prepare(sql)),
    );
  });

  const stagedOutbox = () =>
    createD1OutboxRepository({
      session: createStagedSession(executor, new WriteSet()),
      clock,
    });

  it("refuses the relay's claim and prune inside a unit of work", async () => {
    const outbox = stagedOutbox();

    await expect(
      outbox.claimPending({
        now: clock.now(),
        limit: 10,
        leaseMs: 60_000,
        workerId: "relay",
      }),
    ).rejects.toBeInstanceOf(SystemError);
    await expect(outbox.pruneProcessed(clock.now())).rejects.toBeInstanceOf(
      SystemError,
    );

    // Neither ran: a staged session would have applied them immediately,
    // outside the unit that could still roll back.
    const stored = await env.GLOBAL_DB.prepare(
      `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.outboxEvents}`,
    ).first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it("refuses a batch too large for one bound value instead of letting the driver truncate it", async () => {
    const outbox = createD1OutboxRepository({
      session: createAutocommitSession(executor),
      clock,
    });

    await expect(
      outbox.save([event("event-huge", { blob: "x".repeat(1_100_000) })]),
    ).rejects.toBeInstanceOf(SystemError);

    const stored = await env.GLOBAL_DB.prepare(
      `SELECT COUNT(*) AS n FROM ${GLOBAL_TABLES.outboxEvents}`,
    ).first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });
});
