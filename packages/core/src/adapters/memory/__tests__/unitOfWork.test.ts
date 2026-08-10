import { beforeEach, describe, expect, it } from "vitest";
import type { ConformanceBackend } from "../../conformance/backend";
import { makePendingUser, userId } from "../../conformance/fixtures";
import { makeMemoryConformanceBackend } from "./conformanceBackend";

// Backend-local, NOT part of the shared conformance suite: mutex
// serialization is the in-memory approximation of transaction isolation
// (ADR-014). A real transactional backend (D1/DO, Issue #11) interleaves
// callbacks and must still be correct, so the shared suite asserts only
// per-run atomicity.
describe("memory global unit of work serialization (ADR-014)", () => {
  let backend: ConformanceBackend;

  beforeEach(() => {
    backend = makeMemoryConformanceBackend();
  });

  it("runs concurrent unit of works one after another instead of interleaving", async () => {
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
