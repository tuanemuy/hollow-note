import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * P-14 の読み取り（ED-10）。所有者は `workspaceId` 1 つで表す（`null` が
 * 個人）— `NoteList/action.ts` と同じ理由で、`cache()` の同一性が引数の
 * 参照で決まるため文脈オブジェクトをそのまま渡さない。
 *
 * 文脈の型は一覧（`NoteListOwner`）を共有する。ゴミ箱は「現在の文脈の
 * ノートを並べる画面」であり、必要な情報（名前・書き込み可否）も一覧と
 * 同じなので、同じ形の 2 つ目を作らない。
 */
export const loadTrashedNotes = cache(
  serverData(
    () => import("@repo/core/application/note/listTrashedNotes"),
    (
      { container },
      { listTrashedNotes },
      userId: string,
      workspaceId: string | null,
    ) =>
      listTrashedNotes({
        container,
        input:
          workspaceId === null
            ? { userId, ownerType: "user" }
            : { userId, ownerType: "workspace", ownerWorkspaceId: workspaceId },
      }),
  ),
);
