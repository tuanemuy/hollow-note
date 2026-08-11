import { UserId } from "@repo/core/domain/identity/valueObject";
import { LlmUsage } from "@repo/core/domain/usage/llmUsage";
import { QuotaEnforcement } from "@repo/core/domain/usage/services/quotaEnforcement";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import {
  BillingPeriod,
  QuotaSubject,
} from "@repo/core/domain/usage/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { toLlmUsageView, type UsageSnapshotView } from "./view";

export type GetUsageSnapshotInput = Readonly<{
  userId: string;
}>;

/**
 * Reads the viewer's own usage for the settings screen (UC-usage-001,
 * spec/usecases/usage.md#getusagesnapshot).
 *
 * Opens no unit of work: a missing quota / LLM row is answered with its
 * initialized values and is deliberately **not** created, so opening the
 * screen never becomes a write path.
 *
 * The workspace section is always empty and the input carries no cursor
 * (ADR-051): enumerating memberships and resolving workspace names needs
 * ports this slice does not have.
 */
export async function getUsageSnapshot({
  container,
  input,
}: ServiceArgs<GetUsageSnapshotInput>): Promise<UsageSnapshotView> {
  const userId = UserId.create(input.userId);
  const now = container.clock.now();
  const subject = QuotaSubject.user(userId);
  const period = BillingPeriod.of(now);

  const reader = container.usageReaderFor(ScopeKey.user(userId));
  const [storedQuota, storedLlm] = await Promise.all([
    reader.storageQuota.find(subject),
    reader.llmUsage.find(userId, period),
  ]);

  const storage = storedQuota?.entity ?? StorageQuota.initialize(subject, now);
  const llm = storedLlm?.entity ?? LlmUsage.initialize(userId, period, now);
  const described = QuotaEnforcement.describe({ storage, llm });

  return {
    personal: described.storage,
    // `describe` encodes "no LLM record" as `llm: null`, but absence is
    // already resolved above into the initialized period, so the DTO
    // projects that entity instead of carrying a null the screen has no
    // meaning for.
    llm: toLlmUsageView(llm),
    workspaces: [],
    updatedAt:
      storage.updatedAt > llm.updatedAt ? storage.updatedAt : llm.updatedAt,
  };
}
