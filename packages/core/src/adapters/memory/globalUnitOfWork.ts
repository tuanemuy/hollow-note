import type {
  GlobalUnitOfWorkContext,
  GlobalUnitOfWorkProvider,
} from "../../application/execution/unitOfWork";
import type { RelayTrigger } from "../../application/ports/relayTrigger";
import type { EventDraft } from "../../domain/common/event";
import { attachEventIds, type DomainEvent } from "../../domain/common/event";
import { createMemoryAuthTokenRepository } from "./repositories/authTokenRepository";
import { createMemoryIdentityRepository } from "./repositories/identityRepository";
import { createMemoryIdentityUniqueDirectory } from "./repositories/identityUniqueDirectory";
import { createMemoryOutboxRepository } from "./repositories/outboxRepository";
import { createMemorySessionRepository } from "./repositories/sessionRepository";
import { createMemoryUserRepository } from "./repositories/userRepository";
import type { MemoryBackend } from "./store";

export type MemoryUnitOfWorkOptions = Readonly<{
  relayTrigger?: RelayTrigger;
}>;

/**
 * Global-plane unit of work over the memory backend.
 *
 * The callback runs inside the backend's transaction context: every
 * table write it issues is undo-logged and rolled back as one unit when
 * the callback (or the outbox flush) throws. Event drafts buffered via
 * `collectEvents` get their `EventId` minted immediately and are flushed
 * to the outbox inside the same transaction; the relay trigger is kicked
 * only after a successful commit.
 */
export function createMemoryGlobalUnitOfWorkProvider(
  backend: MemoryBackend,
  options: MemoryUnitOfWorkOptions = {},
): GlobalUnitOfWorkProvider {
  const outboxRepository = createMemoryOutboxRepository(backend);
  return {
    async run<T>(fn: (ctx: GlobalUnitOfWorkContext) => Promise<T>): Promise<T> {
      let dispatched = false;
      const result = await backend.transactions.run(async () => {
        const buffered: DomainEvent[] = [];
        const ctx: GlobalUnitOfWorkContext = {
          userRepository: createMemoryUserRepository(backend),
          identityRepository: createMemoryIdentityRepository(backend),
          sessionRepository: createMemorySessionRepository(backend),
          authTokenRepository: createMemoryAuthTokenRepository(backend),
          identityUniqueDirectory: createMemoryIdentityUniqueDirectory(backend),
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
