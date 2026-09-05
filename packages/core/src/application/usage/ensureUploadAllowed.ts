import { UserId } from "@repo/core/domain/identity/valueObject";
import { QuotaEnforcement } from "@repo/core/domain/usage/services/quotaEnforcement";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import {
  BillingPeriod,
  QuotaSubject,
} from "@repo/core/domain/usage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";

export type EnsureUploadAllowedInput = Readonly<{
  subjectType: "user" | "workspace";
  subjectId: string;
  userId: string;
  totalBytes: number;
  llmCalls: number;
}>;

/**
 * Confirms a subject has room for an upload, before any byte is written.
 *
 * Reads only, so it opens no unit of work and callers run it *outside*
 * theirs — the intake usecases of Storage have to know the answer long
 * before the transaction that records the file, and nesting `run` is
 * forbidden either way.
 *
 * An absent `StorageQuota` row is judged at `StorageQuota.initialize`'s
 * values without creating one: the row is written by the first delta, and
 * reading absence as exhaustion would refuse every new subject's first
 * upload. The LLM half is read only when it is asked about, and its
 * absence stays `null` so `QuotaEnforcement` applies the same
 * "no call yet this month" reading.
 */
export async function ensureUploadAllowed({
  container,
  input,
}: ServiceArgs<EnsureUploadAllowedInput>): Promise<void> {
  const subject =
    input.subjectType === "user"
      ? QuotaSubject.user(UserId.create(input.subjectId))
      : QuotaSubject.workspace(WorkspaceId.create(input.subjectId));
  const scope =
    subject.type === "user"
      ? ScopeKey.user(subject.userId)
      : ScopeKey.workspace(subject.workspaceId);

  const now = container.clock.now();
  const stored = await container
    .usageReaderFor(scope)
    .storageQuota.find(subject);
  const storage = stored?.entity ?? StorageQuota.initialize(subject, now);

  // The allowance is the requester's own, not the subject's: a workspace
  // upload still spends the member's monthly calls.
  const userId = UserId.create(input.userId);
  const llm =
    input.llmCalls > 0
      ? ((
          await container
            .usageReaderFor(ScopeKey.user(userId))
            .llmUsage.find(userId, BillingPeriod.of(now))
        )?.entity ?? null)
      : null;

  QuotaEnforcement.ensureUploadAllowed({
    storage,
    llm,
    totalBytes: input.totalBytes,
    llmCalls: input.llmCalls,
  });
}
