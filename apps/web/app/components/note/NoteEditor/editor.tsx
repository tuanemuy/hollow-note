"use client";

import { useBlocker, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";
import {
  applyTextNodeEditsFn,
  createNoteWithBodyFn,
  listNoteRevisionsFn,
  readNoteEditStateFn,
  renameNoteFn,
  restoreNoteRevisionFn,
  storeNoteMediaFn,
  updateNoteBodyFn,
} from "@/routes/notes/-action";
import { BackLink, type BackTarget, barClass, pageClass } from "./frame";
import {
  clearDraft,
  EDITOR_MODES,
  type EditorMode,
  MODE_LABEL,
  readDraft,
  readPreferredMode,
  readWysiwygWarningDismissed,
  writeDraft,
  writePreferredMode,
  writeWysiwygWarningDismissed,
} from "./preferences";
import { HtmlSurface, VisualSurface, WysiwygSurface } from "./surfaces";
import { collectEditableTextNodes, diffTextNodeEdits } from "./textNodes";

/**
 * P-12 の編集を持つ島（PAGE-p12-001..008）。
 *
 * **版を握るのはここ**である。自動保存・タイトル・版の復元がすべて
 * `expectedVersion` を要求し、応答が新しい版を返す以上、保存する主体が
 * 1 つでないと版が枝分かれする。書く面（`surfaces.tsx`）は入力を流す
 * だけで、サーバー関数を持たない。
 *
 * 自動保存は `useTransition`、明示保存は `useActionState`、アップロード
 * 中の表示は `useOptimistic` が担う（CLAUDE.md「Frontend」の三層目）。
 * すべての確定は `router.invalidate()` で整合させる。
 */

export type EditorTarget =
  | Readonly<{ kind: "new"; workspaceId: string | null }>
  | Readonly<{
      kind: "existing";
      noteId: string;
      title: string;
      html: string;
      version: number;
      styleMode: "default" | "preserve";
      mayLoseDecoration: boolean;
    }>;

type SaveStatus =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "dirty" }>
  | Readonly<{ kind: "saving" }>
  | Readonly<{ kind: "saved" }>
  /** 通信エラー。ローカルへ退避したうえで再試行を出す。 */
  | Readonly<{ kind: "failed"; message: string }>
  /** 他者の更新。上書きするか破棄するかを選ばせる。 */
  | Readonly<{ kind: "conflict" }>
  /** 変換・再生成のジョブが実行中。編集を受け付けず完了を待つよう案内する。 */
  | Readonly<{ kind: "locked" }>
  /** 権限喪失・ゴミ箱。内容のダウンロードを出す。 */
  | Readonly<{ kind: "blocked"; message: string }>;

type RemovedEntry = Readonly<{ kind: string; name: string; reason: string }>;

type RevisionEntry = Readonly<{
  revisionId: string;
  createdAt: Date;
  createdByName: string | null;
  reason: string;
  excerpt: string;
}>;

/**
 * 進行中・失敗したメディア挿入（ED-06）。`file` を持ち続けるのは再試行の
 * ためで、失敗の表示から選び直さずにもう一度送れるようにする。
 */
type UploadEntry = Readonly<{
  id: string;
  name: string;
  status: "uploading" | "failed";
  message: string | null;
  file: File;
}>;

const AUTOSAVE_DELAY_MS = 1_500;

const REMOVED_KIND_LABEL: Readonly<Record<string, string>> = {
  element: "要素",
  attribute: "属性",
  url: "URL",
  css: "CSS 宣言",
};

const REVISION_REASON_LABEL: Readonly<Record<string, string>> = {
  manualEdit: "編集",
  wysiwygConversion: "WYSIWYG への変換",
  conversion: "取り込み",
  regeneration: "作り直し",
  referenceImport: "外部参照の取り込み",
  restore: "版の復元",
};

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});
const stampFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function NoteEditorIsland({
  target,
  backTo,
}: {
  target: EditorTarget;
  backTo: BackTarget;
}) {
  const router = useRouter();
  const titleId = useId();

  const saveBody = useServerFn(updateNoteBodyFn);
  const saveTextNodes = useServerFn(applyTextNodeEditsFn);
  const rename = useServerFn(renameNoteFn);
  const createWithBody = useServerFn(createNoteWithBodyFn);
  const readEditState = useServerFn(readNoteEditStateFn);
  const listRevisions = useServerFn(listNoteRevisionsFn);
  const restoreRevision = useServerFn(restoreNoteRevisionFn);
  const uploadMedia = useServerFn(storeNoteMediaFn);

  const isNew = target.kind === "new";

  // 確定済みの状態（サーバーが返した最後の値）と、書いている途中の状態。
  const [noteId, setNoteId] = useState<string | null>(
    target.kind === "existing" ? target.noteId : null,
  );
  const versionRef = useRef(target.kind === "existing" ? target.version : -1);
  const [savedTitle, setSavedTitle] = useState(
    target.kind === "existing" ? target.title : "",
  );
  const [savedBody, setSavedBody] = useState(
    target.kind === "existing" ? target.html : "",
  );
  const [title, setTitle] = useState(savedTitle);
  const [body, setBody] = useState(savedBody);
  /** 書く面へ渡す値。差し替えたときだけ動かす（打鍵ごとに動かすと caret が飛ぶ）。 */
  const [baseline, setBaseline] = useState(savedBody);

  const [mode, setMode] = useState<EditorMode>("wysiwyg");
  const [status, setStatus] = useState<SaveStatus>(
    isNew ? { kind: "new" } : { kind: "idle" },
  );
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [removed, setRemoved] = useState<readonly RemovedEntry[]>([]);
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [importReferences, setImportReferences] = useState(true);
  const [visualAvailable, setVisualAvailable] = useState(false);
  const [pendingMode, setPendingMode] = useState<EditorMode | null>(null);
  const [wysiwygWarning, setWysiwygWarning] = useState(false);
  const [draftOffer, setDraftOffer] = useState<Readonly<{
    html: string;
    title: string;
    savedAt: number;
  }> | null>(null);
  const [revisions, setRevisions] = useState<readonly RevisionEntry[] | null>(
    null,
  );
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<readonly UploadEntry[]>([]);
  const [optimisticUploads, addOptimisticUpload] = useOptimistic(
    uploads,
    (list: readonly UploadEntry[], entry: UploadEntry) => [...list, entry],
  );

  const [isSaving, startSaving] = useTransition();
  const [isBusy, startBusy] = useTransition();

  const wysiwygRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const visualOriginal = useRef<ReadonlyMap<string, string>>(new Map());
  const visualCurrent = useRef<ReadonlyMap<string, string>>(new Map());
  const [visualDirty, setVisualDirty] = useState(false);

  const dirty = title !== savedTitle || body !== savedBody || visualDirty;
  const editable = status.kind !== "locked" && status.kind !== "blocked";
  const uploading = uploads.some((entry) => entry.status === "uploading");

  // 既定のモードは端末に持つ（ED-05）。新規作成だけは引き継がず常に
  // WYSIWYG で開く。読み出しを effect に置くのは、サーバー描画と初回の
  // クライアント描画を一致させるため。
  useEffect(() => {
    if (isNew) return;
    const preferred = readPreferredMode();
    if (preferred !== null) setMode(preferred);
  }, [isNew]);

  // 退避データの検出（ED-08 の「復元の提案」）。
  useEffect(() => {
    if (noteId === null) return;
    const draft = readDraft(noteId);
    if (draft !== null && draft.html !== savedBody) setDraftOffer(draft);
    // 提案は開いた時点の 1 回だけ。保存のたびに出し直さない。
  }, [noteId, savedBody]);

  // ビジュアルモードが選べるか（ED-05 の「ビジュアル不可」）。
  useEffect(() => {
    const template = document.createElement("template");
    template.innerHTML = body;
    setVisualAvailable(collectEditableTextNodes(template.content).length > 0);
  }, [body]);

  // 離脱の確認（ED-08 の未保存、ED-06 のアップロード中）。
  //
  // ルーターの blocker に載せるのは、確認が要る離脱が 3 通りあるため
  // である — 画面内のリンク、ブラウザーの戻る、タブを閉じる。素の
  // `beforeunload` は最後の 1 つしか捕まえず、SPA の遷移は素通りする。
  // ref を経由するのは、blocker が `shouldBlockFn` の同一性で購読を張り
  // 直すためで、毎描画で作り直す関数を渡すと打鍵のたびに登録が動く。
  const leaveConfirmRef = useRef<string | null>(null);
  leaveConfirmRef.current = uploading
    ? UPLOAD_LEAVE_CONFIRM
    : dirty
      ? LEAVE_CONFIRM
      : null;

  useBlocker({
    shouldBlockFn: useCallback(() => {
      const message = leaveConfirmRef.current;
      return message !== null && !window.confirm(message);
    }, []),
    enableBeforeUnload: useCallback(() => leaveConfirmRef.current !== null, []),
  });

  const reconcile = () =>
    router.invalidate().catch(() => {
      console.error("Note editor reconcile failed");
    });

  const classify = (error: unknown): SaveStatus => {
    const serialized = extractSerializedError(error);
    const message = displayError(error);
    switch (serialized.code) {
      case "OPTIMISTIC_LOCK_FAILURE":
        return { kind: "conflict" };
      case "NOTE_LOCKED_BY_JOB":
        return { kind: "locked" };
      case "NOTE_NOT_FOUND":
      case "NOTE_ACCESS_DENIED":
      case "NOTE_IS_TRASHED":
      case "WORKSPACE_INSUFFICIENT_ROLE":
        return { kind: "blocked", message };
      default:
        return { kind: "failed", message };
    }
  };

  /** 現在の面が持っている本文。WYSIWYG だけ DOM が正本になる。 */
  const readBody = (): string =>
    mode === "wysiwyg" ? (wysiwygRef.current?.innerHTML ?? body) : body;

  const commit = async (explicit: boolean): Promise<void> => {
    const currentBody = readBody();
    const currentTitle = title;
    if (!explicit && !dirty) return;

    setStatus({ kind: "saving" });
    try {
      if (noteId === null) {
        // 初回の自動保存でノートが生まれる（PAGE-p12-002）。
        const created = await createWithBody({
          data: {
            workspaceId: target.kind === "new" ? target.workspaceId : null,
            title: currentTitle,
            rawHtml: currentBody,
            importReferences,
          },
        });
        versionRef.current = created.version;
        setNoteId(created.noteId);
        setRemoved(created.removed);
        settleSaved(currentTitle, currentBody);
        await reconcile();
        // URL を編集の URL へ置き換える。以降は既存ノートの編集と同じ扱い。
        await router
          .navigate(
            created.workspaceId === null
              ? {
                  to: "/notes/$noteId/edit",
                  params: { noteId: created.noteId },
                  replace: true,
                }
              : {
                  to: "/workspaces/$workspaceId/notes/$noteId/edit",
                  params: {
                    noteId: created.noteId,
                    workspaceId: created.workspaceId,
                  },
                  replace: true,
                },
          )
          .catch(() => {
            console.error("Navigation to the created note failed");
          });
        return;
      }

      // タイトルを先に確定する。どちらも版を 1 つ進めるので、応答の版を
      // 次の呼び出しへ渡さないと本文が必ず競合する。
      if (currentTitle !== savedTitle) {
        const renamed = await rename({
          data: {
            noteId,
            title: currentTitle,
            expectedVersion: versionRef.current,
          },
        });
        versionRef.current = renamed.version;
        setSavedTitle(renamed.title);
        setTitle((value) => (value === currentTitle ? renamed.title : value));
      }

      if (mode === "visual") {
        const edits = diffTextNodeEdits(
          visualOriginal.current,
          visualCurrent.current,
        );
        if (edits.length > 0) {
          const applied = await saveTextNodes({
            data: { noteId, expectedVersion: versionRef.current, edits },
          });
          versionRef.current = applied.version;
          setSkipped(applied.skipped.map((entry) => entry.path));
          // 適用済みの値を新しい基準にする。次の保存が同じ編集を送り直す
          // と `contentChanged` で落ちる。
          visualOriginal.current = new Map(visualCurrent.current);
        }
        setVisualDirty(false);
      } else if (currentBody !== savedBody) {
        const saved = await saveBody({
          data: {
            noteId,
            rawHtml: currentBody,
            expectedVersion: versionRef.current,
            reason: mode === "wysiwyg" ? "wysiwygConversion" : "manualEdit",
            importReferences,
          },
        });
        versionRef.current = saved.version;
        setRemoved(saved.removed);
      }

      settleSaved(currentTitle, currentBody);
      clearDraft(noteId);
      await reconcile();
    } catch (error) {
      const next = classify(error);
      setStatus(next);
      if (noteId !== null && next.kind === "failed") {
        writeDraft(noteId, {
          html: currentBody,
          title: currentTitle,
          savedAt: Date.now(),
        });
      }
    }
  };

  const settleSaved = (nextTitle: string, nextBody: string): void => {
    setSavedTitle((value) => (value === nextTitle ? value : nextTitle));
    setSavedBody(nextBody);
    setSavedAt(new Date());
    setStatus({ kind: "saved" });
  };

  // 自動保存（ED-08）。落ち着いてから 1 回だけ走らせる。
  //
  // 失敗・競合のあとは自分から再開しない。同じ入力を 1.5 秒ごとに投げ直す
  // だけで、競合は解決されず、失敗はサーバーへの連打になる。再開は利用者の
  // 「再試行」か競合の解決が起点になる。
  //
  // アップロード中も待つ。本文にはまだ仮の要素が入っていて、それを保存
  // すると `data-hollow-upload` が落ちた素の `span` が本文に残る。
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `commit` は毎描画で作り直されるので依存に入れない（入れるとタイマーが打鍵のたびに張り直され、遅延が意味を失う）。代わりに `commit` が読む値（タイトル・本文・ビジュアルの差分）を並べてある — 規則から見ると余分だが、これがタイマーを張り直す唯一の根拠である。
  useEffect(() => {
    if (!dirty || !editable || isSaving || uploading) return;
    if (status.kind === "conflict" || status.kind === "failed") return;
    const timer = window.setTimeout(() => {
      startSaving(() => commit(false));
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    dirty,
    editable,
    isSaving,
    uploading,
    status.kind,
    title,
    body,
    visualDirty,
  ]);

  const [, submitSave, isSubmitting] = useActionState(
    async (): Promise<null> => {
      await commit(true);
      return null;
    },
    null,
  );

  const requestMode = (next: EditorMode): void => {
    if (next === mode) return;
    if (next === "visual" && !visualAvailable) return;
    if (dirty) {
      setPendingMode(next);
      return;
    }
    enterMode(next);
  };

  const enterMode = (next: EditorMode): void => {
    if (
      next === "wysiwyg" &&
      target.kind === "existing" &&
      target.mayLoseDecoration &&
      !readWysiwygWarningDismissed()
    ) {
      setWysiwygWarning(true);
      setPendingMode(next);
      return;
    }
    applyMode(next);
  };

  const applyMode = (next: EditorMode): void => {
    setPendingMode(null);
    setWysiwygWarning(false);
    setMode(next);
    setBaseline(savedBody);
    setBody(savedBody);
    setVisualDirty(false);
    writePreferredMode(next);
  };

  const replaceBody = (nextTitle: string, nextBody: string): void => {
    setSavedTitle(nextTitle);
    setSavedBody(nextBody);
    setTitle(nextTitle);
    setBody(nextBody);
    setBaseline(nextBody);
    setVisualDirty(false);
  };

  const discard = (): void => {
    replaceBody(savedTitle, savedBody);
    setStatus({ kind: "idle" });
    if (noteId !== null) clearDraft(noteId);
  };

  /** 競合の解決（ED-08）。どちらの枝も最新の版を引き直してから進む。 */
  const resolveConflict = (keepLocal: boolean): void => {
    if (noteId === null) return;
    const localTitle = title;
    const localBody = readBody();
    startBusy(async () => {
      let latest: Awaited<ReturnType<typeof readEditState>>;
      try {
        latest = await readEditState({ data: { noteId } });
      } catch (error) {
        setStatus(classify(error));
        return;
      }
      versionRef.current = latest.version;
      if (keepLocal) {
        setSavedTitle(latest.title);
        setSavedBody(latest.html);
        setTitle(localTitle);
        setBody(localBody);
        setStatus({ kind: "dirty" });
        return;
      }
      replaceBody(latest.title, latest.html);
      setStatus({ kind: "idle" });
      await reconcile();
    });
  };

  const openRevisions = (): void => {
    if (noteId === null) return;
    setRevisionError(null);
    startBusy(async () => {
      try {
        const list = await listRevisions({ data: { noteId } });
        setRevisions(list.revisions);
      } catch (error) {
        setRevisionError(displayError(error));
        setRevisions([]);
      }
    });
  };

  const restore = (revisionId: string): void => {
    if (noteId === null) return;
    startBusy(async () => {
      try {
        const restored = await restoreRevision({
          data: { noteId, revisionId, expectedVersion: versionRef.current },
        });
        versionRef.current = restored.version;
        const latest = await readEditState({ data: { noteId } });
        versionRef.current = latest.version;
        replaceBody(latest.title, latest.html);
        setStatus({ kind: "saved" });
        setSavedAt(new Date());
        setRevisions(null);
      } catch (error) {
        setStatus(classify(error));
        return;
      }
      await reconcile();
    });
  };

  const insertMarkup = (markup: string): void => {
    if (mode === "wysiwyg") {
      const surface = wysiwygRef.current;
      if (surface === null) return;
      surface.focus();
      document.execCommand("insertHTML", false, markup);
      setBody(surface.innerHTML);
      return;
    }
    const textarea = sourceRef.current;
    if (textarea === null) {
      setBody((value) => value + markup);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setBody((value) => value.slice(0, start) + markup + value.slice(end));
  };

  /**
   * 挿入した仮の要素を、保管できた要素で置き換える（`markup` が空なら
   * 取り除く）。WYSIWYG の本文は DOM が正本で HTML モードは文字列なので、
   * 面が持っているほうを直してから本文の state を揃える。
   */
  const settlePlaceholder = (id: string, markup: string): void => {
    const surface = wysiwygRef.current;
    const node = surface?.querySelector(`[data-hollow-upload="${id}"]`) ?? null;
    if (surface !== null && node !== null) {
      if (markup.length === 0) {
        node.remove();
      } else {
        node.outerHTML = markup;
      }
      setBody(surface.innerHTML);
      setStatus({ kind: "dirty" });
      return;
    }
    setBody((value) => value.replace(placeholderPattern(id), markup));
    setStatus({ kind: "dirty" });
  };

  const upload = (file: File, retryOf: string | null = null): void => {
    if (retryOf !== null) {
      setUploads((list) => list.filter((entry) => entry.id !== retryOf));
    }
    if (noteId === null) {
      setUploads((list) => [
        ...list,
        {
          id: nextUploadId(),
          name: file.name,
          status: "failed",
          message:
            "先に本文を保存してください。ノートが作られてからメディアを挿入できます。",
          file,
        },
      ]);
      return;
    }
    const id = nextUploadId();
    const entry: UploadEntry = {
      id,
      name: file.name,
      status: "uploading",
      message: null,
      file,
    };
    // ED-06 手順 2「アップロードの進捗がその場に表示される」。仮の要素を
    // 先に本文へ置き、成否が決まった時点で差し替えるか取り除く。
    insertMarkup(placeholderMarkup(id, file.name));
    startBusy(async () => {
      addOptimisticUpload(entry);
      setUploads((list) => [...list, entry]);
      try {
        const payload = new FormData();
        payload.set("file", file);
        payload.set("noteId", noteId);
        const stored = await uploadMedia({ data: payload });
        settlePlaceholder(
          id,
          mediaMarkup(stored.url, stored.mimeType, file.name),
        );
        // 成功したら失敗の履歴だけを残す（挿入された要素が結果を語る）。
        setUploads((list) => list.filter((item) => item.id !== id));
      } catch (error) {
        settlePlaceholder(id, "");
        const message = displayError(error);
        setUploads((list) =>
          list.map((item) =>
            item.id === id ? { ...item, status: "failed", message } : item,
          ),
        );
      }
    });
  };

  const busy = isSaving || isSubmitting || isBusy;

  return (
    <div className="min-h-dvh">
      <header className={barClass}>
        {/* 離脱の確認はここではなくルーターの blocker が持つ（この
            リンクだけでなく、戻るボタンとタブを閉じる操作も同じ確認に
            通す必要があるため）。 */}
        <BackLink target={backTo} label="ノートへ戻る" />

        {/* モック P12-editor.html の `.segmented`。素の `radio` を隠して
            ラベルに見た目を持たせる形にしてあるのは、`role="radio"` を
            付けたボタン列より支援技術での扱いが素直（グループの中の
            何番目か、が実装なしで伝わる）なため。下端の保存フォームの
            外にあるので、値が送られることはない。 */}
        <fieldset className="inline-flex rounded-md bg-surface p-0.5">
          <legend className="sr-only">編集モード</legend>
          {EDITOR_MODES.map((candidate) => {
            const disabled =
              (candidate === "visual" && !visualAvailable) || !editable;
            return (
              <label
                key={candidate}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-sm px-3 py-[5px] text-sm font-medium whitespace-nowrap transition-colors has-[:focus-visible]:shadow-focus has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 ${
                  mode === candidate
                    ? "bg-bg text-ink shadow-xs"
                    : "text-ink-secondary hover:text-ink"
                }`}
              >
                <input
                  type="radio"
                  name={`${titleId}-mode`}
                  className="sr-only"
                  checked={mode === candidate}
                  disabled={disabled}
                  onChange={() => requestMode(candidate)}
                />
                {MODE_LABEL[candidate]}
              </label>
            );
          })}
        </fieldset>

        <span className="min-w-2 flex-1" />

        <SaveIndicator status={status} dirty={dirty} savedAt={savedAt} />

        <button
          type="button"
          onClick={discard}
          disabled={!dirty || busy}
          className="inline-flex h-8 items-center rounded-pill px-3 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
        >
          破棄
        </button>
      </header>

      <main className={pageClass}>
        {isNew ? (
          <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-tertiary">
            <span>取り込み先</span>
            <span className="inline-flex h-7 items-center rounded-pill bg-surface px-3 text-sm text-ink">
              {target.kind === "new" && target.workspaceId !== null
                ? "このワークスペース"
                : "個人"}
            </span>
            <span>
              <span
                aria-hidden="true"
                className="mr-1 inline-block size-1.5 rounded-full bg-status-private"
              />
              非公開で作成されます
            </span>
          </p>
        ) : null}

        {draftOffer !== null ? (
          <Alert
            tone="warning"
            title="保存できなかった編集内容が端末に残っています"
            actions={
              <>
                <button
                  type="button"
                  className={smallPrimaryClass}
                  onClick={() => {
                    // 退避は**未保存**の内容なので、確定済みの値
                    // （`savedTitle` / `savedBody`）は動かさない。動かすと
                    // 復元した瞬間に「保存済み」になり、次の自動保存が
                    // 走らずサーバーへ届かない。
                    setTitle(draftOffer.title);
                    setBody(draftOffer.html);
                    setBaseline(draftOffer.html);
                    setVisualDirty(false);
                    setStatus({ kind: "dirty" });
                    setDraftOffer(null);
                  }}
                >
                  復元する
                </button>
                <button
                  type="button"
                  className={smallGhostClass}
                  onClick={() => {
                    if (noteId !== null) clearDraft(noteId);
                    setDraftOffer(null);
                  }}
                >
                  破棄する
                </button>
              </>
            }
          >
            {stampFormat.format(new Date(draftOffer.savedAt))}{" "}
            に自動保存が失敗したときのものです。復元すると現在の内容を置き換えます。
          </Alert>
        ) : null}

        {status.kind === "conflict" ? (
          <Alert
            tone="error"
            title="他の利用者がこのノートを更新しました"
            actions={
              <>
                <button
                  type="button"
                  className={smallPrimaryClass}
                  disabled={busy}
                  onClick={() => resolveConflict(true)}
                >
                  自分の内容で上書きする
                </button>
                <button
                  type="button"
                  className={smallGhostClass}
                  disabled={busy}
                  onClick={() => resolveConflict(false)}
                >
                  自分の変更を破棄する
                </button>
              </>
            }
          >
            保存しようとした版はすでに古くなっています。上書きすると相手の変更が失われます。
          </Alert>
        ) : null}

        {status.kind === "locked" ? (
          <Alert
            tone="warning"
            title="処理中のため編集できません"
            role="status"
          >
            変換または再生成が実行中です。完了するまで保存を受け付けません。進捗はノートの画面で確認できます。
          </Alert>
        ) : null}

        {status.kind === "blocked" ? (
          <Alert
            tone="error"
            title="このノートを保存できません"
            actions={
              <button
                type="button"
                className={smallGhostClass}
                onClick={() => downloadBody(title, readBody())}
              >
                内容をダウンロード
              </button>
            }
          >
            {status.message}
          </Alert>
        ) : null}

        {status.kind === "failed" ? (
          <Alert
            tone="error"
            title="保存できませんでした"
            actions={
              <button
                type="button"
                className={smallPrimaryClass}
                disabled={busy}
                onClick={() => startSaving(() => commit(true))}
              >
                再試行
              </button>
            }
          >
            {status.message}
            内容はこの端末に退避したので、次に開いたときに復元できます。
          </Alert>
        ) : null}

        {wysiwygWarning ? (
          <Alert
            tone="warning"
            title="WYSIWYG で編集すると装飾が失われることがあります"
            actions={
              <>
                <button
                  type="button"
                  className={smallPrimaryClass}
                  onClick={() => applyMode("wysiwyg")}
                >
                  了解して進む
                </button>
                <button
                  type="button"
                  className={smallGhostClass}
                  onClick={() => {
                    writeWysiwygWarningDismissed();
                    applyMode("wysiwyg");
                  }}
                >
                  今後表示しない
                </button>
                <button
                  type="button"
                  className={smallGhostClass}
                  onClick={() => {
                    setWysiwygWarning(false);
                    setPendingMode(null);
                  }}
                >
                  取りやめ
                </button>
              </>
            }
          >
            このノートは取り込んだ HTML
            を保っています。エディタが解釈できない装飾のほか、取り込んだ外部スタイルシートとその取り込み元の記録も失われることがあります。保存の直前に版が記録されるので、あとから戻せます。
          </Alert>
        ) : null}

        {pendingMode !== null && !wysiwygWarning ? (
          <Alert
            tone="warning"
            title="未保存の変更があります"
            actions={
              <>
                <button
                  type="button"
                  className={smallPrimaryClass}
                  disabled={busy}
                  onClick={() =>
                    startSaving(async () => {
                      await commit(true);
                      enterMode(pendingMode);
                    })
                  }
                >
                  保存して切り替える
                </button>
                <button
                  type="button"
                  className={smallGhostClass}
                  onClick={() => setPendingMode(null)}
                >
                  取りやめ
                </button>
              </>
            }
          >
            {MODE_LABEL[pendingMode]} へ切り替えると、いまの内容は保存済みの
            状態に戻ります。
          </Alert>
        ) : null}

        {removed.length > 0 ? (
          <Alert
            tone="info"
            title={`保存時に ${removed.length} 件を取り除きました`}
            role="status"
          >
            <ul>
              {removed.map((entry) => (
                <li key={`${entry.kind}:${entry.name}:${entry.reason}`}>
                  {REMOVED_KIND_LABEL[entry.kind] ?? entry.kind}「{entry.name}
                  」— {entry.reason}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {skipped.length > 0 ? (
          <Alert
            tone="warning"
            title="反映できなかった編集があります"
            role="status"
          >
            本文の構造が変わったため、{skipped.length}{" "}
            か所の書き換えを適用できませんでした。画面を読み直してからやり直してください。
          </Alert>
        ) : null}

        <label className="sr-only" htmlFor={titleId}>
          タイトル
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          placeholder="タイトル"
          disabled={!editable}
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
            setStatus({ kind: "dirty" });
          }}
          className="mb-6 block w-full border-none bg-transparent p-0 text-3xl font-normal tracking-tightest text-ink outline-none [caret-color:var(--color-accent)] placeholder:text-ink-tertiary"
        />

        {mode === "wysiwyg" ? (
          <FormatBar
            disabled={!editable || busy}
            onCommand={(command, value) => {
              wysiwygRef.current?.focus();
              document.execCommand(command, false, value);
              const surface = wysiwygRef.current;
              if (surface !== null) {
                setBody(surface.innerHTML);
                setStatus({ kind: "dirty" });
              }
            }}
            onPickMedia={upload}
          />
        ) : null}

        {mode === "wysiwyg" ? (
          <WysiwygSurface
            baseline={baseline}
            surfaceRef={wysiwygRef}
            onChange={(html) => {
              setBody(html);
              setStatus({ kind: "dirty" });
            }}
          />
        ) : mode === "html" ? (
          <HtmlSurface
            value={body}
            textareaRef={sourceRef}
            onChange={(html) => {
              setBody(html);
              setStatus({ kind: "dirty" });
            }}
          />
        ) : (
          <VisualSurface
            baseline={baseline}
            onReady={(paths) => {
              visualOriginal.current = paths;
              visualCurrent.current = paths;
            }}
            onChange={(current) => {
              visualCurrent.current = current;
              setVisualDirty(
                diffTextNodeEdits(visualOriginal.current, current).length > 0,
              );
              setStatus({ kind: "dirty" });
            }}
          />
        )}

        {optimisticUploads.length > 0 ? (
          <ul className="mt-4 space-y-1" aria-live="polite">
            {optimisticUploads.map((entry) => (
              <li
                key={entry.id}
                className={`flex flex-wrap items-center gap-2 text-xs ${
                  entry.status === "failed" ? "text-error" : "text-ink-tertiary"
                }`}
              >
                {entry.status === "uploading" ? (
                  `${entry.name} をアップロードしています...`
                ) : (
                  <>
                    <span>
                      {entry.name}: {entry.message}
                    </span>
                    {/* ED-06「挿入されたプレースホルダーを取り除き、再試行
                        できるようにする」。選び直させないよう、失敗した
                        ファイルそのものをもう一度送る。 */}
                    <button
                      type="button"
                      className={smallGhostClass}
                      disabled={busy}
                      onClick={() => upload(entry.file, entry.id)}
                    >
                      再試行
                    </button>
                    <button
                      type="button"
                      className={smallGhostClass}
                      onClick={() =>
                        setUploads((list) =>
                          list.filter((item) => item.id !== entry.id),
                        )
                      }
                    >
                      閉じる
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {mode === "visual" ? null : (
          <section className="mt-8 rounded-lg border border-hairline p-4">
            <h2 className="mb-3 text-sm font-semibold">
              本文の外部参照を取り込みますか
            </h2>
            <ImportChoice
              value={importReferences}
              disabled={!editable}
              onChange={setImportReferences}
            />
          </section>
        )}

        {revisions !== null ? (
          <section className="mt-8 rounded-lg border border-hairline p-4">
            <h2 className="mb-3 text-sm font-semibold">版から復元</h2>
            {revisionError !== null ? (
              <p className="text-xs text-error">{revisionError}</p>
            ) : revisions.length === 0 ? (
              <p className="text-sm text-ink-secondary">
                まだ版が記録されていません。
              </p>
            ) : (
              <ul className="space-y-2">
                {revisions.map((revision) => (
                  <li
                    key={revision.revisionId}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="text-xs text-ink-tertiary">
                      {stampFormat.format(new Date(revision.createdAt))}
                    </span>
                    <span className="text-xs text-ink-tertiary">
                      {REVISION_REASON_LABEL[revision.reason] ??
                        revision.reason}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {revision.excerpt}
                    </span>
                    <span className="text-xs text-ink-tertiary">
                      {revision.createdByName ?? "退会した利用者"}
                    </span>
                    <button
                      type="button"
                      className={smallGhostClass}
                      disabled={busy}
                      onClick={() => restore(revision.revisionId)}
                    >
                      復元
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </main>

      <form
        action={submitSave}
        className="sticky bottom-0 z-50 border-t border-hairline bg-[var(--bar-bg)] px-4 py-2 backdrop-blur-xl backdrop-saturate-150 sm:px-6"
      >
        <div className="mx-auto flex max-w-[var(--content-max)] items-center gap-2 overflow-x-auto">
          {/* ED-06: visual mode edits text nodes in place and cannot add
              an element, so the insert is not offered there at all. */}
          {mode === "visual" ? null : (
            <MediaButton disabled={!editable || busy} onPick={upload} />
          )}
          <button
            type="button"
            className={actionButtonClass}
            disabled={noteId === null || busy}
            onClick={openRevisions}
          >
            版を復元
          </button>
          <span className="flex-1" />
          <span className="text-xs text-ink-tertiary" role="status">
            {savedAt === null ? null : `最終保存 ${timeFormat.format(savedAt)}`}
          </span>
          <button
            type="submit"
            disabled={!editable || busy}
            aria-busy={busy}
            className="inline-flex h-9 items-center rounded-pill bg-accent px-4 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-55"
          >
            {busy ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

const LEAVE_CONFIRM =
  "未保存の変更があります。このまま移動すると失われます。よろしいですか？";

const UPLOAD_LEAVE_CONFIRM =
  "アップロードが進行中です。このまま移動すると中断されます。よろしいですか？";

let uploadSequence = 0;

/**
 * 本文へ差し込む仮の要素の識別子。属性セレクターと正規表現の両方に載る
 * ので、ファイル名は混ぜず `[a-z0-9-]` だけで組む。
 */
const nextUploadId = (): string => {
  uploadSequence += 1;
  return `u${Date.now().toString(36)}-${uploadSequence}`;
};

const escapeText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const placeholderMarkup = (id: string, fileName: string): string =>
  `<span data-hollow-upload="${id}">${escapeText(fileName)} をアップロードしています...</span>`;

const placeholderPattern = (id: string): RegExp =>
  new RegExp(`<span data-hollow-upload="${id}"[^>]*>[\\s\\S]*?</span>`);

const smallPrimaryClass =
  "inline-flex h-7 items-center rounded-pill bg-accent px-3 text-xs font-medium text-bg transition-colors hover:bg-accent-hover disabled:opacity-55";

const smallGhostClass =
  "inline-flex h-7 items-center rounded-pill px-3 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55";

const actionButtonClass =
  "inline-flex h-9 items-center gap-1 rounded-pill px-3 text-sm whitespace-nowrap text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55";

function SaveIndicator({
  status,
  dirty,
  savedAt,
}: {
  status: SaveStatus;
  dirty: boolean;
  savedAt: Date | null;
}) {
  const label = ((): string => {
    switch (status.kind) {
      case "saving":
        return "保存中";
      case "conflict":
        return "競合しました";
      case "locked":
        return "処理中";
      case "blocked":
        return "保存できません";
      case "failed":
        return "保存に失敗しました";
      case "new":
        return "未保存";
      default:
        if (dirty) return "未保存";
        return savedAt === null ? "" : "保存済み";
    }
  })();
  const tone =
    status.kind === "failed" ||
    status.kind === "conflict" ||
    status.kind === "blocked"
      ? "text-error"
      : status.kind === "saving"
        ? "text-ink-secondary"
        : "text-ink-tertiary";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${tone}`}
      role="status"
      aria-live="polite"
    >
      {label}
    </span>
  );
}

function ImportChoice({
  value,
  disabled,
  onChange,
}: {
  value: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const name = useId();
  return (
    <>
      <label className="flex cursor-pointer items-start gap-3 py-2">
        <input
          type="radio"
          name={name}
          checked={value}
          disabled={disabled}
          onChange={() => onChange(true)}
          className="mt-[3px] size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          <span className="block text-sm">取り込む（既定）</span>
          <span className="mt-0.5 block text-xs text-ink-tertiary">
            画像・動画は保存先の URL
            に差し替え、スタイルシートは本文に埋め込みます。配布元が消えても見た目が保たれます。
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 py-2">
        <input
          type="radio"
          name={name}
          checked={!value}
          disabled={disabled}
          onChange={() => onChange(false)}
          className="mt-[3px] size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          <span className="block text-sm">取り込まない</span>
          <span className="mt-0.5 block text-xs text-ink-tertiary">
            外部 URL
            のまま保存します。スタイルシートは埋め込まれないため、装飾が当たらない状態で保存されます（あとから取り込む設定で保存し直せば当たります）。
          </span>
        </span>
      </label>
    </>
  );
}

const FORMAT_COMMANDS: readonly Readonly<{
  label: string;
  command: string;
  value?: string;
}>[] = [
  { label: "見出し", command: "formatBlock", value: "h2" },
  { label: "太字", command: "bold" },
  { label: "斜体", command: "italic" },
  { label: "箇条書き", command: "insertUnorderedList" },
  { label: "引用", command: "formatBlock", value: "blockquote" },
  { label: "コード", command: "formatBlock", value: "pre" },
];

function FormatBar({
  disabled,
  onCommand,
  onPickMedia,
}: {
  disabled: boolean;
  onCommand: (command: string, value?: string) => void;
  onPickMedia: (file: File) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="書式"
      className="mb-5 flex flex-wrap items-center gap-0.5 border-b border-hairline pt-2 pb-4"
    >
      {FORMAT_COMMANDS.map((entry) => (
        <button
          key={entry.label}
          type="button"
          disabled={disabled}
          onClick={() => onCommand(entry.command, entry.value)}
          className="inline-flex h-[30px] items-center rounded-pill px-3 text-xs text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
        >
          {entry.label}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const url = window.prompt("リンク先の URL");
          if (url !== null && url.length > 0) onCommand("createLink", url);
        }}
        className="inline-flex h-[30px] items-center rounded-pill px-3 text-xs text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
      >
        リンク
      </button>
      <MediaButton disabled={disabled} onPick={onPickMedia} compact />
    </div>
  );
}

const MEDIA_ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,video/webm";

function MediaButton({
  disabled,
  onPick,
  compact = false,
}: {
  disabled: boolean;
  onPick: (file: File) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={MEDIA_ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 同じファイルを選び直せるように毎回空へ戻す。
          event.target.value = "";
          if (file !== undefined) onPick(file);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={
          compact
            ? "inline-flex h-[30px] items-center rounded-pill px-3 text-xs text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
            : actionButtonClass
        }
      >
        画像・動画を挿入
      </button>
    </>
  );
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const mediaMarkup = (
  url: string,
  mimeType: string,
  fileName: string,
): string =>
  mimeType.startsWith("video/")
    ? `<video src="${escapeAttribute(url)}" controls></video>`
    : `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(fileName)}">`;

/**
 * 権限を失ったときの逃げ道（ED-08 の「権限喪失」）。保存できない内容を
 * 端末へ持ち出せるようにする。
 */
function downloadBody(title: string, html: string): void {
  const blob = new Blob(
    [`<!doctype html><meta charset="utf-8"><title>${title}</title>${html}`],
    { type: "text/html" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title || "note"}.html`;
  anchor.click();
  URL.revokeObjectURL(url);
}
