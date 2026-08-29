import { BusinessRuleError } from "@repo/core/domain/error";
import {
  type WorkspaceId,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { workspaceNotFound } from "./resolveWorkspaceAccess";
import { type PublicWorkspaceView, toPublicWorkspaceView } from "./view";

export type GetPublicWorkspaceInput = Readonly<{
  slug: string;
}>;

/**
 * A malformed slug is indistinguishable from an unused one for this
 * page: both mean "no public workspace lives here". Surfacing the
 * domain's `InvalidSlug` instead would answer a question the visitor did
 * not ask and split one not-found into two responses.
 */
const parseSlug = (raw: string): WorkspaceSlug | null => {
  try {
    return WorkspaceSlug.create(raw);
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return null;
    }
    throw error;
  }
};

/**
 * Reads a published workspace by its public slug (UC-workspace-020,
 * spec/usecases/workspace.md#getpublicworkspace).
 *
 * Slug → workspace goes through the global reservation, which resolves
 * only `active` rows, so a create or a rename still in flight answers
 * not-found rather than a half-switched URL. The directory then gates on
 * publication, and the scope object supplies the columns the projection
 * does not carry (the description).
 *
 * Every failure — malformed slug, unknown slug, private, deleted —
 * collapses into the same `WORKSPACE_NOT_FOUND`, so the page never
 * becomes an oracle for which workspaces exist privately.
 */
export async function getPublicWorkspace({
  container,
  input,
}: ServiceArgs<GetPublicWorkspaceInput>): Promise<PublicWorkspaceView> {
  const slug = parseSlug(input.slug);
  if (slug === null) {
    throw workspaceNotFound();
  }

  const workspaceId =
    await container.workspaceSlugReservationStore.resolveActive(slug);
  if (workspaceId === null) {
    throw workspaceNotFound();
  }

  const projectedVersion = await publishedProjectionVersion(
    container,
    workspaceId,
  );

  const reader = container.workspaceReaderFor(ScopeKey.workspace(workspaceId));
  const first = await reader.workspace.findById(workspaceId);
  // The projection is written after the scope commit, so a scope read
  // older than the projection that gated it lost a race and is re-read
  // once rather than answering with a state the directory has moved past.
  const stored =
    projectedVersion !== null &&
    (first === null || first.entity.version < projectedVersion)
      ? await reader.workspace.findById(workspaceId)
      : first;

  const workspace = stored?.entity ?? null;
  if (
    workspace === null ||
    workspace.lifecycle.state !== "active" ||
    !Workspace.isPublished(workspace)
  ) {
    throw workspaceNotFound();
  }
  return toPublicWorkspaceView(workspace);
}

/**
 * The projection's source version when the directory can vouch for the
 * workspace being published, `null` when it has no current answer — an
 * `unavailable` shard leaves the scope read as the only authority, which
 * it is anyway. A `deleted` verdict is durable and ends the lookup here.
 */
async function publishedProjectionVersion(
  container: ServiceArgs<GetPublicWorkspaceInput>["container"],
  workspaceId: WorkspaceId,
): Promise<number | null> {
  const resolved = await container.workspaceDirectoryBatchReader.resolveMany([
    workspaceId,
  ]);
  const resolution = resolved.get(workspaceId);
  if (resolution === undefined || resolution.state === "unavailable") {
    return null;
  }
  if (
    resolution.state === "deleted" ||
    resolution.entry.entity.publication !== "published"
  ) {
    throw workspaceNotFound();
  }
  return resolution.entry.expectedVersion;
}
