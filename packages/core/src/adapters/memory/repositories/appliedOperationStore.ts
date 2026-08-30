import { createHash } from "node:crypto";
import type { AppliedOperationStore } from "../../../application/ports/appliedOperationStore";
import type { ScopeStore } from "../store";

/**
 * The two-part key folds into one column, mirroring the single
 * `operation_id` primary key of the `applied_operations` table, so a SQL
 * backend keeps the same shape.
 */
const appliedOperationId = (operationId: string, commandKey: string): string =>
  createHash("sha256")
    .update(`${operationId}:${commandKey}`, "utf8")
    .digest("hex");

export function createMemoryAppliedOperationStore(
  scope: ScopeStore,
): AppliedOperationStore {
  const table = scope.appliedOperations;
  return {
    async markApplied(input): Promise<boolean> {
      const key = appliedOperationId(input.operationId, input.commandKey);
      if (table.has(key)) {
        return false;
      }
      table.set(key, true);
      return true;
    },
    async clearApplied(input): Promise<void> {
      table.delete(appliedOperationId(input.operationId, input.commandKey));
    },
  };
}
