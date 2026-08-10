import type { EventDraft } from "@repo/core/domain/common/event";
import type { AuthTokenRepository } from "@repo/core/domain/identity/ports/authTokenRepository";
import type { IdentityRepository } from "@repo/core/domain/identity/ports/identityRepository";
import type { IdentityUniqueDirectory } from "@repo/core/domain/identity/ports/identityUniqueDirectory";
import type { SessionRepository } from "@repo/core/domain/identity/ports/sessionRepository";
import type { UserRepository } from "@repo/core/domain/identity/ports/userRepository";
import type { NoteProjectionRevisionStore } from "@repo/core/domain/note/ports/noteProjectionRevisionStore";
import type { NoteRepository } from "@repo/core/domain/note/ports/noteRepository";
import type { NoteRevisionRepository } from "@repo/core/domain/note/ports/noteRevisionRepository";
import type { StoredFileRepository } from "@repo/core/domain/storage/ports/storedFileRepository";
import type { LlmUsageRepository } from "@repo/core/domain/usage/ports/llmUsageRepository";
import type { StorageQuotaRepository } from "@repo/core/domain/usage/ports/storageQuotaRepository";
import type { AccountDeletionManifestStore } from "../ports/accountDeletionManifestStore";
import type { AppliedOperationStore } from "../ports/appliedOperationStore";
import type { DistributedOperationStore } from "../ports/distributedOperationStore";
import type { IdentityRemovalReceiptStore } from "../ports/identityRemovalReceiptStore";
import type { ScopeCleanupAdmissionStore } from "../ports/scopeCleanupAdmissionStore";
import type { ScopeTaskScheduler } from "../ports/scopeTaskScheduler";
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
 *
 * `identityRemovalReceiptStore` lives here because removing an identity
 * has to write the row deletion, the retention receipt, and the outbox
 * event in one transaction (spec/usecases/identity.md `removeIdentity`
 * 手順 3). The two account-deletion stores are here for the same reason:
 * admission creates the operation in the transaction that moves the user
 * to `deleting`, and the terminal prune drops the manifest header and
 * the operation together.
 */
export interface GlobalUnitOfWorkContext extends UnitOfWorkContextBase {
  readonly userRepository: UserRepository;
  readonly identityRepository: IdentityRepository;
  readonly sessionRepository: SessionRepository;
  readonly authTokenRepository: AuthTokenRepository;
  readonly identityUniqueDirectory: IdentityUniqueDirectory;
  readonly identityRemovalReceiptStore: IdentityRemovalReceiptStore;
  readonly distributedOperationStore: DistributedOperationStore;
  readonly accountDeletionManifestStore: AccountDeletionManifestStore;
}

/**
 * Scope-plane transaction context: one scope object's repositories and
 * its local outbox. Later slices add tag / storage repositories here.
 * `cleanupAdmission` is bound to the same scope — every normal write
 * entry point calls `assertWritable` (and `assertActorWritable` where an
 * actor is involved) before mutating.
 *
 * `noteProjectionRevisionStore` lives on the context because the spec
 * requires `bump(noteId)` to share the transaction with the
 * authoritative-data write whose event carries the revision
 * (spec/usecases/note.md 共通節). `scopeTaskScheduler` is here for the
 * same reason: a continuation must be stored in the transaction of the
 * turn it follows, or a lost response drops the rest of the work.
 * `appliedOperationStore` likewise records a cleanup command in the
 * transaction that applies it, so a redelivery cannot apply it twice.
 */
export interface ScopeUnitOfWorkContext extends UnitOfWorkContextBase {
  readonly noteRepository: NoteRepository;
  readonly noteRevisionRepository: NoteRevisionRepository;
  readonly cleanupAdmission: ScopeCleanupAdmissionStore;
  readonly noteProjectionRevisionStore: NoteProjectionRevisionStore;
  readonly scopeTaskScheduler: ScopeTaskScheduler;
  readonly appliedOperationStore: AppliedOperationStore;
  readonly storageQuotaRepository: StorageQuotaRepository;
  readonly llmUsageRepository: LlmUsageRepository;
  readonly storedFileRepository: StoredFileRepository;
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
