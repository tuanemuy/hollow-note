import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import { ScopeKey } from "../scope";
import type { ServiceArgs } from "../types";
import { type NoteListView, toNoteListItemView } from "./view";

export type ListNotesInput = Readonly<{
  userId: string;
  page?: number;
  limit?: number;
}>;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Minimal internal read of the viewer's own active notes for the
 * walking-skeleton note list (ADR-005 glue). This deliberately does NOT
 * preempt the canonical `searchNotes` / query-service listing of a later
 * slice: it reads straight through `NoteRepository.listByOwner` on the
 * personal scope and will be replaced when the read model lands.
 */
export async function listNotes({
  container,
  input,
}: ServiceArgs<ListNotesInput>): Promise<NoteListView> {
  const userId = UserId.create(input.userId);
  const reader = container.noteReaderFor(ScopeKey.user(userId));
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(input.page ?? 1, 1);
  const result = await reader.listByOwner(NoteOwner.user(userId), "active", {
    page,
    limit,
  });
  return {
    items: result.items.map(toNoteListItemView),
    count: result.count,
  };
}
