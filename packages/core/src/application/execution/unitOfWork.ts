import type { EventDraft } from "@repo/core/domain/common/event";
import type { AuthTokenRepository } from "@repo/core/domain/identity/ports/authTokenRepository";
import type { IdentityRepository } from "@repo/core/domain/identity/ports/identityRepository";
import type { IdentityUniqueDirectory } from "@repo/core/domain/identity/ports/identityUniqueDirectory";
import type { SessionRepository } from "@repo/core/domain/identity/ports/sessionRepository";
import type { UserRepository } from "@repo/core/domain/identity/ports/userRepository";
import type { LocalNoteProjectionWriter } from "@repo/core/domain/note/ports/localNoteProjectionWriter";
import type { NoteProjectionRevisionStore } from "@repo/core/domain/note/ports/noteProjectionRevisionStore";
import type { NoteRepository } from "@repo/core/domain/note/ports/noteRepository";
import type { NoteRevisionRepository } from "@repo/core/domain/note/ports/noteRevisionRepository";
import type { StoredFileRepository } from "@repo/core/domain/storage/ports/storedFileRepository";
import type { LlmUsageRepository } from "@repo/core/domain/usage/ports/llmUsageRepository";
import type { StorageQuotaRepository } from "@repo/core/domain/usage/ports/storageQuotaRepository";
import type { InvitationRepository } from "@repo/core/domain/workspace/ports/invitationRepository";
import type { MembershipDirectoryReservationStore } from "@repo/core/domain/workspace/ports/membershipDirectoryReservationStore";
import type { MembershipRemovalPreparationStore } from "@repo/core/domain/workspace/ports/membershipRemovalPreparationStore";
import type { MembershipRepository } from "@repo/core/domain/workspace/ports/membershipRepository";
import type { UserWorkspaceDirectory } from "@repo/core/domain/workspace/ports/userWorkspaceDirectory";
import type { WorkspaceDeletionManifestStore } from "@repo/core/domain/workspace/ports/workspaceDeletionManifestStore";
import type { WorkspaceOperationLockStore } from "@repo/core/domain/workspace/ports/workspaceOperationLockStore";
import type { WorkspaceRepository } from "@repo/core/domain/workspace/ports/workspaceRepository";
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
 * The membership half of the global directory, narrowed to the two reads
 * an account deletion's admission decides on.
 *
 * Both `Pick`s are read-only on purpose, in the discipline
 * `application/di/types.ts` states for its own reader views: the
 * directories are written by the join, removal and role-projection sagas,
 * and admission has no business reaching a transition — least of all a
 * terminal one — from inside the transaction that judges them.
 */
export type SettledMembershipReader = Pick<
  UserWorkspaceDirectory,
  "countSettledByUser"
>;
export type ActivatingMembershipReader = Pick<
  MembershipDirectoryReservationStore,
  "listActivatingByUser"
>;

/**
 * Global-plane transaction context: the identity aggregates and the
 * uniqueness directory that live in global storage.
 *
 * `identityRemovalReceiptStore` lives here because removing an identity
 * has to write the row deletion, the retention receipt, and the outbox
 * event in one transaction. The two account-deletion stores are here for
 * the same reason:
 * admission creates the operation in the transaction that moves the user
 * to `deleting`, and the terminal prune drops the manifest header and
 * the operation together.
 *
 * The two membership readers are the exception to "the design deliberately
 * places those writes outside any unit of work" — the rule
 * `ScopeUnitOfWorkContext` below states for the global counterparts of
 * the workspace group. They are reads, not writes, and account-deletion
 * admission has to take them **inside**
 * the transaction that moves the user to `deleting`: judged from outside,
 * a join that lands between the read and the transition is admitted, its
 * edge settles, and the manifest fixes a membership item nothing in this
 * deployment can acknowledge — the account is then stuck `deleting` with
 * no way forward or back. The write-side halves of both ports stay off
 * this context.
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
  readonly settledMembershipReader: SettledMembershipReader;
  readonly activatingMembershipReader: ActivatingMembershipReader;
}

/**
 * Scope-plane transaction context: one scope object's repositories and
 * its local outbox. Later slices add the tag repositories here.
 * `cleanupAdmission` is bound to the same scope — every normal write
 * entry point calls `assertWritable` (and `assertActorWritable` where an
 * actor is involved) before mutating.
 *
 * `noteProjectionRevisionStore` lives on the context because
 * `bump(noteId)` must share the transaction with the authoritative-data
 * write whose event carries the revision. `scopeTaskScheduler` is here
 * for the same reason: a continuation must be stored in the transaction of the
 * turn it follows, or a lost response drops the rest of the work.
 * `localNoteProjectionWriter` is the scope's own read model, so its
 * writes belong to the transaction of the change they project.
 * `appliedOperationStore` likewise records a cleanup command in the
 * transaction that applies it, so a redelivery cannot apply it twice.
 *
 * The workspace group is here in full because every one of its members
 * is scope-local business data or the admission state guarding it: the
 * three aggregates, the account-deletion prepare lock on a membership,
 * the move locks and deletion admission, and the deletion manifest whose
 * page, cursor and continuation task must land in one transaction.
 * Their global
 * counterparts — the directories and the three service-wide reservations
 * — sit on the request container instead, since the design deliberately
 * places those writes outside any unit of work.
 */
export interface ScopeUnitOfWorkContext extends UnitOfWorkContextBase {
  readonly noteRepository: NoteRepository;
  readonly noteRevisionRepository: NoteRevisionRepository;
  readonly cleanupAdmission: ScopeCleanupAdmissionStore;
  readonly noteProjectionRevisionStore: NoteProjectionRevisionStore;
  readonly localNoteProjectionWriter: LocalNoteProjectionWriter;
  readonly scopeTaskScheduler: ScopeTaskScheduler;
  readonly appliedOperationStore: AppliedOperationStore;
  readonly storageQuotaRepository: StorageQuotaRepository;
  readonly llmUsageRepository: LlmUsageRepository;
  readonly storedFileRepository: StoredFileRepository;
  readonly workspaceRepository: WorkspaceRepository;
  readonly membershipRepository: MembershipRepository;
  readonly invitationRepository: InvitationRepository;
  readonly membershipRemovalPreparationStore: MembershipRemovalPreparationStore;
  readonly workspaceOperationLockStore: WorkspaceOperationLockStore;
  readonly workspaceDeletionManifestStore: WorkspaceDeletionManifestStore;
}

/**
 * Global-plane unit of work.
 *
 * Shared rules for both planes:
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
