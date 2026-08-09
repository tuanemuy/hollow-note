import type { EventDraft } from "@repo/core/domain/common/event";
import type { AuthTokenRepository } from "@repo/core/domain/identity/ports/authTokenRepository";
import type { IdentityRepository } from "@repo/core/domain/identity/ports/identityRepository";
import type { IdentityUniqueDirectory } from "@repo/core/domain/identity/ports/identityUniqueDirectory";
import type { SessionRepository } from "@repo/core/domain/identity/ports/sessionRepository";
import type { UserRepository } from "@repo/core/domain/identity/ports/userRepository";
import type { NoteRepository } from "@repo/core/domain/note/ports/noteRepository";
import type { NoteRevisionRepository } from "@repo/core/domain/note/ports/noteRevisionRepository";
import type { ScopeCleanupAdmissionStore } from "../ports/scopeCleanupAdmissionStore";
import type { ScopeKey } from "../scope";

/**
 * Shared surface of both unit-of-work planes.
 *
 * `collectEvents` buffers identity-less domain event drafts for the
 * transactional outbox flush at commit time. `EventId` is minted by the
 * UoW implementation against the `IdGenerator` port as drafts are
 * buffered — domain code never touches id generation and usecases never
 * thread `idGenerator` manually.
 */
export interface UnitOfWorkContextBase {
  collectEvents(drafts: readonly EventDraft[]): void;
}

/**
 * Global-plane transaction context: the identity aggregates and the
 * uniqueness directory that live in global storage.
 */
export interface GlobalUnitOfWorkContext extends UnitOfWorkContextBase {
  readonly userRepository: UserRepository;
  readonly identityRepository: IdentityRepository;
  readonly sessionRepository: SessionRepository;
  readonly authTokenRepository: AuthTokenRepository;
  readonly identityUniqueDirectory: IdentityUniqueDirectory;
}

/**
 * Scope-plane transaction context: one scope object's repositories and
 * its local outbox. Later slices add tag / storage repositories here.
 * `cleanupAdmission` is bound to the same scope — every normal write
 * entry point calls `assertWritable` (and `assertActorWritable` where an
 * actor is involved) before mutating.
 */
export interface ScopeUnitOfWorkContext extends UnitOfWorkContextBase {
  readonly noteRepository: NoteRepository;
  readonly noteRevisionRepository: NoteRevisionRepository;
  readonly cleanupAdmission: ScopeCleanupAdmissionStore;
}

/**
 * Global-plane unit of work.
 *
 * Shared rules for both planes (spec/usecases/identity.md "共通の約束"):
 * - **Never nest `run`** — not inside another global UoW, not inside a
 *   scope UoW, and vice versa. One transactional step runs in exactly
 *   one transaction on one plane.
 * - Shared procedures needing transactional access are written as
 *   functions **receiving the context**, never functions opening their
 *   own `run`.
 */
export interface GlobalUnitOfWorkProvider {
  run<T>(fn: (ctx: GlobalUnitOfWorkContext) => Promise<T>): Promise<T>;
}

/**
 * Scope-plane unit of work. `run` binds the transaction to a single
 * scope object: the context exposes only that scope's repositories and
 * local outbox. Nesting is forbidden — including a global UoW inside —
 * per the shared rules on `GlobalUnitOfWorkProvider`.
 */
export interface ScopeUnitOfWorkProvider {
  run<T>(
    scope: ScopeKey,
    fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
  ): Promise<T>;
}
