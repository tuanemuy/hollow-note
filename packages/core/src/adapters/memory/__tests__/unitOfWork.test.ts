import { describe, expect, it } from "vitest";
import { User } from "../../../domain/identity/user";
import {
  makeBlankNote,
  makePendingUser,
  noteId,
  scopeOf,
  userId,
} from "../../conformance/fixtures";
import { createTestClock } from "../../conformance/testClock";
import { createMemoryGlobalUnitOfWorkProvider } from "../globalUnitOfWork";
import { createMemoryNoteRepository } from "../repositories/noteRepository";
import { createMemoryOutboxRepository } from "../repositories/outboxRepository";
import { createMemoryUserRepository } from "../repositories/userRepository";
import { createMemoryScopeUnitOfWorkProvider } from "../scopeUnitOfWork";
import { MemoryBackend } from "../store";

const setup = () => {
  const clock = createTestClock();
  const backend = new MemoryBackend({ clock });
  const kicks: number[] = [];
  const relayTrigger = { kick: () => kicks.push(1) };
  return {
    clock,
    backend,
    kicks,
    globalUow: createMemoryGlobalUnitOfWorkProvider(backend, { relayTrigger }),
    scopeUow: createMemoryScopeUnitOfWorkProvider(backend, { relayTrigger }),
    outbox: createMemoryOutboxRepository(backend),
  };
};

describe("memory unit of work (ADP-common-003)", () => {
  it("commits entity writes and flushes collected events to the outbox, then kicks the relay", async () => {
    const { clock, backend, kicks, globalUow, outbox } = setup();
    const now = clock.now();

    await globalUow.run(async (ctx) => {
      const created = User.create(
        { id: "user-1", email: "u1@example.com", displayName: "User 1" },
        now,
      );
      await ctx.userRepository.insert(created.entity);
      ctx.collectEvents(created.eventDrafts);
    });

    expect(
      await createMemoryUserRepository(backend).findById(userId(1)),
    ).not.toBeNull();
    const claimed = await outbox.claimPending({
      limit: 10,
      now: clock.now(),
      workerId: "worker",
      leaseMs: 60_000,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.type).toBe("identity.user.created");
    expect(claimed[0]?.id.length).toBeGreaterThan(0);
    expect(kicks).toHaveLength(1);
  });

  it("rolls back every write of a failed callback, including buffered events", async () => {
    const { clock, backend, kicks, globalUow, outbox } = setup();
    const now = clock.now();

    await expect(
      globalUow.run(async (ctx) => {
        const created = User.create(
          { id: "user-1", email: "u1@example.com", displayName: "User 1" },
          now,
        );
        await ctx.userRepository.insert(created.entity);
        ctx.collectEvents(created.eventDrafts);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(
      await createMemoryUserRepository(backend).findById(userId(1)),
    ).toBeNull();
    expect(
      await outbox.claimPending({
        limit: 10,
        now: clock.now(),
        workerId: "worker",
        leaseMs: 60_000,
      }),
    ).toHaveLength(0);
    expect(kicks).toHaveLength(0);
  });

  it("scope UoW writes land in the bound scope only", async () => {
    const { clock, backend, scopeUow } = setup();
    const now = clock.now();

    await scopeUow.run(scopeOf(1), async (ctx) => {
      const created = makeBlankNote(1, userId(1), now);
      await ctx.noteRepository.insert(created);
    });

    expect(
      await createMemoryNoteRepository(backend.scope(scopeOf(1))).findById(
        noteId(1),
      ),
    ).not.toBeNull();
    expect(
      await createMemoryNoteRepository(backend.scope(scopeOf(2))).findById(
        noteId(1),
      ),
    ).toBeNull();
  });

  it("forbids nesting: global inside global", async () => {
    const { globalUow } = setup();
    await expect(
      globalUow.run(async () => globalUow.run(async () => undefined)),
    ).rejects.toThrow(/nesting is forbidden/);
  });

  it("forbids nesting across planes: global inside scope and vice versa", async () => {
    const { globalUow, scopeUow } = setup();
    await expect(
      scopeUow.run(scopeOf(1), async () =>
        globalUow.run(async () => undefined),
      ),
    ).rejects.toThrow(/nesting is forbidden/);
    await expect(
      globalUow.run(async () =>
        scopeUow.run(scopeOf(1), async () => undefined),
      ),
    ).rejects.toThrow(/nesting is forbidden/);
  });

  it("a failed scope UoW rolls back the note insert", async () => {
    const { clock, backend, scopeUow } = setup();
    const now = clock.now();

    await expect(
      scopeUow.run(scopeOf(1), async (ctx) => {
        await ctx.noteRepository.insert(makeBlankNote(1, userId(1), now));
        throw new Error("scope boom");
      }),
    ).rejects.toThrow("scope boom");

    expect(
      await createMemoryNoteRepository(backend.scope(scopeOf(1))).findById(
        noteId(1),
      ),
    ).toBeNull();
  });

  it("concurrent unit of works serialize instead of interleaving", async () => {
    const { clock, backend, globalUow } = setup();
    const now = clock.now();
    const order: string[] = [];

    await Promise.all([
      globalUow.run(async (ctx) => {
        order.push("first:start");
        await ctx.userRepository.insert(makePendingUser(1, now));
        await Promise.resolve();
        order.push("first:end");
      }),
      globalUow.run(async (ctx) => {
        order.push("second:start");
        await ctx.userRepository.insert(makePendingUser(2, now));
        order.push("second:end");
      }),
    ]);

    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
    expect(backend.users.size).toBe(2);
  });
});
