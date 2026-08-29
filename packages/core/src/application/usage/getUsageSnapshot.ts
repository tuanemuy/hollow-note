import { UserId } from "@repo/core/domain/identity/valueObject";
import { LlmUsage } from "@repo/core/domain/usage/llmUsage";
import { QuotaEnforcement } from "@repo/core/domain/usage/services/quotaEnforcement";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import {
  BillingPeriod,
  QuotaSubject,
} from "@repo/core/domain/usage/valueObject";
import type { UserWorkspaceEdge } from "@repo/core/domain/workspace/ports/userWorkspaceDirectory";
import type { WorkspaceDirectoryResolution } from "@repo/core/domain/workspace/ports/workspaceDirectoryBatchReader";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import {
  toLlmUsageView,
  type UsageSnapshotView,
  type WorkspaceUsageView,
} from "./view";

export type GetUsageSnapshotInput = Readonly<{
  userId: string;
  workspaceCursor?: string | null;
  workspaceLimit?: number;
}>;

/** Also the directory port's maximum page size. */
const DEFAULT_WORKSPACE_LIMIT = 20;

/**
 * Ceiling on the scope fan-out of one page
 * (spec/usecases/usage.md#getusagesnapshot 手順 3). Twenty scope objects
 * live on twenty different shards, so the width has to be capped
 * somewhere; the spec puts it at six.
 */
const MAX_CONCURRENT_SCOPE_READS = 6;

/**
 * Roles whose members are shown their workspace's usage. A `viewer`
 * cannot add to a workspace's consumption, so the number would be a
 * figure they can neither move nor act on.
 *
 * The filter runs here rather than in the directory read:
 * `UserWorkspaceDirectory.listActiveByUser` enumerates every active edge
 * of the user's shard and takes no role predicate, so a page may yield
 * fewer than `workspaceLimit` items while `nextWorkspaceCursor` still
 * advances past the whole page.
 */
const SHOWN_ROLES: ReadonlySet<string> = new Set(["owner", "editor"]);

/**
 * The directory contracts for one resolution per distinct input id, so a
 * missing key is a backend defect; degrading it keeps the screen
 * renderable (same reading as `listUserWorkspaces`).
 */
const UNRESOLVED: WorkspaceDirectoryResolution = {
  state: "unavailable",
  retryAfterSeconds: null,
};

async function mapBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await run(item);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

/**
 * Reads one workspace's figures from its own scope object.
 *
 * The `catch` is the per-row tolerance the spec asks for: a scope that
 * cannot answer degrades its own row to `unavailable` and leaves the
 * personal section and the other workspaces intact. It is deliberately
 * the only broad catch in this usecase.
 */
async function readWorkspaceUsage(
  container: RequestContainer,
  workspaceId: WorkspaceId,
  workspaceName: string,
): Promise<WorkspaceUsageView> {
  const subject = QuotaSubject.workspace(workspaceId);
  try {
    const stored = await container
      .usageReaderFor(ScopeKey.workspace(workspaceId))
      .storageQuota.find(subject);
    const quota =
      stored?.entity ?? StorageQuota.initialize(subject, container.clock.now());
    return {
      state: "available",
      workspaceId,
      workspaceName,
      consumedBytes: quota.consumedBytes,
      limitBytes: quota.quota.limit,
      noteCount: quota.noteCount,
      level: StorageQuota.warningLevel(quota),
    };
  } catch (cause) {
    container.logger.error("[getUsageSnapshot] workspace scope unreadable", {
      cause,
      workspaceId,
    });
    return { state: "unavailable", workspaceId, workspaceName };
  }
}

async function listWorkspaceUsage(
  container: RequestContainer,
  edges: readonly UserWorkspaceEdge[],
): Promise<readonly WorkspaceUsageView[]> {
  if (edges.length === 0) {
    return [];
  }
  const resolved = await container.workspaceDirectoryBatchReader.resolveMany([
    ...new Set(edges.map((edge) => edge.workspaceId)),
  ]);

  const targets: { workspaceId: WorkspaceId; workspaceName: string }[] = [];
  const degraded: WorkspaceUsageView[] = [];
  for (const edge of edges) {
    const resolution = resolved.get(edge.workspaceId) ?? UNRESOLVED;
    switch (resolution.state) {
      case "deleted":
        break;
      case "unavailable":
        degraded.push({
          state: "unavailable",
          workspaceId: edge.workspaceId,
          workspaceName: null,
        });
        break;
      case "active":
        targets.push({
          workspaceId: edge.workspaceId,
          workspaceName: resolution.entry.entity.name,
        });
        break;
    }
  }

  const read = await mapBounded(targets, MAX_CONCURRENT_SCOPE_READS, (target) =>
    readWorkspaceUsage(container, target.workspaceId, target.workspaceName),
  );

  const byId = new Map<string, WorkspaceUsageView>(
    [...read, ...degraded].map((item) => [item.workspaceId, item]),
  );
  return edges.flatMap((edge) => {
    const item = byId.get(edge.workspaceId);
    return item === undefined ? [] : [item];
  });
}

/**
 * Reads the viewer's own usage for the settings screen (UC-usage-001,
 * spec/usecases/usage.md#getusagesnapshot).
 *
 * Opens no unit of work: a missing quota / LLM row is answered with its
 * initialized values and is deliberately **not** created, so opening the
 * screen never becomes a write path. The same rule holds for a workspace
 * that has never consumed anything.
 *
 * The workspace section is one keyset page of the global
 * `membership_directory`, narrowed to the roles the figures mean
 * something to, resolved for display through the directory batch read and
 * then fanned out to at most twenty workspace scope objects, six at a
 * time. `updatedAt` describes the viewer's own records only — a workspace
 * row belongs to a page, and folding its timestamp in would make the
 * screen's "as of" jump as the reader pages.
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
  const [storedQuota, storedLlm, edgePage] = await Promise.all([
    reader.storageQuota.find(subject),
    reader.llmUsage.find(userId, period),
    container.userWorkspaceDirectory.listActiveByUser(
      userId,
      input.workspaceCursor ?? null,
      input.workspaceLimit ?? DEFAULT_WORKSPACE_LIMIT,
    ),
  ]);

  const storage = storedQuota?.entity ?? StorageQuota.initialize(subject, now);
  const llm = storedLlm?.entity ?? LlmUsage.initialize(userId, period, now);
  const described = QuotaEnforcement.describe({ storage, llm });

  const workspaces = await listWorkspaceUsage(
    container,
    edgePage.items.filter((edge) => SHOWN_ROLES.has(edge.role)),
  );

  return {
    personal: described.storage,
    // `describe` encodes "no LLM record" as `llm: null`, but absence is
    // already resolved above into the initialized period, so the DTO
    // projects that entity instead of carrying a null the screen has no
    // meaning for.
    llm: toLlmUsageView(llm),
    workspaces,
    nextWorkspaceCursor: edgePage.nextCursor,
    updatedAt:
      storage.updatedAt > llm.updatedAt ? storage.updatedAt : llm.updatedAt,
  };
}
