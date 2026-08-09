import type { EventDraft } from "@repo/core/domain/common/event";

// Transitional stub (Issue #1 step 1): the todo-bound context was removed
// with the reference implementation. Step 2 replaces this with the
// two-plane Global/Scope unit-of-work providers.
export interface UnitOfWorkContext {
  /**
   * Enqueue domain event drafts for outbox flush at commit time.
   *
   * Drafts are identity-less by design — `EventId` is minted by the UoW
   * implementation against the application's `IdGenerator` port and
   * attached as the draft is buffered. Domain code therefore never touches
   * id generation, and usecases never thread `idGenerator` through manually.
   */
  collectEvents(drafts: readonly EventDraft[]): void;
}

export interface UnitOfWorkProvider {
  run<T>(fn: (ctx: UnitOfWorkContext) => Promise<T>): Promise<T>;
}
