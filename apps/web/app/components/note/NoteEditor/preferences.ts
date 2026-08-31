/**
 * P-12 が端末に置く 2 つの値。どちらも**サーバーへは永続化しない**
 * （ED-05 / ED-08）。
 *
 * - 既定の編集モード（利用者単位。新規作成は常に WYSIWYG で開く）
 * - 保存に失敗した本文の退避（復元の提案）
 *
 * ED-04 の「WYSIWYG 警告を今後表示しない」はここに無い。抑止を戻す
 * 設定画面が本スライスの外にあり、戻し口の無い一方通行の抑止だけを
 * 置くと、一度押した端末では装飾の喪失が二度と告げられなくなる。
 *
 * `localStorage` はプライベートウィンドウやサイトデータの遮断で読み書き
 * そのものが投げるので、すべての経路を握り潰す。ここが投げると編集画面が
 * 開かなくなり、失う実害（既定が 1 回戻る）より遥かに重い。
 */

export type EditorMode = "wysiwyg" | "visual" | "html";

export const EDITOR_MODES: readonly EditorMode[] = [
  "wysiwyg",
  "visual",
  "html",
];

export const MODE_LABEL: Readonly<Record<EditorMode, string>> = {
  wysiwyg: "WYSIWYG",
  visual: "ビジュアル",
  html: "HTML",
};

const MODE_KEY = "hollow.noteEditor.mode";
const DRAFT_PREFIX = "hollow.noteEditor.draft.";

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 退避できない端末では「保存失敗」の表示だけが残る。
  }
};

const drop = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 同上。
  }
};

const isMode = (value: string | null): value is EditorMode =>
  value !== null && (EDITOR_MODES as readonly string[]).includes(value);

export function readPreferredMode(): EditorMode | null {
  const stored = read(MODE_KEY);
  return isMode(stored) ? stored : null;
}

export function writePreferredMode(mode: EditorMode): void {
  write(MODE_KEY, mode);
}

export type LocalDraft = Readonly<{
  html: string;
  title: string;
  savedAt: number;
}>;

const draftKey = (noteId: string): string => `${DRAFT_PREFIX}${noteId}`;

export function readDraft(noteId: string): LocalDraft | null {
  const raw = read(draftKey(noteId));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Partial<LocalDraft>;
    if (
      typeof value.html !== "string" ||
      typeof value.title !== "string" ||
      typeof value.savedAt !== "number"
    ) {
      return null;
    }
    return { html: value.html, title: value.title, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

export function writeDraft(noteId: string, draft: LocalDraft): void {
  write(draftKey(noteId), JSON.stringify(draft));
}

export function clearDraft(noteId: string): void {
  drop(draftKey(noteId));
}
