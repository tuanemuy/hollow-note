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
 *
 * 退避だけは**保持期限**を持つ（{@link DRAFT_MAX_AGE_MS}）。中身はノート
 * 本文そのもので、保存に成功する以外に消える契機が無いため、置きっぱなし
 * にすると共用端末では次に使う人が読める state になる。期限切れは読まず
 * （{@link readDraft}）、前置きの下の一括の掃除は画面を開いたときに 1 回
 * だけ行う（{@link sweepExpiredDrafts}）。
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

/**
 * 退避を保持する上限。7 日を過ぎた退避は読まず、捨てる。
 *
 * 保存に成功しなかった本文をいつまでも端末に残さないための期限であって、
 * 「いつまで復元できるか」の約束ではない。ED-08 が求めるのは保存に失敗
 * した直後に復元を提案できることで、それは分〜時間の話である。
 */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const draftKey = (noteId: string): string => `${DRAFT_PREFIX}${noteId}`;

const parseDraft = (raw: string | null): LocalDraft | null => {
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
};

const isExpired = (draft: LocalDraft, now: number): boolean =>
  now - draft.savedAt > DRAFT_MAX_AGE_MS;

/**
 * 期限切れの退避を前置きごと捨てる。
 *
 * 鍵ごとの期限判定だけでは、二度と開かないノートの退避が永久に残る。
 * 読めない値も落とす — この前置きの下にあるものはすべてこの層が書いた
 * 退避で、読めない以上もう復元には使えない。
 *
 * **呼ぶのは編集画面を開いたときの 1 回だけ**である。1 件が本文 1 つぶん
 * （最大 800 KB）ある値を前置きの下から全部 `JSON.parse` する仕事なので、
 * 退避を読むたび（＝保存が確定するたび）に走らせると、1.5 秒間隔の自動
 * 保存がそのままメインスレッドの負荷になる。個別の鍵の期限判定は
 * {@link readDraft} が毎回行うので、掃除が遅れても期限切れは読まれない。
 */
export function sweepExpiredDrafts(): void {
  const now = Date.now();
  try {
    const storage = window.localStorage;
    const doomed: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null || !key.startsWith(DRAFT_PREFIX)) continue;
      const draft = parseDraft(storage.getItem(key));
      if (draft === null || isExpired(draft, now)) doomed.push(key);
    }
    for (const key of doomed) drop(key);
  } catch {
    // 列挙そのものを拒む端末では掃除を諦める。個別の期限判定は残る。
  }
}

export function readDraft(noteId: string): LocalDraft | null {
  const now = Date.now();
  const draft = parseDraft(read(draftKey(noteId)));
  if (draft === null) return null;
  if (isExpired(draft, now)) {
    clearDraft(noteId);
    return null;
  }
  return draft;
}

export function writeDraft(noteId: string, draft: LocalDraft): void {
  write(draftKey(noteId), JSON.stringify(draft));
}

export function clearDraft(noteId: string): void {
  drop(draftKey(noteId));
}
