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
 * 保存・表示スタイルの切替・ゴミ箱への移動・元に戻すはどれも
 * `expectedVersion` を要求し、どれも成功のたびに版を 1 つ進める。所有者を
 * 分けると、片方が保存した直後にもう片方が古い版を送って必ず競合する。
 * 握るだけでは足りず、その 1 か所の中で往復が**直列**である必要もある
 * （`DetailActivity` / `runExclusive`。編集島の同名の仕組みと同じ形）。
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
  const [isPending, startSaving] = useTransition();

  const [activity, setActivity] = useState<DetailActivity>(IDLE_ACTIVITY);
  /**
   * 占有の判定は同じ tick の中で決まらないといけない（タイマーの発火と
   * メニューのクリックが同じ描画の中に並ぶ）ので、判定の正本は ref に
   * 置く。state 側は表示と effect の依存のために持つ。
   */
  const activityRef = useRef<DetailActivity>(IDLE_ACTIVITY);

  /**
   * 版を進めうる往復の唯一の入口。`idle` からしか入れないので、タイトル
   * の自動保存・表示スタイルの切替・ゴミ箱への移動・元に戻すが互いを
   * 踏むことがない。入れなかった側は何もしない（`null` を返す）。
   *
   * タイトルの保存だけは落としても失われない — `title` が `savedTitle`
   * から離れたままなので、`busy` が下りた時点で自動保存の effect が
   * タイマーを張り直す。
   */
  const runExclusive = async <T,>(
    next: BusyActivity,
    task: () => Promise<T>,
  ): Promise<T | null> => {
    if (activityRef.current.kind !== "idle") return null;
    activityRef.current = next;
    setActivity(next);
    try {
      return await task();
    } finally {
      activityRef.current = IDLE_ACTIVITY;
      setActivity(IDLE_ACTIVITY);
    }
  };

  /** 版を進めうる往復が走っているか。UI の活性と自動保存の歯止め。 */
  const busy = activity.kind !== "idle" || isPending;

  /**
   * 断片を引き直して正本を持ち帰る（P-11 状態表「操作実行中」）。整合の
   * 失敗は握り潰す — 操作そのものはもう成立している。
   *
   * **成功した往復と落ちた往復の両方から呼ぶ。** この島が送る
   * `expectedVersion` は応答からしか進まないので、落ちたところで止めると、
   * 他のメンバーの保存で版が進んだあとは共通文言の「もう一度お試しくだ
   * さい」に従って押し直しても同じ古い版を送り続け、画面を離れるまで永久
   * に失敗する。持ち帰った値を島へ取り込むのは下の effect である。
   */
  const reconcile = async (): Promise<void> => {
    await router.invalidate().catch(() => {
      console.error("Note reconcile failed");
    });
  };

  /**
   * 引き直した正本を島へ取り込む（P-11 状態表「操作実行中」）。門は 2 つ
   * ある。
   *
   * - **往復が走っているあいだは取り込まない**（`busy`）。送った版の応答の
   *   ほうが新しく、断片が持ち帰った版はその 1 つ前でありうる
   * - **島が持つ版より古い正本は取り込まない**（`initialVersion <
   *   versionRef.current`）。版は単調増加なので、この 1 行が弾くのは古い
   *   断片による巻き戻しだけで、失敗のあとの引き直しはそのまま通る
   *
   * 2 つ目が要るのは、`reconcile()` の解決が断片の到着より**先**だから
   * である。loader は `renderServerFragment` を await せず、`Deferred` は
   * Flight payload が届くまで旧 payload を保つので、`busy` が下りた瞬間の
   * props はまだ 1 世代前でありうる。3 つの契機で追うと:
   *
   * - **往復が通った直後** — `versionRef` は応答が返した版、props は
   *   まだ 1 つ前。版の門が閉じるので取り込まない（取り込むと版と保存済み
   *   タイトルが巻き戻り、次の自動保存が古い版で送って必ず競合する）
   * - **往復が落ちた直後** — 応答が無いので `versionRef` は送った版のまま
   *   である。他の利用者の保存で進んだ正本は必ずそれ以上なので門を通り、
   *   次の再試行が新しい版で送れる（これが引き直しの目的である）
   * - **断片が届いたとき** — 版が追いついた時点で門が開き、版・保存済み
   *   タイトル・表示スタイルが正本へ揃う
   *
   * `title`（打鍵中の入力）は確定済みの値と同じときだけ揃える。離れて
   * いれば触らない — サーバーの値で上書きすると書いている最中の文字が
   * 消える（差はそのまま自動保存の effect が拾う。島を `key` で組み直さ
   * ないのも同じ理由である）。同じときに揃えるのは、競合で入力欄を
   * `savedTitle` へ巻き戻したあとに他の利用者の正本が届く経路があるため
   * で、揃えないと入力欄だけが古い値のまま残り、自動保存がそれをサーバー
   * へ書き戻す。
   */
  useEffect(() => {
    if (busy || initialVersion < versionRef.current) return;
    versionRef.current = initialVersion;
    setSavedTitle(initialTitle);
    setStyleMode(initialStyleMode);
    setTitle((value) => (value === savedTitle ? initialTitle : value));
  }, [busy, initialVersion, initialTitle, initialStyleMode, savedTitle]);

  const saveTitle = (next: string): void => {
    startSaving(async () => {
      await runExclusive({ kind: "renaming" }, async () => {
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
          await reconcile();
          return;
        }
        setError(null);
        setSavedTitle(applied);
        // 空は `NoteTitle` が「無題」に畳むので、返った値で入力欄を直す
        // （ED-07「空にした場合は「無題」に戻す」）。入力が先に進んで
        // いれば触らない。
        setTitle((value) => (value === next ? applied : value));
        await reconcile();
      });
    });
  };

  // ED-07「入力を終えると自動保存される」。打鍵が止まってから送る。
  //
  // 走っている往復があるあいだはタイマーを張らない。張ってしまうと
  // 表示スタイルの切替やゴミ箱への移動と同じ `versionRef.current` を
  // 送り、後着が必ず競合になる。`busy` が下りた時点で `title` はまだ
  // `savedTitle` から離れているので、この effect が張り直す。
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `saveTitle` は毎描画で作り直されるので依存に入れない（入れるとタイマーが打鍵のたびに張り直され、遅延が意味を失う）。タイマーを張り直す根拠は `title` が `savedTitle` から離れたことと、往復が空いたことだけである（`NoteEditor` の自動保存と同じ扱い）。
  useEffect(() => {
    if (!canEdit || title === savedTitle || trashed !== null || busy) return;
    const timer = window.setTimeout(() => {
      saveTitle(title);
    }, TITLE_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [title, savedTitle, canEdit, trashed, busy]);

  const onStyleMode = (next: "default" | "preserve") => {
    startSaving(async () => {
      await runExclusive({ kind: "styling" }, async () => {
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
          await reconcile();
          return;
        }
        setError(null);
        await reconcile();
      });
    });
  };

  const onTrash = () => {
    startSaving(async () => {
      await runExclusive({ kind: "trashing" }, async () => {
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
          await reconcile();
          return;
        }
        setError(null);
        setTrashed({ restoreVersion });
        // ここでは読み直さない。読み直すと断片が作り直され、いま出した
        // 「元に戻す」ごと消える。一覧はどのルートも訪問のたびに loader を
        // 再実行する（`shouldReload`）ので、戻った先が古いことはない。
      });
    });
  };

  const onRestore = () => {
    if (trashed === null) return;
    const { restoreVersion } = trashed;
    startSaving(async () => {
      await runExclusive({ kind: "restoring" }, async () => {
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
          // ここでは引き直さない。復元に使う版はゴミ箱へ移した往復の
          // 応答が持っており、引き直しても断片はもうこのノートを返さない
          // ので、いま出している「元に戻す」を消すだけになる。
          setError(displayError(failure));
          return;
        }
        await reconcile();
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
            busy={busy}
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
                disabled={busy}
                onClick={onRestore}
                className={subtleButtonClass}
              >
                {activity.kind === "restoring"
                  ? "元に戻しています..."
                  : "元に戻す"}
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
            {activity.kind === "renaming"
              ? "保存中..."
              : title === savedTitle
                ? ""
                : "未保存"}
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

/**
 * いま走っている「版を進めうる往復」。4 つのうちどの 2 つも同時に走って
 * はならない（どれも `versionRef.current` を送り、成功のたびに版を 1 つ
 * 進める）ので、フラグを並べるのではなく 1 つの判別ユニオンで持つ。
 * `useTransition` は往復を直列化しないため、これが唯一の歯止めである。
 */
type DetailActivity =
  | Readonly<{ kind: "idle" }>
  /** タイトルの自動保存・入力欄からの離脱。 */
  | Readonly<{ kind: "renaming" }>
  | Readonly<{ kind: "styling" }>
  | Readonly<{ kind: "trashing" }>
  | Readonly<{ kind: "restoring" }>;

type BusyActivity = Exclude<DetailActivity, Readonly<{ kind: "idle" }>>;

const IDLE_ACTIVITY: DetailActivity = { kind: "idle" };

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
