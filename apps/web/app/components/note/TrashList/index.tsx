import type { TrashedNoteListItemView } from "@repo/core/application/note/view";
import { Alert } from "@/components/ui/Alert";
import {
  type NoteListOwner,
  PERSONAL_NOTE_LIST_OWNER,
} from "../NoteList/action";
import { loadTrashedNotes } from "./action";
import { TrashBoard, type TrashRowView } from "./board";

/**
 * P-14 ゴミ箱（PAGE-p14-001〜004、モック P14-trash.html）。削除日時の
 * 新しい順の一覧・残り日数・個別の復元 / 完全削除・「ゴミ箱を空にする」・
 * 空状態・権限なしを持つ。
 *
 * 個人（`/notes/trash`）とワークスペース
 * （`/workspaces/:workspaceId/notes/trash`）で同じ画面。文脈は呼び出し側
 * が渡す — 正本は URL なので画面が自分で決めることはしない。
 *
 * 行の描画と復元・完全削除の実行は `TrashBoard` が所有する。ここが持つのは
 * 権限の判定と、日時・残り日数の整形（サーバーのタイムゾーンと時計で
 * 1 度だけ決める）である。
 */
export async function TrashList({
  userId,
  owner = PERSONAL_NOTE_LIST_OWNER,
}: {
  userId: string;
  owner?: NoteListOwner;
}) {
  const canOpen = owner.kind === "personal" || owner.canWrite;

  // viewer は `viewTrash`（最小ロール editor）を満たさないので読みに行か
  // ない。断片の中で `InsufficientRole` を投げると Flight ストリームを
  // 素の Error が渡って kind を失うため、ここで畳む（`NoteDetail` の
  // not-found と同じ理由）。
  if (!canOpen) {
    return (
      <main className={pageClass}>
        <h1 className="mb-6 text-3xl font-light tracking-tightest leading-tight">
          ゴミ箱
        </h1>
        <Alert
          tone="warning"
          title="ゴミ箱を開く権限がありません"
          role="status"
        >
          このワークスペースのゴミ箱は owner と editor だけが開けます。
        </Alert>
      </main>
    );
  }

  const { items } = await loadTrashedNotes(
    userId,
    owner.kind === "personal" ? null : owner.workspaceId,
  );
  const now = Date.now();

  return (
    <main className={pageClass}>
      <TrashBoard
        rows={items.map((item) => toTrashRowView(item, now))}
        workspaceId={owner.kind === "personal" ? null : owner.workspaceId}
      />
    </main>
  );
}

const pageClass =
  "mx-auto max-w-[var(--list-max)] px-4 pt-8 pb-20 sm:px-6 sm:pt-10 lg:pt-16";

const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
});

function toTrashRowView(
  item: TrashedNoteListItemView,
  now: number,
): TrashRowView {
  // 保持期限は `purgeAfter`（ドメインの `TRASH_RETENTION_MS` 由来）から
  // 数える。画面が 30 日を足し直すと、保持期間を変えたときに表示だけが
  // 古い値のまま残る。切り上げるのは「残り 0 日」を期限当日ではなく期限
  // 到来の意味に取っておくため。
  const remainingDays = Math.max(
    0,
    Math.ceil((item.purgeAfter.getTime() - now) / DAY_MS),
  );
  return {
    noteId: item.noteId,
    title: item.title,
    version: item.version,
    trashedLabel: dateFormat.format(item.trashedAt),
    remainingLabel: `残り ${remainingDays} 日`,
  };
}
