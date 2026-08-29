import type { WorkspaceRepository } from "../../../../domain/workspace/ports/workspaceRepository";
import type { WorkspaceId } from "../../../../domain/workspace/valueObject";
import { Workspace } from "../../../../domain/workspace/workspace";
import {
  date,
  dateOrNull,
  int,
  text,
  textOrNull,
  toTimestamp,
} from "../../sql/row";
import type { SqlSession } from "../../sql/session";
import type { SqlRow } from "../../sql/statement";
import { SCOPE_TABLES } from "../schema";
import { createAggregateStore } from "./workspaceAggregate";

const TABLE = SCOPE_TABLES.workspaces;

const COLUMNS = [
  "id",
  "name",
  "description",
  "avatar_url",
  "slug",
  "publication",
  "published_at",
  "lifecycle",
  "deletion_operation_id",
  "version",
  "created_at",
  "updated_at",
] as const;

const toRow = (workspace: Workspace): SqlRow => ({
  id: workspace.id,
  name: workspace.name,
  description: workspace.description,
  avatar_url: workspace.avatarUrl,
  slug: workspace.slug,
  publication: workspace.publication,
  published_at: Workspace.isPublished(workspace)
    ? toTimestamp(workspace.publishedAt)
    : null,
  lifecycle: workspace.lifecycle.state,
  deletion_operation_id:
    workspace.lifecycle.state === "deleting"
      ? workspace.lifecycle.operationId
      : null,
  version: workspace.version,
  created_at: toTimestamp(workspace.createdAt),
  updated_at: toTimestamp(workspace.updatedAt),
});

const fromRow = (row: SqlRow): Workspace =>
  Workspace.reconstruct({
    id: text(row, "id"),
    name: text(row, "name"),
    description: text(row, "description"),
    avatarUrl: textOrNull(row, "avatar_url"),
    slug: textOrNull(row, "slug"),
    publication: text(row, "publication"),
    publishedAt: dateOrNull(row, "published_at"),
    lifecycleState: text(row, "lifecycle"),
    deletionOperationId: textOrNull(row, "deletion_operation_id"),
    version: int(row, "version"),
    createdAt: date(row, "created_at"),
    updatedAt: date(row, "updated_at"),
  });

/** `workspaces` of one scope object (`spec/database/index.md#workspaces`). */
export function createCloudflareWorkspaceRepository(
  deps: Readonly<{ session: SqlSession }>,
): WorkspaceRepository {
  return createAggregateStore<Workspace, WorkspaceId>(deps.session, {
    table: TABLE,
    columns: COLUMNS,
    toRow,
    fromRow,
  });
}
