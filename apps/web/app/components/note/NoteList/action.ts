import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * P-10 最小一覧の内部リード（ADR-005 glue）。正規の listNotes /
 * searchNotes（後続スライス）を先取りせず `NoteRepository.listByOwner`
 * を読む薄い経路で、読み出しモデルが載ったら置き換えられる。
 */
export const loadNotes = cache(
  serverData(
    () => import("@repo/core/application/note/listNotes"),
    ({ container }, { listNotes }, userId: string) =>
      listNotes({ container, input: { userId } }),
  ),
);
