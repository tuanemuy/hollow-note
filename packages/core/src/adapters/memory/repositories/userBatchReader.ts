import { SystemError, SystemErrorCode } from "../../../application/errors";
import type {
  ExpectedVersion,
  Versioned,
} from "../../../domain/common/transactionalRepository";
import type { UserBatchReader } from "../../../domain/identity/ports/userBatchReader";
import type { User } from "../../../domain/identity/user";
import type { UserId } from "../../../domain/identity/valueObject";
import type { MemoryBackend } from "../store";
import { clone } from "../support";

const MAX_BATCH = 100;

export function createMemoryUserBatchReader(
  backend: MemoryBackend,
): UserBatchReader {
  return {
    async resolveMany(
      ids: readonly UserId[],
    ): Promise<ReadonlyMap<UserId, Versioned<User>>> {
      if (ids.length > MAX_BATCH) {
        throw new SystemError(
          SystemErrorCode.DatabaseError,
          `resolveMany accepts at most ${MAX_BATCH} ids`,
        );
      }
      const result = new Map<UserId, Versioned<User>>();
      for (const id of ids) {
        const stored = backend.users.get(id);
        if (stored !== undefined) {
          result.set(id, {
            entity: clone(stored),
            expectedVersion: stored.version as number as ExpectedVersion<User>,
          });
        }
      }
      return result;
    },
  };
}
