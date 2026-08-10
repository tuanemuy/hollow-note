import { beforeEach, describe, expect, it } from "vitest";
import { User } from "../../domain/identity/user";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import {
  makeBlankNote,
  makePendingUser,
  noteId,
  scopeOf,
  userId,
} from "./fixtures";

/**
 * Shared conformance suite for the unit-of-work planes (ADP-common-003).
 *
 * Covers: commit of entity writes plus the transactional outbox flush
 * (relay kicked after commit only), full rollback of a failed callback
 * including buffered events, scope binding, the nesting prohibition
 * (same-plane and cross-plane), and serialization of concurrent runs.
 */
export function describeUnitOfWorkContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`UnitOfWork conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-common-003: commits entity writes and flushes collected events to the outbox, then kicks the relay", async () => {
      const now = backend.clock.now();

      await backend.globalUnitOfWork.run(async (ctx) => {
        const created = User.create(
          { id: "user-1", email: "u1@example.com", displayName: "User 1" },
          now,
        );
        await ctx.userRepository.insert(created.entity);
        ctx.collectEvents(created.eventDrafts);
      });

      expect(await backend.userRepository.findById(userId(1))).not.toBeNull();
      const claimed = await backend.outboxRepository.claimPending({
        limit: 10,
        now: backend.clock.now(),
        workerId: "worker",
        leaseMs: 60_000,
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.type).toBe("identity.user.created");
      expect(claimed[0]?.id.length).toBeGreaterThan(0);
      expect(backend.relayKickCount()).toBe(1);
    });

    it("ADP-common-003: rolls back every write of a failed callback, including buffered events", async () => {
      const now = backend.clock.now();

      await expect(
        backend.globalUnitOfWork.run(async (ctx) => {
          const created = User.create(
            { id: "user-1", email: "u1@example.com", displayName: "User 1" },
            now,
          );
          await ctx.userRepository.insert(created.entity);
          ctx.collectEvents(created.eventDrafts);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(await backend.userRepository.findById(userId(1))).toBeNull();
      expect(
        await backend.outboxRepository.claimPending({
          limit: 10,
          now: backend.clock.now(),
          workerId: "worker",
          leaseMs: 60_000,
        }),
      ).toHaveLength(0);
      expect(backend.relayKickCount()).toBe(0);
    });

    it("ADP-common-003: scope UoW writes land in the bound scope only", async () => {
      const now = backend.clock.now();

      await backend.scopeUnitOfWork.run(scopeOf(1), async (ctx) => {
        await ctx.noteRepository.insert(makeBlankNote(1, userId(1), now));
      });

      expect(
        await backend.forScope(scopeOf(1)).noteRepository.findById(noteId(1)),
      ).not.toBeNull();
      expect(
        await backend.forScope(scopeOf(2)).noteRepository.findById(noteId(1)),
      ).toBeNull();
    });

    it("ADP-common-003: forbids nesting: global inside global", async () => {
      const { globalUnitOfWork } = backend;
      await expect(
        globalUnitOfWork.run(async () =>
          globalUnitOfWork.run(async () => undefined),
        ),
      ).rejects.toThrow();
    });

    it("ADP-common-003: forbids nesting across planes: global inside scope and vice versa", async () => {
      const { globalUnitOfWork, scopeUnitOfWork } = backend;
      await expect(
        scopeUnitOfWork.run(scopeOf(1), async () =>
          globalUnitOfWork.run(async () => undefined),
        ),
      ).rejects.toThrow();
      await expect(
        globalUnitOfWork.run(async () =>
          scopeUnitOfWork.run(scopeOf(1), async () => undefined),
        ),
      ).rejects.toThrow();
    });

    it("ADP-common-003: a failed scope UoW rolls back the note insert", async () => {
      const now = backend.clock.now();

      await expect(
        backend.scopeUnitOfWork.run(scopeOf(1), async (ctx) => {
          await ctx.noteRepository.insert(makeBlankNote(1, userId(1), now));
          throw new Error("scope boom");
        }),
      ).rejects.toThrow("scope boom");

      expect(
        await backend.forScope(scopeOf(1)).noteRepository.findById(noteId(1)),
      ).toBeNull();
    });

    it("ADP-common-003: concurrent unit of works serialize instead of interleaving", async () => {
      const now = backend.clock.now();
      const order: string[] = [];

      await Promise.all([
        backend.globalUnitOfWork.run(async (ctx) => {
          order.push("first:start");
          await ctx.userRepository.insert(makePendingUser(1, now));
          await Promise.resolve();
          order.push("first:end");
        }),
        backend.globalUnitOfWork.run(async (ctx) => {
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
      expect(await backend.userRepository.findById(userId(1))).not.toBeNull();
      expect(await backend.userRepository.findById(userId(2))).not.toBeNull();
    });
  });
}
