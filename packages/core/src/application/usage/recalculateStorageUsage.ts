import { BusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { StorageOwner } from "@repo/core/domain/storage/valueObject";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import { QuotaSubject } from "@repo/core/domain/usage/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceAccess } from "../workspace/resolveWorkspaceAccess";
import type { RecalculatedStorageUsageView } from "./view";

export type RecalculateStorageUsageInput = Readonly<{
  userId: string;
  subjectType: "user" | "workspace";
  subjectId: string;
}>;

/**
 * Rebuilds a subject's storage totals from the real rows (UC-usage-005,
 * spec/usecases/usage.md#recalculatestorageusage).
 *
 * The scan result — not a delta — is the authority, so the aggregate is
 * overwritten through `StorageQuota.replaceTotals`. `artifact` bytes are
 * excluded by `sumSizeByOwner` itself, matching the exclusion the
 * incremental path applies, and notes are counted with lifecycle `"all"`
 * because trashed notes still occupy the subject.
 *
 * `userId` is the actor, not the subject: `assertActorWritable` needs
 * whoever asked for the stocktake, and a workspace subject is recomputed
 * by a member. A user subject is therefore bound to the actor
 * — the two are the same person or the actor has no standing over that
 * scope at all — and a workspace subject is bound to a membership in it
 * (spec/usecases/usage.md#recalculatestorageusage 手順 1).
 *
 * Membership alone is the bar, with no action from the role table: the
 * stocktake writes nothing a member cannot already see, and it only ever
 * replaces a drifted total with what the scope's own rows add up to.
 *
 * That bar is decided twice for a workspace subject. The resolution
 * outside the unit of work is the early refusal; the membership read
 * inside it is what admits the write, because a member removed while the
 * request is in flight moves no version this transaction observes.
 */
export async function recalculateStorageUsage({
  container,
  input,
}: ServiceArgs<RecalculateStorageUsageInput>): Promise<RecalculatedStorageUsageView> {
  const actorUserId = UserId.create(input.userId);
  if (input.subjectType === "user") {
    if (input.subjectId !== actorUserId) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InsufficientRole,
        "Not allowed to recalculate this subject",
      );
    }
  } else {
    const access = await resolveWorkspaceAccess({
      container,
      input: { workspaceId: input.subjectId, userId: input.userId },
    });
    if (access.role === null) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InsufficientRole,
        "Not allowed to recalculate this subject",
      );
    }
  }

  const owner =
    input.subjectType === "user"
      ? StorageOwner.user(UserId.create(input.subjectId))
      : StorageOwner.workspace(WorkspaceId.create(input.subjectId));
  const noteOwner =
    owner.type === "user"
      ? NoteOwner.user(owner.userId)
      : NoteOwner.workspace(owner.workspaceId);
  const scope =
    owner.type === "user"
      ? ScopeKey.user(owner.userId)
      : ScopeKey.workspace(owner.workspaceId);
  const subject = QuotaSubject.fromStorageOwner(owner);
  const now = container.clock.now();

  return container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    await ctx.cleanupAdmission.assertWritable();
    await ctx.cleanupAdmission.assertActorWritable(actorUserId);
    await ctx.workspaceOperationLockStore.assertWritable();
    if (owner.type === "workspace") {
      const membership = await ctx.membershipRepository.findByWorkspaceAndUser(
        owner.workspaceId,
        actorUserId,
      );
      if (membership === null) {
        throw new BusinessRuleError(
          WorkspaceErrorCode.InsufficientRole,
          "Not allowed to recalculate this subject",
        );
      }
    }

    const [consumedBytes, noteCount] = await Promise.all([
      ctx.storedFileRepository.sumSizeByOwner(owner),
      ctx.noteRepository.countByOwner(noteOwner, "all"),
    ]);
    const totals = { consumedBytes, noteCount };

    const stored = await ctx.storageQuotaRepository.find(subject);
    if (stored === null) {
      // A subject's first stocktake starts from no row at all: the
      // aggregate is materialized on first consumption, and a subject
      // that has never consumed anything is read from its initialized
      // values rather than persisted (`getUsageSnapshot`).
      await ctx.storageQuotaRepository.insert(
        StorageQuota.replaceTotals(
          StorageQuota.initialize(subject, now),
          totals,
          now,
        ),
      );
    } else {
      await ctx.storageQuotaRepository.save(
        StorageQuota.replaceTotals(stored.entity, totals, now),
        stored.expectedVersion,
      );
    }

    return totals;
  });
}
