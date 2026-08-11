import type { EventDraft } from "@repo/core/domain/common/event";
import { EventId } from "@repo/core/domain/common/event";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import { IdentityContinuations } from "../../identity/continuations";
import { mintEventIdFor } from "../eventId";

const draft = (payload: Record<string, unknown>): EventDraft => ({
  type: "test.event",
  payload,
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  aggregateId: "aggregate-1",
});

const minted = () => EventId.create("minted");

describe("mintEventIdFor", () => {
  it("derives the id from a continuation key and mints one otherwise", () => {
    expect(mintEventIdFor(draft({ continuationKey: "chain:1" }), minted)).toBe(
      "chain:1",
    );
    expect(mintEventIdFor(draft({}), minted)).toBe("minted");
    expect(mintEventIdFor(draft({ continuationKey: "" }), minted)).toBe(
      "minted",
    );
    expect(mintEventIdFor(draft({ continuationKey: 7 }), minted)).toBe(
      "minted",
    );
  });

  it("collects the same continuation twice into a single outbox row", async () => {
    const h = createTestHarness();
    const continuation = () =>
      IdentityContinuations.accountDeletionDispatch(
        { operationId: "op-1", phase: "cleanup" },
        h.clock.now(),
      );

    await h.container.globalUnitOfWorkProvider.run(async (ctx) => {
      ctx.collectEvents([continuation()]);
    });
    await h.container.globalUnitOfWorkProvider.run(async (ctx) => {
      ctx.collectEvents([continuation()]);
    });

    const rows = h.backend.outbox
      .values()
      .filter(
        (row) => row.type === "identity.accountDeletionDispatchContinued",
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(
      "identity.accountDeletionDispatchContinued:op-1:cleanup:-",
    );
  });

  it("keeps ordinary domain events distinct across commits", async () => {
    const h = createTestHarness();
    const event = () => ({
      type: "identity.user.created" as const,
      payload: { userId: "user-1" },
      occurredAt: h.clock.now(),
      aggregateId: "user-1",
    });

    await h.container.globalUnitOfWorkProvider.run(async (ctx) => {
      ctx.collectEvents([event()]);
    });
    await h.container.globalUnitOfWorkProvider.run(async (ctx) => {
      ctx.collectEvents([event()]);
    });

    expect(
      h.backend.outbox
        .values()
        .filter((row) => row.type === "identity.user.created"),
    ).toHaveLength(2);
  });
});
