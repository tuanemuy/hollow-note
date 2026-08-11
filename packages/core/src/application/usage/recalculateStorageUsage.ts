import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { StorageOwner } from "@repo/core/domain/storage/valueObject";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import { QuotaSubject } from "@repo/core/domain/usage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
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
 * by a member (ADR-052).
 */
export async function recalculateStorageUsage({
  container,
  input,
}: ServiceArgs<RecalculateStorageUsageInput>): Promise<RecalculatedStorageUsageView> {
  const actorUserId = UserId.create(input.userId);
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

    const [consumedBytes, noteCount] = await Promise.all([
      ctx.storedFileRepository.sumSizeByOwner(owner),
      ctx.noteRepository.countByOwner(noteOwner, "all"),
    ]);
    const totals = { consumedBytes, noteCount };

    const stored = await ctx.storageQuotaRepository.find(subject);
    if (stored === null) {
      // No `initializeQuota` subscriber exists yet, so a stocktake is
      // also the path that first materializes the row.
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
