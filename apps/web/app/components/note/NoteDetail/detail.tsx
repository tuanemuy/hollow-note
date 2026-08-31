"use client";

import type {
  NoteContentView,
  NoteHeadingView,
} from "@repo/core/application/note/view";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  ghostButtonClass,
  subtleButtonClass,
} from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import {
  changeNoteStyleModeFn,
  renameNoteFn,
  restoreNoteFn,
  trashNoteFn,
} from "@/routes/notes/-action";
import { NoteBody } from "../NoteBody";
import type { NoteDetailContext } from "./action";
import { NoteDetailMenu } from "./menu";

/**
 * P-11 の操作を所有する島（PAGE-p11-002 / 008 / 013、モック
 * P11-note.html）。
 *
 * **この画面の版（`version`）を握るのはここだけである。** タイトルの自動
 * 保存・表示スタイルの切替・ゴミ箱への移動はどれも `expectedVersion` を
 * 要求し、どれも成功のたびに版を 1 つ進める。所有者を分けると、片方が
 * 保存した直後にもう片方が古い版を送って必ず競合する。
 *
 * 本文の描画（`NoteBody`）も島の中に置く。ED-11 の「切り替えると、その場
 * で表示が変わる」は、`styleMode` を楽観的に差し替えた同じ木で本文を描く
 * ことでしか満たせない — サーバー側で描いた本文を `children` で受けると、
 * 往復が終わるまで見た目が変わらない。
 */
export function NoteDetailIsland({
  noteId,
  initialTitle,
  initialVersion,
  initialStyleMode,
  visibility,
  createdAtLabel,
  content,
  headings,
  ownerType,
  ownerId,
  canEdit,
  canDelete,
  context,
}: {
  noteId: string;
  initialTitle: string;
  initialVersion: number;
  initialStyleMode: "default" | "preserve";
  visibility: "private" | "unlisted" | "public";
  createdAtLabel: string;
  content: NoteContentView;
  headings: readonly NoteHeadingView[];
  ownerType: "user" | "workspace";
  ownerId: string;
  canEdit: boolean;
  canDelete: boolean;
  context: NoteDetailContext;
}) {
  const router = useRouter();
  const rename = useServerFn(renameNoteFn);
  const changeStyleMode = useServerFn(changeNoteStyleModeFn);
  const trashNote = useServerFn(trashNoteFn);
  const restoreNote = useServerFn(restoreNoteFn);

  // 版は state ではなく ref に置く。表示に出ないうえ、自動保存のタイマー
  // が閉じ込めた古い値を送らないためである。
  const versionRef = useRef(initialVersion);

  const [title, setTitle] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [styleMode, setStyleMode] = useState(initialStyleMode);
  const [shownStyleMode, showStyleMode] = useOptimistic(
    styleMode,
    (_current, next: "default" | "preserve") => next,
  );
  const [trashed, setTrashed] = useState<TrashedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const saveTitle = (next: string): void => {
    startSaving(async () => {
      let applied: string;
      try {
        const renamed = await rename({
          data: {
            noteId,
            title: next,
            expectedVersion: versionRef.current,
          },
        });
        versionRef.current = renamed.version;
        applied = renamed.title;
      } catch (failure) {
        setError(displayError(failure));
        // PAGE-p11-002「競合・validation・権限失敗で巻き戻す」。
        setTitle(savedTitle);
        return;
      }
      setError(null);
      setSavedTitle(applied);
      // 空は `NoteTitle` が「無題」に畳むので、返った値で入力欄を直す
      // （ED-07「空にした場合は「無題」に戻す」）。入力が先に進んで
      // いれば触らない。
      setTitle((value) => (value === next ? applied : value));
      await router.invalidate().catch(() => {
        console.error("Note reconcile failed");
      });
    });
  };

  // ED-07「入力を終えると自動保存される」。打鍵が止まってから送る。
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `saveTitle` は毎描画で作り直されるので依存に入れない（入れるとタイマーが打鍵のたびに張り直され、遅延が意味を失う）。タイマーを張り直す根拠は `title` が `savedTitle` から離れたことだけである（`NoteEditor` の自動保存と同じ扱い）。
  useEffect(() => {
    if (!canEdit || title === savedTitle || trashed !== null) return;
    const timer = window.setTimeout(() => {
      saveTitle(title);
    }, TITLE_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [title, savedTitle, canEdit, trashed]);

  const onStyleMode = (next: "default" | "preserve") => {
    startSaving(async () => {
      showStyleMode(next);
      try {
        const changed = await changeStyleMode({
          data: {
            noteId,
            styleMode: next,
            expectedVersion: versionRef.current,
          },
        });
        versionRef.current = changed.version;
        setStyleMode(changed.styleMode);
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      await router.invalidate().catch(() => {
        console.error("Note reconcile failed");
      });
    });
  };

  const onTrash = () => {
    startSaving(async () => {
      // 「元に戻す」に要る版は応答が持ってくる。移動のついでにジョブの
      // 強制終端で版がもう 1 つ進むことがあるので、送った版から数えて
      // 当てることはできない。
      let restoreVersion: number;
      try {
        restoreVersion = (
          await trashNote({
            data: { noteId, expectedVersion: versionRef.current },
          })
        ).version;
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setTrashed({ restoreVersion });
      // ここでは読み直さない。読み直すと断片が作り直され、いま出した
      // 「元に戻す」ごと消える。一覧はどのルートも訪問のたびに loader を
      // 再実行する（`shouldReload`）ので、戻った先が古いことはない。
    });
  };

  const onRestore = () => {
    if (trashed === null) return;
    const { restoreVersion } = trashed;
    startSaving(async () => {
      try {
        // 復元後の版も応答が持ってくる。この画面はタイトルの自動保存を
        // 続けるので、次の保存に使う版をここで正しく戻さないと必ず競合
        // する。読み直しでは直せない — 断片を作り直しても島の state は
        // 残る。
        const restored = await restoreNote({
          data: { noteId, expectedVersion: restoreVersion },
        });
        versionRef.current = restored.version;
        setError(null);
        setTrashed(null);
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      await router.invalidate().catch(() => {
        console.error("Note reconcile failed");
      });
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start gap-2 text-xs text-ink-tertiary">
        <VisibilityBadge visibility={visibility} />
        <span className="text-hairline-strong">·</span>
        <span>{createdAtLabel}</span>
        <span className="min-w-2 flex-1" />
        {canEdit && trashed === null ? (
          <NoteDetailMenu
            noteId={noteId}
            ownerType={ownerType}
            ownerId={ownerId}
            context={context}
            canDelete={canDelete}
            isPublished={visibility !== "private"}
            styleMode={shownStyleMode}
            onStyleMode={onStyleMode}
            onTrash={onTrash}
            busy={isSaving}
          />
        ) : null}
      </div>

      {trashed === null ? null : (
        <Alert
          tone="success"
          title="ゴミ箱に移しました"
          role="status"
          actions={
            <>
              <button
                type="button"
                disabled={isSaving}
                onClick={onRestore}
                className={subtleButtonClass}
              >
                {isSaving ? "元に戻しています..." : "元に戻す"}
              </button>
              <BackToListLink context={context} />
            </>
          }
        >
          30 日以内ならゴミ箱から元に戻せます。公開・共有の URL
          からは読めなくなりました。
        </Alert>
      )}

      {canEdit && trashed === null ? (
        <>
          {/* ED-07「タイトルを選んで書き換える」。200 文字は入力時点で
              止める（`maxLength`）ので、長すぎる保存はそもそも起きない。 */}
          <label className="sr-only" htmlFor={`${noteId}-title`}>
            タイトル
          </label>
          <input
            id={`${noteId}-title`}
            type="text"
            value={title}
            placeholder="無題"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (title !== savedTitle) saveTitle(title);
            }}
            className="mb-2 block w-full border-none bg-transparent p-0 text-3xl font-normal tracking-tightest leading-[1.18] text-ink outline-none focus:bg-accent-surface [caret-color:var(--color-accent)] placeholder:text-ink-tertiary"
          />
          <p className="mb-6 h-4 text-xs text-ink-tertiary" role="status">
            {isSaving ? "保存中..." : title === savedTitle ? "" : "未保存"}
          </p>
        </>
      ) : (
        <h1 className="mb-8 text-3xl font-normal tracking-tightest leading-[1.18]">
          {title}
        </h1>
      )}

      <NoteContentBlock
        content={content}
        styleMode={shownStyleMode}
        headings={headings}
      />

      <p className="text-xs text-error not-empty:mt-4" role="status">
        {error}
      </p>
    </>
  );
}

/** ゴミ箱へ移した直後の状態。版は「元に戻す」のためだけに持つ。 */
type TrashedState = Readonly<{ restoreVersion: number }>;

const TITLE_AUTOSAVE_DELAY_MS = 800;

function BackToListLink({ context }: { context: NoteDetailContext }) {
  return context.kind === "workspace" ? (
    <Link
      to="/workspaces/$workspaceId/notes"
      params={{ workspaceId: context.workspaceId }}
      className={ghostButtonClass}
    >
      ノート一覧へ
    </Link>
  ) : (
    <Link to="/notes" className={ghostButtonClass}>
      ノート一覧へ
    </Link>
  );
}

const VISIBILITY_META: Record<
  "private" | "unlisted" | "public",
  { label: string; dotClass: string }
> = {
  private: { label: "非公開", dotClass: "bg-status-private" },
  unlisted: { label: "リンクを知る人", dotClass: "bg-status-link" },
  public: { label: "公開", dotClass: "bg-status-public" },
};

function VisibilityBadge({
  visibility,
}: {
  visibility: "private" | "unlisted" | "public";
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

function NoteContentBlock({
  content,
  styleMode,
  headings,
}: {
  content: NoteContentView;
  styleMode: "default" | "preserve";
  headings: readonly NoteHeadingView[];
}) {
  switch (content.status) {
    case "ready":
      return content.html !== null && content.html.length > 0 ? (
        <NoteBody
          html={content.html}
          styleMode={styleMode}
          headings={headings}
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
