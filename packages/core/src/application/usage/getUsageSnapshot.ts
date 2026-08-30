import { UserId } from "@repo/core/domain/identity/valueObject";
import { LlmUsage } from "@repo/core/domain/usage/llmUsage";
import { QuotaEnforcement } from "@repo/core/domain/usage/services/quotaEnforcement";
import { StorageQuota } from "@repo/core/domain/usage/storageQuota";
import {
  BillingPeriod,
  QuotaSubject,
} from "@repo/core/domain/usage/valueObject";
import type { UserWorkspaceEdge } from "@repo/core/domain/workspace/ports/userWorkspaceDirectory";
import type {
  WorkspaceId,
  WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { resolveWorkspaceEdges } from "../workspace/directoryResolution";
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
 * Ceiling on the scope fan-out of one page. Twenty scope objects live on
 * twenty different shards, so the width has to be capped somewhere.
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
const SHOWN_ROLES: ReadonlySet<WorkspaceRole> = new Set<WorkspaceRole>([
  "owner",
  "editor",
]);

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
 * The `try` holds the scope RPC and nothing else. That is what the
 * per-row tolerance is for: a scope that cannot answer degrades its own
 * row to `unavailable` and leaves the personal section and the other
 * workspaces intact. The derivation that follows is pure, so keeping it
 * outside is what makes a broken quota invariant fail the call instead
 * of arriving as one more `unavailable` row.
 */
async function readWorkspaceUsage(
  container: RequestContainer,
  workspaceId: WorkspaceId,
  workspaceName: string,
): Promise<WorkspaceUsageView> {
  const subject = QuotaSubject.workspace(workspaceId);
  const reader = container.usageReaderFor(ScopeKey.workspace(workspaceId));

  let stored: Awaited<ReturnType<typeof reader.storageQuota.find>>;
  try {
    stored = await reader.storageQuota.find(subject);
  } catch (cause) {
    container.logger.error("[getUsageSnapshot] workspace scope unreadable", {
      cause,
      workspaceId,
    });
    return { state: "unavailable", workspaceId, workspaceName };
  }

  const quota =
    stored?.entity ?? StorageQuota.initialize(subject, container.clock.now());
  return {
    state: "available",
    workspaceId,
    workspaceName,
    ...QuotaEnforcement.describe({ storage: quota, llm: null }).storage,
  };
}

/**
 * Projects one page of membership edges, in edge order. A row the
 * directory could not resolve carries no name: the display name comes
 * only from the directory, and `WorkspaceDirectoryBatchReader` contracts
 * that a shard it cannot read does *not* fail the call, so such an edge
 * is kept nameless rather than dropped.
 */
async function listWorkspaceUsage(
  container: RequestContainer,
  edges: readonly UserWorkspaceEdge[],
): Promise<readonly WorkspaceUsageView[]> {
  const rows = await resolveWorkspaceEdges(
    container.workspaceDirectoryBatchReader,
    edges,
  );
  return mapBounded(
    rows,
    MAX_CONCURRENT_SCOPE_READS,
    (row): Promise<WorkspaceUsageView> =>
      row.state === "active"
        ? readWorkspaceUsage(container, row.edge.workspaceId, row.entry.name)
        : Promise.resolve({
            state: "unavailable",
            workspaceId: row.edge.workspaceId,
            workspaceName: null,
          }),
  );
}

/**
 * Reads the viewer's own usage for the settings screen.
 *
 * Opens no unit of work: a missing quota / LLM row is answered with its
 * initialized values and is deliberately **not** created, so opening the
 * screen never becomes a write path. The same rule holds for a workspace
 * that has never consumed anything.
 *
 * The workspace section is one keyset page of the global
 * `membership_directory` in its `created_at DESC, workspace_id` order,
 * narrowed to the roles the figures mean something to, resolved for
 * display through the directory batch read and then fanned out to at most
 * twenty workspace scope objects, six at a time. `updatedAt` describes the
 * viewer's own records only — a workspace row belongs to a page, and
 * folding its timestamp in would make the screen's "as of" jump as the
 * reader pages.
 *
 * `workspaceLimit` / `workspaceCursor` are validated by the directory
 * port, which raises `ValidationError("INVALID_PAGINATION")` for a limit
 * outside 1–20, an unreadable cursor, or a retired routing generation.
 * `nextWorkspaceCursor` is the port's own opaque value, passed through
 * untouched.
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
    llm: toLlmUsageView(described.llm),
    workspaces,
    nextWorkspaceCursor: edgePage.nextCursor,
    updatedAt:
      storage.updatedAt > llm.updatedAt ? storage.updatedAt : llm.updatedAt,
  };
}
