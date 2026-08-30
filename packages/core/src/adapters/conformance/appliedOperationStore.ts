import { beforeEach, describe, expect, it } from "vitest";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import { scopeOf } from "./fixtures";

/**
 * Shared conformance suite for `AppliedOperationStore`: one-shot marking
 * of an operation's command in the current scope.
 */
export function describeAppliedOperationStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`AppliedOperationStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let store: ScopedConformancePorts["appliedOperationStore"];

    beforeEach(async () => {
      backend = await makeBackend();
      store = backend.forScope(scopeOf(1)).appliedOperationStore;
    });

    it("records the first application and rejects the redelivery", async () => {
      expect(
        await store.markApplied({
          operationId: "op-1",
          commandKey: "cleanup:storage",
        }),
      ).toBe(true);
      expect(
        await store.markApplied({
          operationId: "op-1",
          commandKey: "cleanup:storage",
        }),
      ).toBe(false);
    });

    it("separates commands of one operation and operations of one command", async () => {
      await store.markApplied({
        operationId: "op-1",
        commandKey: "cleanup:storage",
      });

      expect(
        await store.markApplied({
          operationId: "op-1",
          commandKey: "cleanup:usage",
        }),
      ).toBe(true);
      expect(
        await store.markApplied({
          operationId: "op-2",
          commandKey: "cleanup:storage",
        }),
      ).toBe(true);
    });

    it("lets a cleared command be applied again", async () => {
      await store.markApplied({
        operationId: "op-1",
        commandKey: "cleanup:storage",
      });

      await store.clearApplied({
        operationId: "op-1",
        commandKey: "cleanup:storage",
      });

      expect(
        await store.markApplied({
          operationId: "op-1",
          commandKey: "cleanup:storage",
        }),
      ).toBe(true);
    });

    it("re-applies a command cleared earlier in the same unit of work", async () => {
      const scope = scopeOf(1);
      await backend.scopeUnitOfWork.run(scope, (ctx) =>
        ctx.appliedOperationStore.markApplied({
          operationId: "op-1",
          commandKey: "cleanup:storage",
        }),
      );

      // What a compensation does: it clears the receipts of the phases it
      // reverses and re-applies one of them — un-staging is the retire of
      // the scope giving the rows back — inside the transaction that
      // reverses them. A backend that does not read its own writes would
      // answer `false` and skip the undo.
      const reapplied = await backend.scopeUnitOfWork.run(
        scope,
        async (ctx) => {
          await ctx.appliedOperationStore.clearApplied({
            operationId: "op-1",
            commandKey: "cleanup:storage",
          });
          return ctx.appliedOperationStore.markApplied({
            operationId: "op-1",
            commandKey: "cleanup:storage",
          });
        },
      );

      expect(reapplied).toBe(true);
      expect(
        await store.markApplied({
          operationId: "op-1",
          commandKey: "cleanup:storage",
        }),
      ).toBe(false);
    });

    it("clears only the named command of the operation", async () => {
      await store.markApplied({
        operationId: "op-1",
        commandKey: "cleanup:storage",
      });
      await store.markApplied({
        operationId: "op-1",
        commandKey: "cleanup:usage",
      });

      await store.clearApplied({
        operationId: "op-1",
        commandKey: "cleanup:storage",
      });

      expect(
        await store.markApplied({
          operationId: "op-1",
          commandKey: "cleanup:usage",
        }),
      ).toBe(false);
    });

    it("clears a record that was never written without failing", async () => {
      await expect(
        store.clearApplied({
          operationId: "op-missing",
          commandKey: "cleanup:storage",
        }),
      ).resolves.toBeUndefined();
    });

    it("keeps the record inside the scope that applied it", async () => {
      await store.markApplied({
        operationId: "op-1",
        commandKey: "cleanup:storage",
      });

      expect(
        await backend.forScope(scopeOf(2)).appliedOperationStore.markApplied({
          operationId: "op-1",
          commandKey: "cleanup:storage",
        }),
      ).toBe(true);
    });
  });
}
