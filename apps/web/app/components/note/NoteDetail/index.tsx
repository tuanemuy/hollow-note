import type { NoteDetailView } from "@repo/core/application/note/view";
import { NotFoundState } from "@/components/ui/ErrorState";
import { serializeError } from "@/presentation/errorResponse";
import {
  loadNote,
  type NoteDetailContext,
  PERSONAL_NOTE_DETAIL_CONTEXT,
} from "./action";
import { NoteDetailIsland } from "./detail";
import { NoteUrlNormalizer } from "./normalize";

/**
 * P-11 ノート詳細（モック P11-note.html）。本文の Shadow DOM 描画・
 * タイトルのインライン編集・公開ステータス・見出しの折りたたみと、編集
 * できる閲覧者だけに出す操作メニュー（編集・表示スタイル・移動・削除）を
 * 持つ。タグ・共有パネル・ダウンロード・再生成は後続スライス。
 *
 * 個人（`/notes/:noteId`）とワークスペース
 * （`/workspaces/:workspaceId/notes/:noteId`）で同じ画面。文脈は呼び出し側
 * が URL から渡し、ノートの所属先と食い違えば正規な URL へ送り直す
 * （OR-12）。
 *
 * 読み取りと終端状態（見つかりません）だけをここが持ち、操作は島
 * （`detail.tsx`）が持つ。版を握る場所を 1 つにするためで、分けると
 * タイトルの自動保存と表示スタイルの切替が互いに古い版を送る。
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
      <NoteDetailIsland
        noteId={note.noteId}
        initialTitle={note.title}
        initialVersion={note.version}
        initialStyleMode={note.styleMode}
        visibility={note.visibility}
        createdAtLabel={createdAtFormat.format(note.createdAt)}
        content={note.content}
        headings={note.headings}
        ownerType={note.ownerType}
        ownerId={note.ownerId}
        canEdit={note.permissions.canEdit}
        canDelete={note.permissions.canDelete}
        context={context}
      />
    </main>
  );
}

// 日時の整形はサーバー側に閉じる。島の中で `Intl` を使うとサーバーと
// ブラウザーのタイムゾーンが食い違ってハイドレーションがずれる。
const createdAtFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
