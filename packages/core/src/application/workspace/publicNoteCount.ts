import { NoteOwner } from "@repo/core/domain/note/valueObject";
import type { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import { ScopeKey } from "../scope";

const COUNT_PAGE_LIMIT = 100;

/**
 * Public notes the workspace owns, for the "your page is empty" hint.
 *
 * Read from the workspace scope rather than the global public projection:
 * nothing projects a note's publication into the search read model yet, so
 * `PublicNoteQueryService.searchPublic` — the canonical source — would
 * answer 0 for every workspace. The scope holds the authoritative
 * visibility of every note it owns, so this number is exact; what it does
 * not yet match is the projection the public page renders from. Swap it
 * for `searchPublic` once note publication reaches that projection.
 *
 * The walk is unbounded in the workspace's note count by construction —
 * it is a count, not a page — which is the other reason to leave it
 * behind the moment the read model can answer.
 */
export async function countPublicNotes(
  container: RequestContainer,
  workspaceId: WorkspaceId,
): Promise<number> {
  const reader = container.noteReaderFor(ScopeKey.workspace(workspaceId));
  const owner = NoteOwner.workspace(workspaceId);
  let publicNotes = 0;
  let page = 1;
  for (;;) {
    const result = await reader.listByOwner(owner, "active", {
      page,
      limit: COUNT_PAGE_LIMIT,
    });
    publicNotes += result.items.filter(
      (note) => note.visibility.status === "public",
    ).length;
    if (page * COUNT_PAGE_LIMIT >= result.count) {
      return publicNotes;
    }
    page += 1;
  }
}
