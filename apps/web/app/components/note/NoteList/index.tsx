import type { NoteListItemView } from "@repo/core/application/note/view";
import { CreateNoteButton } from "../CreateNoteButton";
import { loadNotes } from "./action";
import { NoteListBoard, type NoteRowView } from "./board";

/**
 * P-10 ノート一覧（最小形、モック P10-notes.html / P10-notes-empty.html）。
 * タイトル・公開ステータスドット・更新時刻と、新規作成・ノートごとの
 * 操作メニュー（移動）を持つ。検索・絞り込み・選択モード・アップロードは
 * 後続スライス。
 *
 * 行の描画と移動の実行は `NoteListBoard` が所有する。ここが持つのは
 * 見出し・件数・空状態と、日時の整形（サーバーのタイムゾーンで 1 度だけ
 * 決める）である。
 */
export async function NoteList({ userId }: { userId: string }) {
  const { items, count } = await loadNotes(userId);

  return (
    <main className="mx-auto max-w-[var(--list-max)] px-4 pt-8 pb-20 sm:px-6 sm:pt-10 lg:pt-16">
      <div className="mb-6">
        <h1 className="text-3xl font-light tracking-tightest leading-tight">
          個人
        </h1>
        <p className="mt-2 text-sm text-ink-tertiary">{count} 件のノート</p>
      </div>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <CreateNoteButton variant="toolbar" />
          </div>
          <NoteListBoard rows={items.map(toNoteRowView)} />
        </>
      )}
    </main>
  );
}

function toNoteRowView(item: NoteListItemView): NoteRowView {
  const visibility = VISIBILITY_META[item.visibility];
  return {
    noteId: item.noteId,
    title: item.title,
    visibilityLabel: visibility.label,
    visibilityDotClass: visibility.dotClass,
    updatedLabel: formatUpdatedAt(item.updatedAt),
    dateLabel: dateFormat.format(item.updatedAt),
  };
}

const VISIBILITY_META: Record<
  NoteListItemView["visibility"],
  { label: string; dotClass: string }
> = {
  private: { label: "非公開", dotClass: "bg-status-private" },
  unlisted: { label: "リンクを知る人に公開", dotClass: "bg-status-link" },
  public: { label: "公開", dotClass: "bg-status-public" },
};

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

function formatUpdatedAt(updatedAt: Date): string {
  return `${dateFormat.format(updatedAt)} ${timeFormat.format(updatedAt)}`;
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-hairline-strong px-6 py-12 text-center">
      <h2 className="text-lg font-semibold tracking-tight">
        最初のノートを作る
      </h2>
      <p className="mx-auto mt-3 max-w-[380px] text-sm text-ink-secondary">
        白紙のノートを作成すると、この一覧に追加されます。
      </p>
      <div className="mt-6 flex justify-center">
        <CreateNoteButton label="白紙から書く" />
      </div>
      {/* spec/pages/index.md#P-10: 空状態はパレットの存在を伝える唯一の
          場なので省略しない。パレット本体は後続スライスのため、案内は
          上部バーの disabled トリガーと同じ「準備中」の表記に留める
          （文言はモック P10-notes-empty.html の teach ブロックが正）。 */}
      <div className="mx-auto mt-8 max-w-[380px] rounded-lg bg-surface px-4 py-3 text-left">
        <p className="text-xs font-medium text-ink-secondary">キーボード操作</p>
        <p className="mt-2 flex items-start gap-2 text-sm text-ink-secondary">
          <kbd className="mt-px shrink-0 rounded-xs border border-hairline bg-bg px-1.5 py-px font-mono text-[10px] leading-[1.6] text-ink-secondary">
            ⌘K
          </kbd>
          <span>検索・絞り込み・アップロード（準備中）</span>
        </p>
      </div>
    </div>
  );
}
