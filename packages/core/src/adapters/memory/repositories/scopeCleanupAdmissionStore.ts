import { ConflictError } from "../../../application/errors";
import type {
  PersonalCleanupComponent,
  PersonalCleanupProgress,
  ScopeCleanupAdmissionStore,
} from "../../../application/ports/scopeCleanupAdmissionStore";
import type { UserId } from "../../../domain/identity/valueObject";
import type { CleanupReceiptRow, ScopeStore } from "../store";

const RECEIPT_KEY = "receipt";

const ALL_COMPONENTS: readonly PersonalCleanupComponent[] = [
  "job",
  "note",
  "tag",
  "storage",
  "backup",
  "usage",
  "localProjection",
  "outbox",
];

export type MemoryScopeCleanupAdmissionOptions = Readonly<{
  /**
   * Components that must acknowledge before completion. Defaults to the
   * whole enum — the strictest reading — so a deployment that forgets to
   * declare its participants stalls instead of completing early.
   */
  requiredComponents?: readonly PersonalCleanupComponent[];
}>;

const foreignOperation = (operationId: string): ConflictError =>
  new ConflictError(
    "CLEANUP_OPERATION_MISMATCH",
    `Operation ${operationId} does not own this scope's cleanup`,
  );

export function createMemoryScopeCleanupAdmissionStore(
  scope: ScopeStore,
  options: MemoryScopeCleanupAdmissionOptions = {},
): ScopeCleanupAdmissionStore {
  const table = scope.cleanupReceipts;
  const requiredComponents = options.requiredComponents ?? ALL_COMPONENTS;

  const receipt = (): CleanupReceiptRow | undefined => table.get(RECEIPT_KEY);

  const requireOwner = (operationId: string): CleanupReceiptRow => {
    const row = receipt();
    if (
      row === undefined ||
      row.operationId !== operationId ||
      row.status !== "running"
    ) {
      throw foreignOperation(operationId);
    }
    return row;
  };

  return {
    async assertWritable(): Promise<void> {
      if (receipt() !== undefined) {
        throw new ConflictError(
          "ACCOUNT_DELETING",
          "The scope is closed for writes by an account deletion barrier",
        );
      }
    },

    async assertActorWritable(actorUserId: UserId): Promise<void> {
      if (receipt() !== undefined) {
        throw new ConflictError(
          "ACCOUNT_DELETING",
          "The scope is closed for writes by an account deletion barrier",
        );
      }
      if (scope.actorLocks.has(actorUserId)) {
        throw new ConflictError(
          "ACCOUNT_DELETING",
          `Writes by ${actorUserId} are locked by a removal preparation`,
        );
      }
    },

    async beginPersonalAccountDeletion(
      operationId: string,
      userId: UserId,
    ): Promise<void> {
      const existing = receipt();
      if (existing !== undefined) {
        if (existing.operationId === operationId) {
          return;
        }
        throw new ConflictError(
          "ACCOUNT_DELETING",
          "Another deletion operation already holds the barrier",
        );
      }
      table.set(RECEIPT_KEY, {
        operationId,
        userId,
        status: "running",
        acknowledged: [],
        retainUntil: null,
      });
    },

    async abortPersonalAccountDeletion(operationId: string): Promise<void> {
      requireOwner(operationId);
      table.delete(RECEIPT_KEY);
    },

    async assertOwner(operationId: string): Promise<void> {
      requireOwner(operationId);
    },

    async describePersonalCleanup(
      operationId: string,
    ): Promise<PersonalCleanupProgress | null> {
      const row = receipt();
      if (row === undefined || row.operationId !== operationId) {
        return null;
      }
      return { status: row.status, acknowledged: [...row.acknowledged] };
    },

    async acknowledgePersonalComponent(
      operationId: string,
      component: PersonalCleanupComponent,
    ): Promise<void> {
      const completed = receipt();
      if (
        completed !== undefined &&
        completed.operationId === operationId &&
        completed.status === "completed"
      ) {
        // A delayed duplicate inside the retention window.
        return;
      }
      const row = requireOwner(operationId);
      if (row.acknowledged.includes(component)) {
        return;
      }
      table.set(RECEIPT_KEY, {
        ...row,
        acknowledged: [...row.acknowledged, component],
      });
    },

    async markCompleted(operationId: string, retainUntil: Date): Promise<void> {
      const row = receipt();
      if (
        row !== undefined &&
        row.operationId === operationId &&
        row.status === "completed"
      ) {
        return;
      }
      const running = requireOwner(operationId);
      const missing = requiredComponents.filter(
        (component) => !running.acknowledged.includes(component),
      );
      if (missing.length > 0) {
        throw new ConflictError(
          "CLEANUP_NOT_ACKNOWLEDGED",
          `Components not acknowledged yet: ${missing.join(", ")}`,
        );
      }
      table.set(RECEIPT_KEY, { ...running, status: "completed", retainUntil });
    },

    async pruneCompleted(asOf: Date, limit: number): Promise<number> {
      if (limit <= 0) {
        return 0;
      }
      const row = receipt();
      if (
        row !== undefined &&
        row.status === "completed" &&
        row.retainUntil !== null &&
        row.retainUntil.getTime() <= asOf.getTime()
      ) {
        table.delete(RECEIPT_KEY);
        return 1;
      }
      return 0;
    },
  };
}
