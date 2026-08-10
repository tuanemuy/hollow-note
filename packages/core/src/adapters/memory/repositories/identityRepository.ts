import type { Identity } from "../../../domain/identity/identity";
import type { IdentityRepository } from "../../../domain/identity/ports/identityRepository";
import type { IdentityId, UserId } from "../../../domain/identity/valueObject";
import type { MemoryBackend } from "../store";
import { clone, createOccRepository } from "../support";

export function createMemoryIdentityRepository(
  backend: MemoryBackend,
): IdentityRepository {
  const base = createOccRepository<Identity, IdentityId>(
    "identities",
    backend.identities,
  );
  return {
    ...base,
    async listByUserId(userId: UserId): Promise<readonly Identity[]> {
      return backend.identities
        .values()
        .filter((identity) => identity.userId === userId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(clone);
    },
  };
}
