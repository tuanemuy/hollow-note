import type {
  IdentityRemovalReceipt,
  IdentityRemovalReceiptStore,
} from "../../../application/ports/identityRemovalReceiptStore";
import type { PrunePage } from "../../../domain/common/pagination";
import type { IdentityId } from "../../../domain/identity/valueObject";
import type { MemoryBackend } from "../store";
import { clone, deleteExpiredPage } from "../support";

export function createMemoryIdentityRemovalReceiptStore(
  backend: MemoryBackend,
): IdentityRemovalReceiptStore {
  const table = backend.identityRemovalReceipts;
  return {
    // Keyed by identity id, as spec/database gives `identity_removal_receipts`
    // an `identity_id` primary key with `operation_id` as a column.
    async record(receipt: IdentityRemovalReceipt): Promise<void> {
      if (table.has(receipt.identityId)) {
        return;
      }
      table.set(receipt.identityId, clone(receipt));
    },

    async findByOperationId(
      operationId: string,
    ): Promise<IdentityRemovalReceipt | null> {
      const row = table
        .values()
        .find((receipt) => receipt.operationId === operationId);
      return row === undefined ? null : clone(row);
    },

    async findByIdentityId(
      identityId: IdentityId,
    ): Promise<IdentityRemovalReceipt | null> {
      const row = table.get(identityId);
      return row === undefined ? null : clone(row);
    },

    async deleteExpired(
      now: Date,
      cursor: string | null,
      limit: number,
    ): Promise<PrunePage> {
      return deleteExpiredPage(
        table,
        (row) => row.expiresAt,
        now,
        cursor,
        limit,
      );
    },
  };
}
