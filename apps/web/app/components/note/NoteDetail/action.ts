import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/** P-11 の読み取り（UC-note-002）。閲覧者はセッションの利用者。 */
export const loadNote = cache(
  serverData(
    () => import("@repo/core/application/note/getNote"),
    ({ container }, { getNote }, noteId: string, userId: string) =>
      getNote({ container, input: { noteId, userId } }),
  ),
);
