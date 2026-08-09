import type { UserRepository } from "../../../domain/identity/ports/userRepository";
import type { User } from "../../../domain/identity/user";
import type { UserId } from "../../../domain/identity/valueObject";
import type { MemoryBackend } from "../store";
import { createOccRepository } from "../support";

export function createMemoryUserRepository(
  backend: MemoryBackend,
): UserRepository {
  return createOccRepository<User, UserId>("users", backend.users);
}
