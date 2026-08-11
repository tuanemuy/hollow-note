import type {
  ScopeUnitOfWorkContext,
  ScopeUnitOfWorkProvider,
} from "../../application/execution/unitOfWork";
import type { ScopeKey } from "../../application/scope";
import type { EventDraft } from "../../domain/common/event";
import { attachEventIds, type DomainEvent } from "../../domain/common/event";
import type { MemoryUnitOfWorkOptions } from "./globalUnitOfWork";
import { createMemoryAppliedOperationStore } from "./repositories/appliedOperationStore";
import { createMemoryLlmUsageRepository } from "./repositories/llmUsageRepository";
import { createMemoryNoteProjectionRevisionStore } from "./repositories/noteProjection";
import { createMemoryNoteRepository } from "./repositories/noteRepository";
import { createMemoryNoteRevisionRepository } from "./repositories/noteRevisionRepository";
import { createMemoryOutboxRepository } from "./repositories/outboxRepository";
import { createMemoryScopeCleanupAdmissionStore } from "./repositories/scopeCleanupAdmissionStore";
import { createMemoryScopeTaskScheduler } from "./repositories/scopeTaskScheduler";
import { createMemoryStorageQuotaRepository } from "./repositories/storageQuotaRepository";
import { createMemoryStoredFileRepository } from "./repositories/storedFileRepository";
import type { MemoryBackend } from "./store";

/**
 * Scope-plane unit of work: `run` binds the transaction to one scope's
 * tables, so the context can only reach that scope object. Nesting —
 * including a global UoW inside — is rejected by the shared transaction
 * controller. Events flush to the (single, in-process) outbox in the
 * same transaction, mirroring the per-scope local outbox of the real
 * backends.
 */
export function createMemoryScopeUnitOfWorkProvider(
  backend: MemoryBackend,
  options: MemoryUnitOfWorkOptions = {},
): ScopeUnitOfWorkProvider {
  const outboxRepository = createMemoryOutboxRepository(backend);
  return {
    async run<T>(
      scope: ScopeKey,
      fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
    ): Promise<T> {
      const scopeStore = backend.scope(scope);
      let dispatched = false;
      const result = await backend.transactions.run(async () => {
        const buffered: DomainEvent[] = [];
        const ctx: ScopeUnitOfWorkContext = {
          noteRepository: createMemoryNoteRepository(scopeStore),
          noteRevisionRepository:
            createMemoryNoteRevisionRepository(scopeStore),
          cleanupAdmission: createMemoryScopeCleanupAdmissionStore(scopeStore, {
            ...(options.requiredCleanupComponents !== undefined
              ? { requiredComponents: options.requiredCleanupComponents }
              : {}),
          }),
          noteProjectionRevisionStore:
            createMemoryNoteProjectionRevisionStore(scopeStore),
          scopeTaskScheduler: createMemoryScopeTaskScheduler(scopeStore),
          appliedOperationStore: createMemoryAppliedOperationStore(scopeStore),
          storageQuotaRepository:
            createMemoryStorageQuotaRepository(scopeStore),
          llmUsageRepository: createMemoryLlmUsageRepository(scopeStore),
          storedFileRepository: createMemoryStoredFileRepository(scopeStore),
          collectEvents(drafts: readonly EventDraft[]): void {
            buffered.push(
              ...attachEventIds(drafts, () => backend.mintEventId()),
            );
          },
        };
        const value = await fn(ctx);
        if (buffered.length > 0) {
          await outboxRepository.save(buffered);
          dispatched = true;
        }
        return value;
      });
      if (dispatched) {
        options.relayTrigger?.kick();
      }
      return result;
    },
  };
}
