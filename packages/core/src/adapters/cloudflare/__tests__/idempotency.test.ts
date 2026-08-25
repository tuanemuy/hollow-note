import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ScopeKey } from "../../../application/scope";
import type { DomainEvent } from "../../../domain/common/event";
import { EventId } from "../../../domain/common/event";
import type { UserId } from "../../../domain/identity/valueObject";
import { createTestClock } from "../../conformance/testClock";
import { createD1IdempotencyStore } from "../d1/repositories/idempotencyStore";
import { createD1OutboxRepository } from "../d1/repositories/outboxRepository";
import { GLOBAL_TABLES } from "../d1/schema";
import { createCloudflareAppliedOperationStore } from "../do/repositories/appliedOperationStore";
import { SCOPE_TABLES } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import { createD1Executor } from "../sql/executor";
import { createAutocommitSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * AC-4, the idempotency half: a caller that never learned whether its
 * write landed and simply runs the same operation again.
 *
 * Three tables carry that guarantee and each does it differently —
 * `applied_operations` by a primary key the second insert loses,
 * `processed_events` by an insert that reports whether it was the writer,
 * and `outbox_events` by folding a re-derived id onto the row already
 * there (ADR 042). All three are observed through the adapters against
 * the real drivers, replaying the call rather than simulating a retry.
 */

const NAMESPACE = "idempotency";
const SCOPE = ScopeKey.user("user-idempotent" as UserId);

const event = (id: string, payload: Record<string, unknown>): DomainEvent => ({
  id: EventId.create(id),
  type: "test.happened",
  payload,
  occurredAt: new Date("2026-08-26T00:00:00.000Z"),
  aggregateId: "note-001",
});

describe("cloudflare replay of an operation whose response was lost", () => {
  const clock = createTestClock();
  const executor = createD1Executor(env.GLOBAL_DB);
  const globalSession = createAutocommitSession(executor);

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  beforeEach(async () => {
    await env.GLOBAL_DB.batch([
      env.GLOBAL_DB.prepare(`DELETE FROM ${GLOBAL_TABLES.outboxEvents}`),
      env.GLOBAL_DB.prepare(`DELETE FROM ${GLOBAL_TABLES.processedEvents}`),
    ]);
  });

  it("tells only the first caller of an applied operation that it was first", async () => {
    const scopeSession = createAutocommitSession(
      createScopeStubExecutor(env.SCOPE_OBJECT, SCOPE, `${NAMESPACE}-applied`),
    );
    const store = createCloudflareAppliedOperationStore({
      session: scopeSession,
      clock,
    });
    const command = { operationId: "op-1", commandKey: "createNote" };

    expect(await store.markApplied(command)).toBe(true);
    expect(await store.markApplied(command)).toBe(false);
    expect(await store.markApplied(command)).toBe(false);

    // A different command of the same operation is a different receipt:
    // the two are folded into one key column by digest, not truncated
    // onto each other.
    expect(
      await store.markApplied({
        operationId: "op-1",
        commandKey: "attachFile",
      }),
    ).toBe(true);

    const rows = await scopeSession.query(
      statement(
        `SELECT COUNT(*) AS n FROM ${SCOPE_TABLES.appliedOperations} WHERE kind = 'command'`,
      ),
    );
    expect(rows[0]?.n).toBe(2);
  });

  it("marks an event processed once however often the consumer replays", async () => {
    const store = createD1IdempotencyStore({ session: globalSession, clock });
    const eventId = EventId.create("event-1");

    expect(await store.markProcessed("projection", eventId)).toBe(true);
    expect(await store.markProcessed("projection", eventId)).toBe(false);
    // A second consumer of the same event is unaffected.
    expect(await store.markProcessed("search", eventId)).toBe(true);

    const rows = await env.GLOBAL_DB.prepare(
      `SELECT consumer FROM ${GLOBAL_TABLES.processedEvents} ORDER BY consumer`,
    ).all<{ consumer: string }>();
    expect(rows.results.map((row) => row.consumer)).toEqual([
      "projection",
      "search",
    ]);
  });

  it("folds a re-saved outbox id onto the stored row instead of replacing it", async () => {
    const outbox = createD1OutboxRepository({ session: globalSession, clock });
    await outbox.save([event("event-1", { turn: 1 })]);

    // The replayed turn re-derives the same deterministic id (ADR 041).
    // Putting the new body on the wire would re-run the tail of a chain
    // that has already moved on, so the stored row wins (ADR 042).
    await outbox.save([
      event("event-1", { turn: 2 }),
      event("event-2", { turn: 2 }),
    ]);

    const rows = await env.GLOBAL_DB.prepare(
      `SELECT id, payload FROM ${GLOBAL_TABLES.outboxEvents} ORDER BY id`,
    ).all<{ id: string; payload: string }>();
    expect(rows.results).toEqual([
      { id: "event-1", payload: JSON.stringify({ turn: 1 }) },
      { id: "event-2", payload: JSON.stringify({ turn: 2 }) },
    ]);
  });

  it("hands a claimed outbox row to exactly one of two racing relays", async () => {
    const outbox = createD1OutboxRepository({ session: globalSession, clock });
    await outbox.save([event("event-1", {}), event("event-2", {})]);

    const now = clock.now();
    const [left, right] = await Promise.all([
      outbox.claimPending({ now, limit: 10, leaseMs: 60_000, workerId: "a" }),
      outbox.claimPending({ now, limit: 10, leaseMs: 60_000, workerId: "b" }),
    ]);

    const claimed = [...left, ...right].map((entry) => entry.id).sort();
    expect(claimed).toEqual(["event-1", "event-2"]);
  });
});
