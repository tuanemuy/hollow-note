import type { NoteDetailView } from "@repo/core/application/note/view";
import { NotFoundState } from "@/components/ui/ErrorState";
import { serializeError } from "@/presentation/errorResponse";
import {
  loadNote,
  type NoteDetailContext,
  PERSONAL_NOTE_DETAIL_CONTEXT,
} from "../NoteDetail/action";
import { NoteEditorIsland } from "./editor";
import { type BackTarget, EditorShell, StateNotice } from "./frame";

/**
 * P-12 ノート編集（PAGE-p12-001..008、モック P12-editor.html）。
 *
 * 新規作成（`/notes/new`）と既存ノートの編集（`/notes/:noteId/edit`）を
 * 1 つの画面で担う。個人とワークスペースの 2 文脈で同じコンポーネントを
 * 使い、文脈は呼び出し側がプロップで渡す（既定は個人） — `NoteDetail` /
 * `NoteList` と同じ形で、URL からは読まない。
 *
 * 正規 URL への送り直しは持たない。所属先と URL の食い違いを直すのは
 * `NoteDetail` の `NoteUrlNormalizer` 1 か所であり（OR-12）、編集画面が
 * 同じ判断を二重に持つと 2 か所が別々に navigate しうる。
 */
export async function NoteEditor({
  noteId,
  userId,
  context = PERSONAL_NOTE_DETAIL_CONTEXT,
}: {
  noteId: string;
  userId: string;
  context?: NoteDetailContext;
}) {
  // 不在・他人の非公開・権限なしは `NOTE_NOT_FOUND` に収斂して届く。
  // 断片の中で終端状態を描くのは `NoteDetail` と同じ理由による
  // （Flight ストリームに入ったあとの throw は kind を失う）。
  let note: NoteDetailView;
  try {
    note = await loadNote(noteId, userId);
  } catch (error) {
    if (serializeError(error).kind === "notFound") {
      return <NotFoundState />;
    }
    throw error;
  }

  // ゴミ箱のノートは編集画面を開かせない（`NoteDetail` と同じ判定）。
  // 所有者には `getNote` が成功して返るので、`trashedAt` が唯一の材料に
  // なる。落とさないと、書けてしまったうえで最初の自動保存だけが
  // `NOTE_IS_TRASHED` で落ち、権限喪失の表示に相乗りする。
  if (note.trashedAt !== null) {
    return <NotFoundState />;
  }

  const backTo = backTarget(note.noteId, context);

  if (note.content.status !== "ready") {
    return (
      <EditorShell backTo={backTo}>
        <StateNotice
          tone={note.content.status === "failed" ? "error" : "warning"}
          title={
            note.content.status === "failed"
              ? "このノートは取り込めませんでした"
              : "処理中のため編集できません"
          }
          body={
            note.content.status === "failed"
              ? "本文が無いため編集できません。ノートの画面から取り込み直してください。"
              : "変換または再生成が実行中です。完了するまで編集を受け付けません。進捗はノートの画面で確認できます。"
          }
        />
      </EditorShell>
    );
  }

  if (!note.permissions.canEdit) {
    return (
      <EditorShell backTo={backTo}>
        <StateNotice
          tone="warning"
          title="このノートを編集する権限がありません"
          body="閲覧はできますが、保存はできません。ノートの画面から内容を確認してください。"
        />
      </EditorShell>
    );
  }

  return (
    <NoteEditorIsland
      backTo={backTo}
      target={{
        kind: "existing",
        noteId: note.noteId,
        title: note.title,
        html: note.content.html ?? "",
        version: note.version,
        // ED-04 の警告は「元が HTML ファイル由来のノート」に出す。取り込み
        // 由来かどうかは元ファイルの有無で、装飾を保っている本文かどうかは
        // `styleMode` で分かる（[ADR 007](spec/adr/007-default-style-isolation.md)）。
        //
        // 本文が `<style>` を持つノートも同じ門の後ろへ寄せる。WYSIWYG の
        // 面だけは shadow root の外にあり、そこへ載せた `<style>` の
        // セレクターは編集画面全体に当たるので、面は `<style>` を落として
        // から載せる（`surfaces.tsx` の `dropStyleElements`）。落ちるのは
        // 実際の装飾なので、警告と保存前の版を経ずに起きてはならない。
        mayLoseDecoration:
          note.sourceFileId !== null ||
          note.styleMode === "preserve" ||
          hasStyleElement(note.content.html ?? ""),
      }}
    />
  );
}

/**
 * 新規作成（PAGE-p12-002）。ノートはまだ存在しないので読み取りは無く、
 * 島に渡すのは作成先だけになる。ワークスペース文脈では作成先が URL で
 * 決まっているので選択させない（`CreateNoteButton` の `workspaceId` と
 * 同じ渡し方）。
 */
export function NewNoteEditor({
  context = PERSONAL_NOTE_DETAIL_CONTEXT,
}: {
  context?: NoteDetailContext;
}) {
  return (
    <NoteEditorIsland
      backTo={
        context.kind === "workspace"
          ? { kind: "workspaceNotes", workspaceId: context.workspaceId }
          : { kind: "notes" }
      }
      target={{
        kind: "new",
        workspaceId: context.kind === "workspace" ? context.workspaceId : null,
      }}
    />
  );
}

/**
 * 本文が `<style>` を持つか。ここはサーバーコンポーネントで `document` が
 * 無いので、パースではなく走査で判定する。取りこぼさない側へ倒してある
 * （コメントや文字列の中の `<style` にも当たる） — 過検出は警告が 1 回
 * 余分に出るだけだが、見落とすと装飾が警告も版も無しに失われる。
 */
const hasStyleElement = (html: string): boolean => /<style[\s/>]/i.test(html);

const backTarget = (noteId: string, context: NoteDetailContext): BackTarget =>
  context.kind === "workspace"
    ? { kind: "workspaceNote", noteId, workspaceId: context.workspaceId }
    : { kind: "note", noteId };
