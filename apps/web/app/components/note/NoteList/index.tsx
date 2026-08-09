import type { NoteListItemView } from "@repo/core/application/note/view";
import { Link } from "@tanstack/react-router";
import { CreateNoteButton } from "../CreateNoteButton";
import { loadNotes } from "./action";

/**
 * P-10 ノート一覧（最小形、モック P10-notes.html / P10-notes-empty.html）。
 * タイトル・公開ステータスドット・更新時刻と、新規作成の導線だけを持つ。
 * 検索・絞り込み・選択モード・アップロードは後続スライス。
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
          <section aria-label="ノート">
            {items.map((item) => (
              <NoteListItem key={item.noteId} item={item} />
            ))}
          </section>
        </>
      )}
    </main>
  );
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

function NoteListItem({ item }: { item: NoteListItemView }) {
  const visibility = VISIBILITY_META[item.visibility];
  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: item.noteId }}
      className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-md px-2 py-3 transition-colors hover:bg-surface-elevated"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block size-1.5 shrink-0 rounded-full ${visibility.dotClass}`}
          />
          <span className="min-w-0 truncate text-md tracking-tight">
            {item.title}
          </span>
        </span>
        <span className="mt-1 block text-xs text-ink-tertiary">
          <span className="sr-only">{visibility.label}。</span>
          更新 {formatUpdatedAt(item.updatedAt)}
        </span>
      </span>
      <span className="text-xs whitespace-nowrap text-ink-tertiary tabular-nums">
        {dateFormat.format(item.updatedAt)}
      </span>
    </Link>
  );
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
    </div>
  );
}
