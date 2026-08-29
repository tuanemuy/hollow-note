import type { ServiceArgs } from "../types";
import type { PublicWorkspaceListView } from "./view";

export type ListPublicWorkspacesInput = Readonly<{
  cursor?: string | null;
  limit?: number;
}>;

const DEFAULT_LIMIT = 100;

/**
 * Enumerates published workspaces for sitemap generation
 * (UC-workspace-019, spec/usecases/workspace.md#listpublicworkspaces).
 *
 * No total count at any width: the generator iterates `nextCursor` until
 * it is `null`, which is the only signal the enumeration is exhausted.
 * A shard that cannot be read fails the whole call rather than returning
 * a short page — a truncated sitemap is indistinguishable from a
 * complete one.
 *
 * `limit` (1–200) and the cursor are validated by the directory port.
 */
export async function listPublicWorkspaces({
  container,
  input,
}: ServiceArgs<ListPublicWorkspacesInput>): Promise<PublicWorkspaceListView> {
  const page = await container.publicWorkspaceDirectoryReader.listPublished(
    input.cursor ?? null,
    input.limit ?? DEFAULT_LIMIT,
  );
  return {
    entries: page.items.map((entry) => ({
      slug: entry.slug,
      updatedAt: entry.updatedAt,
    })),
    nextCursor: page.nextCursor,
    hasMore: page.nextCursor !== null,
  };
}
