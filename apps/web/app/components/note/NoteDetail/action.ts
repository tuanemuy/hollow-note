import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * 詳細を開いている URL の文脈（`/notes/:noteId` か
 * `/workspaces/:workspaceId/notes/:noteId` か）。ノートの所有先そのものは
 * `getNote` が返すので、これは「いま見ている URL が正規かどうか」を
 * 判定するためだけに使う（OR-12 の URL 正規化）。
 */
export type NoteDetailContext =
  | Readonly<{ kind: "personal" }>
  | Readonly<{ kind: "workspace"; workspaceId: string }>;

export const PERSONAL_NOTE_DETAIL_CONTEXT: NoteDetailContext = {
  kind: "personal",
};

/** P-11 の読み取り（UC-note-002）。閲覧者はセッションの利用者。 */
export const loadNote = cache(
  serverData(
    () => import("@repo/core/application/note/getNote"),
    ({ container }, { getNote }, noteId: string, userId: string) =>
      getNote({ container, input: { noteId, userId } }),
  ),
);
