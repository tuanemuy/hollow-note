import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * P-10 最小一覧の内部リード（walking skeleton の glue）。正規の searchNotes
 * （後続スライス）を先取りせず `listNotes` を読む薄い経路で、読み出しモデル
 * が載ったら置き換えられる。
 *
 * 所有者は `workspaceId` 1 つで表す（`null` が個人）。`NoteListOwner` を
 * そのまま渡さないのは `cache()` の同一性が引数の参照で決まるためで、
 * 同じ文脈を 2 度描いたときに読みが 2 回走らないようにしている。
 */
export const loadNotes = cache(
  serverData(
    () => import("@repo/core/application/note/listNotes"),
    (
      { container },
      { listNotes },
      userId: string,
      workspaceId: string | null,
    ) =>
      listNotes({
        container,
        input:
          workspaceId === null
            ? { userId }
            : { userId, ownerType: "workspace", ownerWorkspaceId: workspaceId },
      }),
  ),
);

/**
 * 一覧が描く文脈（spec/pages/index.md#P-10 は個人とワークスペースで同じ
 * 画面）。`canWrite` は editor 以上 — 新規作成と移動の可否だけを載せ、
 * ロール名は流さない（一覧はロールを表示しない）。
 */
export type NoteListOwner =
  | Readonly<{ kind: "personal" }>
  | Readonly<{
      kind: "workspace";
      workspaceId: string;
      name: string;
      canWrite: boolean;
    }>;

export const PERSONAL_NOTE_LIST_OWNER: NoteListOwner = { kind: "personal" };
