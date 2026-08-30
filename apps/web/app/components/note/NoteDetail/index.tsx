import type { NoteDetailView } from "@repo/core/application/note/view";
import { NotFoundState } from "@/components/ui/ErrorState";
import { serializeError } from "@/presentation/errorResponse";
import { NoteBody } from "../NoteBody";
import {
  loadNote,
  type NoteDetailContext,
  PERSONAL_NOTE_DETAIL_CONTEXT,
} from "./action";
import { NoteDetailMenu } from "./menu";
import { NoteUrlNormalizer } from "./normalize";

/**
 * P-11 ノート詳細（最小形、モック P11-note.html）。本文の Shadow DOM
 * 描画・タイトル・公開ステータス・見出しの折りたたみと、編集できる閲覧者
 * だけに出す操作メニュー（移動）を持つ。タグ・共有パネル・ダウンロードは
 * 後続スライス。
 *
 * 個人（`/notes/:noteId`）とワークスペース
 * （`/workspaces/:workspaceId/notes/:noteId`）で同じ画面。文脈は呼び出し側
 * が URL から渡し、ノートの所属先と食い違えば正規な URL へ送り直す
 * （OR-12）。
 */
export async function NoteDetail({
  noteId,
  userId,
  context = PERSONAL_NOTE_DETAIL_CONTEXT,
}: {
  noteId: string;
  userId: string;
  context?: NoteDetailContext;
}) {
  // The not-found verdict is resolved inside the fragment: an error
  // thrown here would cross the Flight stream as a plain Error and lose
  // its kind tag before the route error boundary could classify it.
  // Anything that is not the access verdict stays thrown (generic retry).
  let note: NoteDetailView;
  try {
    note = await loadNote(noteId, userId);
  } catch (error) {
    if (serializeError(error).kind === "notFound") {
      return <NotFoundState />;
    }
    throw error;
  }

  const canonicalWorkspaceId =
    note.ownerType === "workspace" ? note.ownerId : null;
  const currentWorkspaceId =
    context.kind === "workspace" ? context.workspaceId : null;

  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 pt-10 pb-16 sm:px-6">
      {canonicalWorkspaceId === currentWorkspaceId ? null : (
        <NoteUrlNormalizer
          noteId={note.noteId}
          workspaceId={canonicalWorkspaceId}
        />
      )}
      <div className="mb-4 flex flex-wrap items-start gap-2 text-xs text-ink-tertiary">
        <VisibilityBadge visibility={note.visibility} />
        <span className="text-hairline-strong">·</span>
        <span>{createdAtFormat.format(note.createdAt)}</span>
        <span className="min-w-2 flex-1" />
        {note.permissions.canEdit ? (
          <NoteDetailMenu
            noteId={note.noteId}
            ownerType={note.ownerType}
            ownerId={note.ownerId}
          />
        ) : null}
      </div>

      <h1 className="mb-8 text-3xl font-normal tracking-tightest leading-[1.18]">
        {note.title}
      </h1>

      <NoteContentBlock note={note} />
    </main>
  );
}

const createdAtFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const VISIBILITY_META: Record<
  NoteDetailView["visibility"],
  { label: string; dotClass: string }
> = {
  private: { label: "非公開", dotClass: "bg-status-private" },
  unlisted: { label: "リンクを知る人", dotClass: "bg-status-link" },
  public: { label: "公開", dotClass: "bg-status-public" },
};

function VisibilityBadge({
  visibility,
}: {
  visibility: NoteDetailView["visibility"];
}) {
  const meta = VISIBILITY_META[visibility];
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`inline-block size-1.5 rounded-full ${meta.dotClass}`}
      />
      <span>{meta.label}</span>
    </span>
  );
}

function NoteContentBlock({ note }: { note: NoteDetailView }) {
  switch (note.content.status) {
    case "ready":
      return note.content.html !== null && note.content.html.length > 0 ? (
        <NoteBody
          html={note.content.html}
          styleMode={note.styleMode}
          headings={note.headings}
        />
      ) : (
        <p className="text-sm text-ink-secondary">このノートは白紙です。</p>
      );
    case "processing":
    case "awaitingIntegration":
      return (
        <p className="text-sm text-ink-secondary" role="status">
          本文を準備しています。完了するとここに表示されます。
        </p>
      );
    case "failed":
      return (
        <p className="text-sm text-error" role="status">
          このファイルを取り込めませんでした。
        </p>
      );
  }
}
