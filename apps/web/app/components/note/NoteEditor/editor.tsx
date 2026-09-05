"use client";

import type { RevisionReason } from "@repo/core/domain/note/noteRevision";
import {
  isAllowedUrl,
  NAVIGATION_SCHEMES,
} from "@repo/core/domain/note/services/urlPolicy";
import { StorageErrorCode } from "@repo/core/domain/storage/errorCode";
import {
  MEDIA_ALLOWED_MIME_TYPES,
  MEDIA_IMAGE_MAX_BYTES,
  MEDIA_SVG_MAX_BYTES,
  MEDIA_VIDEO_MAX_BYTES,
} from "@repo/core/domain/storage/services/uploadValidationPolicy";
import { useBlocker, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { Alert } from "@/components/ui/Alert";
import { displayError, renderErrorMessage } from "@/presentation/errorDisplay";
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
  sweepExpiredDrafts,
  writeDraft,
  writePreferredMode,
} from "./preferences";
import {
  classifySaveFailure,
  type RetryTarget,
  type SaveStatus,
} from "./saveStatus";
import {
  HtmlSurface,
  VisualSurface,
  WysiwygSurface,
  willDropStyleElements,
} from "./surfaces";
import {
  collectEditableTextNodes,
  diffTextNodeEdits,
  hasEditableTextNode,
} from "./textNodes";

/**
 * P-12 の編集を持つ島（PAGE-p12-001..008）。
 *
 * **版を握るのはここ**である。自動保存・タイトル・版の復元がすべて
 * `expectedVersion` を要求し、応答が新しい版を返す以上、保存する主体が
 * 1 つでないと版が枝分かれする。書く面（`surfaces.tsx`）は入力を流す
 * だけで、サーバー関数を持たない。版を握るだけでは足りず、その 1 か所の
 * 中で往復が**直列**である必要もある（`EditorActivity` / `runExclusive`）。
 *
 * 明示保存は `useActionState`、版を進めない往復（メディアの保管・版一覧）
 * は `useTransition`、アップロード中の表示は本文へ差し込む仮の要素
 * （`data-hollow-upload`）が担う（CLAUDE.md「Frontend」の三層目）。
 */

export type EditorTarget =
  | Readonly<{ kind: "new"; workspaceId: string | null }>
  | Readonly<{
      kind: "existing";
      noteId: string;
      title: string;
      html: string;
      version: number;
      mayLoseDecoration: boolean;
    }>;

/**
 * 編集しているノートの同一性。`noteId` と `version` を別々の値で持つと
 * 「ID はあるが版が無い」「版だけある」が表現できてしまい、版の sentinel
 * （`-1`）が転送境界（`expectedVersion` は 0 以上）へ届きうる。作られる前
 * と作られたあとを判別ユニオンで分ければ、その組み合わせは書けない。
 */
type NoteIdentity =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "existing"; noteId: string; version: number }>;

/**
 * ビジュアルの面が持っている経路表と、その表をサーバーの木へ**経路単位で
 * 当てられるか**。2 つを 1 つの値にしてあるのは、表だけでは「送れるか」が
 * 表せず、フラグだけでは「何を送るか」が表せないためである。
 *
 * `pathwise === false` になるのは、面と正本のあいだにサーバー側の書き換え
 * （丸ごと送った保存のサニタイズ）か面の外から入った本文（退避の復元・
 * 競合の上書き）が挟まったときで、そのときは丸ごと送るしかない。true へ
 * 戻るのは面を正本から組み直したとき（`reseed` → `onReady`）だけである。
 */
type VisualPaths = Readonly<{
  paths: ReadonlyMap<string, string>;
  pathwise: boolean;
}>;

/**
 * 編集の状態を 1 つの瞬間から取った写し。**確定済みの値もこの型で持つ**
 * （`confirmed`）ので、確定を動かすには写しを丸ごと渡すしかない —
 * 「タイトルだけ」「本文だけ」を渡す引数の形が無く、進めない側は
 * `{ ...confirmed, title }` と**明示的に**書いた分しか通らない。
 *
 * 確定値が動く経路は 3 つで、汎用の setter は**置いていない**（3 つの
 * 遷移がそれぞれ自分で `confirmedRef` と state を書く）。写しを丸ごと
 * 動かせるのは `confirm`（進める）と `reseed`（置き換える）の 2 つで、
 * 3 つ目の `attachVisualPaths` は `VisualPaths` しか受け取らないので
 * タイトルと本文を触れない。4 つ目の部分確定を足そうとすると、遷移を
 * 1 つ書き足すことになり、この段落が目に入る。
 *
 * 面の内容を読めるのは `takeSnapshot()` の 1 か所だけで、写しは往復の
 * あいだ動かない。保存が確定させてよいのは**送った値**であって、往復の
 * あいだに面へ入った「いまの値」ではない — 後者を確定させると、送って
 * いない打鍵が「保存済み」として捨てられ、次の保存が送る `expected` が
 * サーバーの持つ値と食い違って全件 `contentChanged` に落ちる。
 */
type EditorSnapshot = Readonly<{
  title: string;
  /** 面が持っている本文。退避・ダウンロード・丸ごと送る保存が読む。 */
  body: string;
  /** ビジュアルの面が無いモードでは `null`。 */
  visual: VisualPaths | null;
}>;

const EMPTY_PATHS: ReadonlyMap<string, string> = new Map();

const sameVisual = (a: VisualPaths | null, b: VisualPaths | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.pathwise !== b.pathwise || a.paths.size !== b.paths.size) return false;
  for (const [path, text] of a.paths) {
    if (b.paths.get(path) !== text) return false;
  }
  return true;
};

/**
 * 写しどうしの一致。**門は必ずこれで比べる** — 本文だけ・タイトルだけを
 * 見る比較を残すと、見ていない側が往復のあいだの打鍵ごと捨てられる。
 */
const sameSnapshot = (a: EditorSnapshot, b: EditorSnapshot): boolean =>
  a.title === b.title && a.body === b.body && sameVisual(a.visual, b.visual);

/**
 * いま走っている「版を進めうる往復」。保存・面の載せ直し・版の復元は
 * どの 2 つも同時に走ってはならないので、3 つのフラグではなく 1 つの
 * 判別ユニオンで持つ。フラグを並べると「どれとどれが同時に
 * 走りうるか」が型に現れず、ガードを 1 つ書き落とすと破棄の往復中に
 * 破棄対象が保存される、といった組み合わせが黙って通る。
 */
type EditorActivity =
  | Readonly<{ kind: "idle" }>
  /** 自動保存・明示保存・再試行（`commit`）。 */
  | Readonly<{ kind: "saving" }>
  /** モード切替・破棄・競合の解決。正本を引き直して面ごと載せ直す。 */
  | Readonly<{ kind: "reseeding" }>
  | Readonly<{ kind: "restoring" }>;

type BusyActivity = Exclude<EditorActivity, Readonly<{ kind: "idle" }>>;

const IDLE_ACTIVITY: EditorActivity = { kind: "idle" };

type RemovedEntry = Readonly<{ kind: string; name: string; reason: string }>;

type RevisionEntry = Readonly<{
  revisionId: string;
  createdAt: Date;
  createdByName: string | null;
  reason: RevisionReason;
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

/**
 * 「ビジュアル不可」の再判定を据え置く間隔。判定は本文を丸ごとパースする
 * ので、打鍵のたびに走らせると本文長に比例して入力そのものが詰まる。
 * 要るのはモード切替ボタンの活性だけで、1 打鍵の粒度は要らない。
 */
const VISUAL_CHECK_DELAY_MS = 500;

const REMOVED_KIND_LABEL: Readonly<Record<string, string>> = {
  element: "要素",
  attribute: "属性",
  url: "URL",
  css: "CSS 宣言",
};

/**
 * 版理由の表示名。`Record<RevisionReason, string>` で受けるのは、理由が
 * 増えたときにここが必ず型で落ちるようにするためである（`Record<string,
 * string>` だと、ドメインに無い行を持っていても、足りない行があっても
 * 何も言わない）。
 */
const REVISION_REASON_LABEL: Readonly<Record<RevisionReason, string>> = {
  manualEdit: "編集",
  wysiwygConversion: "WYSIWYG への変換",
  regeneration: "作り直し",
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
  const [identity, setIdentity] = useState<NoteIdentity>(
    target.kind === "existing"
      ? { kind: "existing", noteId: target.noteId, version: target.version }
      : { kind: "new" },
  );
  /**
   * 同一性の ref 版。版を進める往復は非同期の閉包の中から次の
   * `expectedVersion` を読むので、描画が捕まえた `identity` は 1 世代
   * 古いことがある。書き戻しの入口を `rememberIdentity` に絞って、state
   * と ref が食い違わないようにしてある。
   */
  const identityRef = useRef<NoteIdentity>(identity);
  const rememberIdentity = (next: NoteIdentity): void => {
    identityRef.current = next;
    setIdentity(next);
  };
  /** 描画が読む側。版は握らない（版を読んでよいのは往復の中だけ）。 */
  const noteId = identity.kind === "existing" ? identity.noteId : null;
  /**
   * 確定済みの状態。**1 つの写しだけ**で持つ（`EditorSnapshot`）。散らして
   * 持つと保存の経路ごとに進める部分集合が変わり、進めなかった側が
   * 往復のあいだの打鍵ごと捨てられる。
   */
  const [confirmed, setConfirmed] = useState<EditorSnapshot>({
    title: target.kind === "existing" ? target.title : "",
    body: target.kind === "existing" ? target.html : "",
    visual: null,
  });
  /**
   * 確定値の ref 版。面の載せ直し（`applyMode`）と保存は非同期の閉包の
   * 中から確定値を読むので、描画が捕まえた `confirmed` は 1 世代古い
   * ことがある。ref と state はこの下の 3 つの遷移（`confirm` /
   * `reseed` / `attachVisualPaths`）でしか動かず、どれも 2 つを同じ行で
   * 揃えるので食い違わない。**汎用の書き込み口は置かない** — 置くと、
   * 「1 つの項目だけ進める」呼び出しがその入口から入れてしまう
   * （`EditorSnapshot` の JSDoc）。
   */
  const confirmedRef = useRef<EditorSnapshot>(confirmed);
  const [title, setTitle] = useState(confirmed.title);
  const [body, setBody] = useState(confirmed.body);
  /** 書く面へ渡す値。差し替えたときだけ動かす（打鍵ごとに動かすと caret が飛ぶ）。 */
  const [baseline, setBaseline] = useState(confirmed.body);
  /**
   * 面を組み直した回数。`baseline` の同一性だけでは破棄を鍵にできない
   * （破棄はまさに同じ文字列へ戻す操作で、ビジュアルの面は文字列が
   * 変わらないと span を作り直さない）。
   */
  const [baselineSeed, setBaselineSeed] = useState(0);

  /**
   * 開いた直後のモード。HTML 由来のノート（`mayLoseDecoration`）を
   * WYSIWYG で開かないのは、ED-04 の警告なしに WYSIWYG に**居る**状態を
   * 作らないためである。警告は「WYSIWYG を選ぶ」ことの前提であり、
   * 既定として黙って入ってしまうと、警告も版理由（`wysiwygConversion`）
   * も素通りして装飾の喪失だけが起きる。
   */
  const initialMode: EditorMode =
    target.kind === "existing" && target.mayLoseDecoration ? "html" : "wysiwyg";
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [status, setStatus] = useState<SaveStatus>(
    isNew ? { kind: "new" } : { kind: "idle" },
  );
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [removed, setRemoved] = useState<readonly RemovedEntry[]>([]);
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [importReferences, setImportReferences] = useState(true);
  /** `null` は「まだ判定していない」。判定前はビジュアルを選ばせない。 */
  const [visualAvailable, setVisualAvailable] = useState<boolean | null>(null);
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
  /**
   * 初回保存で作られたノート。URL の置き換え（`/notes/new` → 編集の URL）
   * が**まだ済んでいない**あいだだけ入っている。保存の中で移らないのは、
   * 移る先が別のルートで島がアンマウントされるためである — 新しい画面は
   * サーバーから読み直した本文で開くので、往復のあいだに打った分がそこで
   * 消える。
   */
  const [createdNote, setCreatedNote] = useState<Readonly<{
    noteId: string;
    workspaceId: string | null;
  }> | null>(null);
  /**
   * 進行中・失敗したアップロード。楽観層は本文へ差し込む仮の要素
   * （`data-hollow-upload`）が担うので、この一覧に `useOptimistic` は
   * 重ねない —
   * 保留中の action は**その時点の** passthrough state へ再適用される
   * ので、同じ transition の中で実 state にも積むと同じ項目が 2 度並ぶ。
   */
  const [uploads, setUploads] = useState<readonly UploadEntry[]>([]);

  const [activity, setActivity] = useState<EditorActivity>(IDLE_ACTIVITY);
  /**
   * 占有の判定は同じ tick の中で決まらないといけない（クリックとタイマー
   * の発火が同じ描画の中に並ぶ）ので、判定の正本は ref に置く。state 側は
   * 表示と effect の依存のために持つ。
   */
  const activityRef = useRef<EditorActivity>(IDLE_ACTIVITY);
  /** 版を進めない往復（メディアの保管・版一覧の取得）。並行してよい。 */
  const [isSideBusy, startSide] = useTransition();

  /**
   * 版を進めうる往復の唯一の入口。`idle` からしか入れないので、破棄・
   * 明示保存・版の復元・競合の解決と自動保存が互いを踏むことがない。
   * 走らなかったときは `null` を返す（入れなかった側は何もしない）。
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

  const wysiwygRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  /** 面がいま持っている経路表。確定済みの側は `confirmed.visual` が持つ。 */
  const visualCurrent = useRef<ReadonlyMap<string, string>>(new Map());
  /**
   * ビジュアルの面に確定値との差があるか。`body` state は面の編集で
   * 動かないので、`dirty` はこの派生値でしか差を知れない。
   */
  const [visualDirty, setVisualDirty] = useState(false);
  /** 代替テキストを編集する対象（ED-06 手順 4）。面を差し替えると外れる。 */
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(
    null,
  );
  /**
   * 次の本文保存を「WYSIWYG への変換」として記録するか（ED-04）。版を
   * 残したいのは変換の 1 回目だけで、そのあとの通常編集ではない。
   */
  const wysiwygConversionRef = useRef(false);

  const dirty =
    title !== confirmed.title || body !== confirmed.body || visualDirty;
  const editable = status.kind !== "locked" && status.kind !== "blocked";
  const uploading = uploads.some((entry) => entry.status === "uploading");

  // 既定のモードは端末に持つ（ED-05）。新規作成だけは引き継がず常に
  // WYSIWYG で開く。読み出しを effect に置くのは、サーバー描画と初回の
  // クライアント描画を一致させるため。
  //
  // 適用は「ビジュアル不可」の判定が出てからにする。判定は本文を DOM に
  // 展開する別の effect が出すので、同じ commit の中では間に合わず、
  // 判定を待たずに復元すると編集欄が 1 つも無い面が開く。
  const preferenceAppliedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 復元は 1 回だけで、`seedMode` / `needsWysiwygWarning` は毎描画で作り直される。依存に入れると、面を差し替えるたびに復元がもう一度走りうる。ref で 1 回に絞っているのがこの effect の唯一の起動条件である。
  useEffect(() => {
    if (isNew || preferenceAppliedRef.current || visualAvailable === null) {
      return;
    }
    preferenceAppliedRef.current = true;
    const preferred = readPreferredMode();
    if (preferred === null) return;
    // ビジュアルを選べないノートでの逃げ先は `initialMode` である。
    // `wysiwyg` へ倒すと `mayLoseDecoration` のノートでは ED-04 の門が
    // 立ち、利用者が何も操作していないのに警告が出る（ED-05 が端末に
    // 持つと定めているのは「選んだモード」であって、選べなかったときの
    // 強制ではない）。
    const next =
      preferred === "visual" && !visualAvailable ? initialMode : preferred;
    if (next === initialMode) return;
    // 復元も切り替えと同じ門を通す。既定が WYSIWYG だからといって ED-04 の
    // 警告と `wysiwygConversion` の版理由を飛ばしてよい理由は無い。門の
    // 材料はこれから面へ載る本文（= 確定値）である。
    if (needsWysiwygWarning(next, confirmedRef.current.body)) {
      setWysiwygWarning(true);
      setPendingMode(next);
      return;
    }
    // 開いた直後の正本は `target` そのものなので引き直さない。
    seedMode(next, confirmedRef.current.title, confirmedRef.current.body);
  }, [isNew, initialMode, visualAvailable]);

  // 期限切れの退避の掃除は島のマウントで 1 回だけ（`sweepExpiredDrafts`
  // の JSDoc）。読みのついでに走らせると自動保存 1 回ごとに端末の退避を
  // 全部パースすることになる。
  useEffect(() => {
    sweepExpiredDrafts();
  }, []);

  // 退避データの検出（ED-08 の「復元の提案」）。提案は退避そのものの
  // 従属値にする — 保存が通って退避が消えたのに提案だけが残ると、
  // 「復元する」が保存済みの内容を古い退避で上書きできてしまう。
  useEffect(() => {
    if (noteId === null) return;
    const draft = readDraft(noteId);
    setDraftOffer(
      draft !== null && draft.html !== confirmed.body ? draft : null,
    );
  }, [noteId, confirmed.body]);

  // ビジュアルモードが選べるか（ED-05 の「ビジュアル不可」）。打鍵が
  // 止まってから数えるのは、判定が本文全体のパースを伴うため。開いた
  // 直後の 1 回だけ待たないのは、待つと既定モードの復元がその分遅れる
  // （復元は判定を待って走る）ため。
  const visualCheckedRef = useRef(false);
  useEffect(() => {
    const delay = visualCheckedRef.current ? VISUAL_CHECK_DELAY_MS : 0;
    visualCheckedRef.current = true;
    const timer = window.setTimeout(() => {
      const template = document.createElement("template");
      template.innerHTML = body;
      setVisualAvailable(hasEditableTextNode(template.content));
    }, delay);
    return () => window.clearTimeout(timer);
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
  /**
   * 自分が起こす遷移（初回保存後の URL 置き換え）のあいだだけ立てる。
   * 立てないと、利用者が何も操作していないのに自分の離脱確認が出る —
   * 取り消されれば URL は `/notes/new` のまま残り、了解されても確認の
   * 意味が無い。
   */
  const selfNavigateRef = useRef(false);

  useBlocker({
    shouldBlockFn: useCallback(() => {
      if (selfNavigateRef.current) return false;
      const message = leaveConfirmRef.current;
      return message !== null && !window.confirm(message);
    }, []),
    enableBeforeUnload: useCallback(
      () => !selfNavigateRef.current && leaveConfirmRef.current !== null,
      [],
    ),
  });

  const reconcile = () =>
    router.invalidate().catch(() => {
      console.error("Note editor reconcile failed");
    });

  /**
   * `locked` / `blocked` は面ごと凍っている状態なので、進行を語る表示
   * （`idle` / `saved`）で上書きしない。往復の途中で権限を失った・ジョブに
   * 掴まれたと分かったときに、その事実を「保存済み」が消してしまう。
   */
  const setProgressStatus = (next: SaveStatus): void => {
    setStatus((current) =>
      current.kind === "locked" || current.kind === "blocked" ? current : next,
    );
  };

  /**
   * 打鍵で降ろしてよいのは「進行を語る状態」だけ。`failed` / `conflict` は
   * 利用者の操作（再試行・競合の解決）でしか解けない — 1 文字打つだけで
   * 消えると、自動保存が古い版のまま勝手に再開し、解決の 2 ボタンが打鍵の
   * たびに画面から消える（ED-08 / AC-8 の「専用の状態として提示される」）。
   * `locked` / `blocked` は面ごと凍っているのでそもそも入力が来ない。
   *
   * `rejected` は例外で、解ける操作がまさに打鍵（内容を直す）である。
   * ただしノートがまだ作られていないあいだは降ろさない — 初回作成は冪等
   * ではないので、再送のたびに白紙のノートが 1 件ずつ増える。
   */
  const markDirty = (): void => {
    setStatus((current) =>
      current.kind === "new" ||
      current.kind === "idle" ||
      current.kind === "saved" ||
      current.kind === "dirty" ||
      (current.kind === "rejected" && identityRef.current.kind === "existing")
        ? { kind: "dirty" }
        : current,
    );
  };

  /**
   * いま面が持っている内容を 1 つの写しに固める。**面の内容を読む唯一の
   * 手段**にしてあるのは、本文と経路表を別々の瞬間から読む書き方を無く
   * すためである（`EditorSnapshot` の JSDoc）。
   *
   * WYSIWYG は DOM が正本で、ビジュアルは経路表を `baseline` へ当て直して
   * 組む — `body` state はビジュアルの経路編集では動かないので、そのまま
   * 使うと退避（ED-08）・ダウンロード・競合の上書きが編集を 1 文字も
   * 含まない。
   */
  const takeSnapshot = (): EditorSnapshot => {
    if (mode === "wysiwyg") {
      return {
        title,
        body: wysiwygRef.current?.innerHTML ?? body,
        visual: null,
      };
    }
    if (mode !== "visual") return { title, body, visual: null };
    const paths = new Map(visualCurrent.current);
    return {
      title,
      body: composeEditedHtml(baseline, paths),
      // 経路単位で送れるかは確定値が握っている（`VisualPaths` の JSDoc）。
      // 面の外から本文が入った・サーバーがサニタイズした、のどちらかが
      // 挟まっていれば丸ごと送る枝しか選べない。
      visual: {
        paths,
        pathwise: confirmedRef.current.visual?.pathwise ?? false,
      },
    };
  };

  /**
   * 保存が確定したら `true`。呼び出し元はこれを見てから次へ進む。
   *
   * 必ず `runExclusive({ kind: "saving" }, …)` の中から呼ぶ（版を進める
   * 往復がここにあるため）。
   *
   * 往復は 2 段に分かれる。**保存の確定**（作成 / rename / 本文の保存 →
   * `confirm` → `markSaved`）と、そのあとの**面の載せ直し**
   * （{@link reseedIfUnchanged}）である。分けてあるのは、載せ直しの結果を
   * 保存の成否に混ぜないためである — 載せ直しが通らなくても保存はもう
   * 確定しているので、状態は `saved` のままにして経路単位で送れる印
   * （`pathwise`）だけを降ろす。失敗として出すと、通っている保存を失敗と
   * 告げたうえで「再試行」が版と `Revision` を 1 つ無駄にし、ビジュアルでは
   * 適用済みの編集が再送されて全件 `contentChanged`（「反映できなかった
   * 編集があります」の誤報）になる。
   */
  const commit = async (explicit: boolean): Promise<boolean> => {
    if (!explicit && !dirty) return true;
    // 送る値をここで 1 つに固める。以降この関数は `title` / `body` /
    // `visualCurrent` の「いま」を読まない。
    const sent = takeSnapshot();

    setStatus({ kind: "saving" });
    const opening = identityRef.current;
    // タイトルと本文はそれぞれ版を 1 つ進める別々の往復なので、片方だけが
    // 通る窓がある。通った分を落とさないよう、確定後のタイトルは `catch`
    // からも読める位置に置く。
    let appliedTitle = confirmedRef.current.title;
    // どちらの通知も指すのは**直近の保存結果**なので、送らなかった保存でも
    // 前回の結果を残さない。置くのは載せ直し（`reseed` が通知を畳む）より
    // 後である。
    let nextRemoved: readonly RemovedEntry[] = [];
    let nextSkipped: readonly string[] = [];
    /**
     * 保存が面とサーバーの木の噛み合わせを崩したか。崩すのはビジュアルの
     * 面だけで、WYSIWYG / HTML は caret を飛ばさないために載せ直さない。
     */
    let needsReseed = false;
    try {
      if (opening.kind === "new") {
        // 初回の自動保存でノートが生まれる（PAGE-p12-002）。
        const created = await createWithBody({
          data: {
            workspaceId: target.kind === "new" ? target.workspaceId : null,
            title: sent.title,
            rawHtml: sent.body,
            importReferences,
          },
        });
        rememberIdentity({
          kind: "existing",
          noteId: created.noteId,
          version: created.version,
        });
        setRemoved(created.removed);
        // 確定するタイトルは**応答の値**である（理由は下の rename と同じ）。
        confirm(sent, {
          title: created.title,
          body: sent.body,
          visual: sent.visual,
        });
        markSaved();
        await reconcile();
        // URL の置き換えはここでは行わない。移る先は別のルートなので島は
        // アンマウントされ、新しい編集画面はサーバーから読み直した本文で
        // 開く — 往復のあいだに打った分がそこで消える。落ち着いてから
        // 移す仕事は effect に渡す（`createdNote`）。
        setCreatedNote({
          noteId: created.noteId,
          workspaceId: created.workspaceId,
        });
        return true;
      }

      // タイトルを先に確定する。どちらも版を 1 つ進めるので、応答の版を
      // 次の呼び出しへ渡さないと本文が必ず競合する。
      //
      // 確定値は**応答の値**である。`NoteTitle.manual` が空を「無題」に
      // 変え前後の空白を落とすので、送った生値を確定済みとして持つと
      // `dirty` が下りず、同じタイトルをもう一度 rename して版と往復を
      // 1 つ無駄にする。
      const noteId = opening.noteId;
      let version = opening.version;
      if (sent.title !== appliedTitle) {
        const renamed = await rename({
          data: { noteId, title: sent.title, expectedVersion: version },
        });
        version = renamed.version;
        rememberIdentity({ kind: "existing", noteId, version });
        appliedTitle = renamed.title;
      }

      // 経路単位で送れるかどうかは写しを取った時点で決まっている
      // （`takeSnapshot`）。送っていない保存を「保存済み」にすると、
      // 利用者が選んだ復元・上書きの内容が無言で消える。
      if (sent.visual?.pathwise) {
        const edits = diffTextNodeEdits(
          confirmedRef.current.visual?.paths ?? EMPTY_PATHS,
          sent.visual.paths,
        );
        if (edits.length > 0) {
          const applied = await saveTextNodes({
            data: { noteId, expectedVersion: version, edits },
          });
          version = applied.version;
          rememberIdentity({ kind: "existing", noteId, version });
          nextSkipped = applied.skipped.map((entry) => entry.path);
        }
        // サーバーが拒んだ経路が 1 つでもあれば、手元の経路表はもう
        // サーバーの木と噛み合っていない。載せ直して噛み合わせ直す。
        needsReseed = nextSkipped.length > 0;
        confirm(sent, settled(sent, appliedTitle, nextSkipped));
      } else if (sent.body !== confirmedRef.current.body) {
        const saved = await saveBody({
          data: {
            noteId,
            rawHtml: sent.body,
            expectedVersion: version,
            reason: wysiwygConversionRef.current
              ? "wysiwygConversion"
              : "manualEdit",
            importReferences,
          },
        });
        version = saved.version;
        rememberIdentity({ kind: "existing", noteId, version });
        wysiwygConversionRef.current = false;
        nextRemoved = saved.removed;
        // 丸ごと送ったあとの経路表は、サーバーがサニタイズ後に持つ木と
        // 噛み合わない。ビジュアルの面だけは載せ直して噛み合わせ直す。
        needsReseed = mode === "visual";
        confirm(sent, settled(sent, appliedTitle));
      } else {
        confirm(sent, settled(sent, appliedTitle));
      }
      markSaved();

      clearDraft(noteId);
      // 退避が消えた以上、提案も消す。残すと「復元する」がいま保存した
      // 内容を古い退避で上書きできてしまう（本文が変わらない保存では
      // 退避を見張る effect が走らないので、ここで畳む）。
      setDraftOffer(null);
    } catch (error) {
      // タイトルの rename だけが通っていたら、その分は確定させる — 送り
      // 直すと版と往復を 1 つ無駄にする。ここでも渡すのは写し**全体**で、
      // 本文と経路表は 1 つ前のまま（サーバーがいま持っている姿）である。
      if (appliedTitle !== confirmedRef.current.title) {
        confirm(sent, { ...confirmedRef.current, title: appliedTitle });
      }
      const next = classifySaveFailure(error, { kind: "save" });
      const failed = identityRef.current;
      // 退避の鍵は `noteId` なので、まだ作られていないノートでは退避
      // そのものが成立しない。告げる文言と逃げ道はその事実に従わせる。
      if (failed.kind === "existing" && next.kind === "failed") {
        writeDraft(failed.noteId, {
          html: sent.body,
          title: sent.title,
          savedAt: Date.now(),
        });
        setStatus({ ...next, stashed: true });
      } else {
        setStatus(next);
      }
      return false;
    }

    // 保存はもう確定しているので、載せ直しが通らなくても状態は動かさない。
    // 代わりに経路単位で送れる印を降ろす（`dropPathwise`）。落ちた
    // ときも、面が写しから動いていて載せ直しを見送ったとき（`false`）も
    // 同じで、どちらも手元の経路表がサーバーの木と噛み合っていない状態で
    // ある。
    //
    // 落ちた通信そのものは状態にしない。次の保存が同じ相手へ行くので、
    // 通信が続いていれば `{ kind: "save" }` の失敗として改めて出る。この
    // 保存が出した `skipped` の通知は残るので、反映できなかった編集が
    // あることは画面から消えない。
    if (needsReseed) {
      const rehinged = await reseedIfUnchanged(sent).catch(() => {
        console.error("Note editor reseed after save failed");
        return false;
      });
      if (!rehinged) dropPathwise(sent);
    }

    setRemoved(nextRemoved);
    setSkipped(nextSkipped);
    // 自動保存では断片を取り直さない。編集画面で無効化される loader は
    // この画面自身の 1 本だけで、島は `target` を初期値としてしか読まない
    // ので、持ち帰った本文・版は必ず捨てられる（往復 1 回分の無駄）。
    // 戻す先ができるのは、画面を離れる契機だけである。
    if (explicit) await reconcile();
    return true;
  };

  /**
   * 保存が通ったあとにサーバーが持っている写し。**送った写しからしか
   * 作れない**（`EditorSnapshot` の JSDoc）。タイトルだけは応答の正規化後
   * の値を取る。
   *
   * `skippedPaths` はサーバーが拒んだ経路（`pathNotFound` /
   * `contentChanged`）。拒まれた経路はサーバー側で**一切適用されていない**
   * ので、新しい基準に取り込んではならない — 取り込むと、次にその経路を
   * 編集したときの `expected` が一度も適用されていない文字列になり、以後
   * その経路は何度打っても `contentChanged` で落ち続ける。
   */
  const settled = (
    sent: EditorSnapshot,
    appliedTitle: string,
    skippedPaths: readonly string[] = [],
  ): EditorSnapshot => {
    if (sent.visual === null) {
      return { title: appliedTitle, body: sent.body, visual: null };
    }
    // 新しい基準は**送って通った経路表**である。往復のあいだに打った
    // 文字はまだサーバーに無いので、その差はそのまま次の保存へ残す。
    const paths = new Map(sent.visual.paths);
    const previous = confirmedRef.current.visual?.paths ?? EMPTY_PATHS;
    for (const path of skippedPaths) {
      const before = previous.get(path);
      if (before === undefined) paths.delete(path);
      else paths.set(path, before);
    }
    return {
      title: appliedTitle,
      body: sent.body,
      visual: { paths, pathwise: sent.visual.pathwise },
    };
  };

  /**
   * 確定値を進める（遷移その 1）。受け取るのは**送った写し**と、その往復
   * のあとにサーバーが持っている**写し全体**の 2 つだけで、面の「いまの
   * 値」はここから読まない。項目を 1 つだけ進める入口は持たない
   * （`EditorSnapshot` の JSDoc）。
   *
   * 入力欄を書き戻すのは、往復のあいだにそこが打たれていないときだけで
   * ある。打たれていたら残す — 確定は「送った値」に対して起きるので、
   * 送っていない打鍵を確定の値で上書きすると打鍵が黙って消える。
   */
  const confirm = (sent: EditorSnapshot, next: EditorSnapshot): void => {
    confirmedRef.current = next;
    setConfirmed(next);
    setTitle((value) => (value === sent.title ? next.title : value));
    // ビジュアルの面は打鍵で本文 state を動かさないので、確定のたびに
    // 揃え直す。揃えないと、面が持つ本文と `body` state が食い違ったまま
    // `dirty` が永久に下りない状態を作れる。
    if (mode === "visual") setBody(next.body);
    setVisualDirty(
      next.visual !== null &&
        diffTextNodeEdits(next.visual.paths, visualCurrent.current).length > 0,
    );
  };

  /**
   * 経路単位で送れる印を降ろす（{@link confirm} を通す遷移。写しの
   * 「本文」も「タイトル」も動かないので、確定値は 1 つも進まない）。
   *
   * 降ろすのは、保存のあとの載せ直しが通らなかったときである。手元の
   * 経路表はサーバーの木と噛み合っていないので、そのまま経路単位で送ると
   * 差し戻した `before` を `expected` に再送し、同じ経路が何度でも
   * `contentChanged` で落ちる。降ろせば次の保存は丸ごと送る枝へ落ち
   * （`takeSnapshot` の分岐）、その保存のあとの載せ直しが通った時点で
   * `onReady` が印を立て直す（{@link attachVisualPaths}）。
   */
  const dropPathwise = (sent: EditorSnapshot): void => {
    const current = confirmedRef.current;
    if (current.visual === null || !current.visual.pathwise) return;
    confirm(sent, {
      ...current,
      visual: { paths: current.visual.paths, pathwise: false },
    });
  };

  const markSaved = (): void => {
    setSavedAt(new Date());
    setProgressStatus({ kind: "saved" });
  };

  /**
   * 面ごと正本を載せ直す（`reseedFromServer`）が、**面がまだ写しと同じ値の
   * ままのときだけ**行う。載せ直しは確定ではなく置き換えなので、往復の
   * あいだに打った文字をそのまま捨ててしまう — 写しの規則
   * （`EditorSnapshot`）の逆向きである。
   *
   * 載せ直さなかったときは `false` を返す。面の値と確定済みの値が食い違った
   * まま残るので、噛み合いを戻すのは呼び出し元の仕事である — `commit` は
   * 経路単位で送れる印を降ろして（{@link dropPathwise}）次の保存を丸ごと
   * 送る枝へ落とす。この関数が見ているのは「面が写しから動いたか」だけで、
   * 降ろす判断まではここに無い。呼び出し元は先に `confirm` を済ませてから
   * 呼ぶので、載せ直しが起きなくても保存は確定している。
   *
   * 門は**写し全体**で比べる（`sameSnapshot`）。本文だけを見ると、往復の
   * あいだに打ったタイトルが載せ直しの `setTitle` に黙って捨てられ、確定値
   * まで正本の値へ進むので未保存の表示すら出ない。
   *
   * ED-04 の門はここでは**原理的に立たない**。呼び出しは保存後のビジュアル
   * モードに限られ（`commit` の `needsReseed`）、`needsWysiwygWarning` は
   * WYSIWYG へ載せるとき以外は即座に偽を返すからである。門を通る載せ直しは
   * 版の復元・競合の解決・退避の復元の 3 つで、WYSIWYG / HTML モードの保存
   * 後には載せ直しそのものが起きない（caret を飛ばさないため）。
   *
   * 載せ直せたら `true`。占有は呼び出し元がすでに取っている。
   */
  const reseedIfUnchanged = async (sent: EditorSnapshot): Promise<boolean> => {
    if (!sameSnapshot(takeSnapshot(), sent)) return false;
    await reseedFromServer(mode, false);
    return true;
  };

  const [, submitSave, isSubmitting] = useActionState(
    async (): Promise<null> => {
      await runExclusive({ kind: "saving" }, () => commit(true));
      return null;
    },
    null,
  );

  /**
   * 版を進めうる操作（保存・破棄・モード切替・版の復元・競合の解決）を
   * 受け付けられないか。占有（`activity`）に明示保存の pending と、本文に
   * 仮の要素が入っているあいだ（アップロード中）を足したもの。
   *
   * 版を進めない往復（`isSideBusy` — メディアの保管・版一覧の取得）は
   * **入れない**。書式ツールバー・メディア挿入・版一覧の取得は面の DOM を
   * 触るだけか読むだけで、止める理由が無い（打鍵と同じく、変更は確定値
   * との差として残り次の保存が拾う）。1.5 秒ごとの自動保存の
   * たびにそれらが暗くなると、「打てるが太字にできない」状態になる。
   */
  const busy = activity.kind !== "idle" || isSubmitting || uploading;

  /**
   * 新規作成の初回保存が落ちたまま（＝ノートがまだ無い）。もう一度送ると
   * 白紙のノートが 1 件増えるだけなので、保存の入口をすべて閉じる（自動
   * 保存は `failed` / `rejected` から自力で再開しない）。残す逃げ道は
   * 「内容をダウンロード」で、失敗の Alert が出している。
   */
  const creationFailed =
    identity.kind === "new" &&
    (status.kind === "failed" || status.kind === "rejected");

  // 初回保存で作られたノートの URL へ置き換える（PAGE-p12-002）。**書き
  // かけが残っているあいだは移らない** — 移った先の画面はサーバーの本文で
  // 開くので、往復のあいだに打った分がそこで消える。残っていれば自動保存が
  // 1.5 秒後に拾い、`dirty` が下りた描画でこの effect が移す。
  //
  // 遷移そのものは blocker を素通りさせる（`selfNavigateRef`）。自分が
  // 起こした遷移で自分の離脱確認を出しても、利用者に選べることは何も無い。
  useEffect(() => {
    if (createdNote === null || dirty || busy) return;
    const { noteId: createdId, workspaceId } = createdNote;
    setCreatedNote(null);
    selfNavigateRef.current = true;
    void router
      .navigate(
        workspaceId === null
          ? {
              to: "/notes/$noteId/edit",
              params: { noteId: createdId },
              replace: true,
            }
          : {
              to: "/workspaces/$workspaceId/notes/$noteId/edit",
              params: { noteId: createdId, workspaceId },
              replace: true,
            },
      )
      .catch(() => {
        console.error("Navigation to the created note failed");
      })
      .finally(() => {
        selfNavigateRef.current = false;
      });
  }, [createdNote, dirty, busy, router]);

  // 自動保存（ED-08）。落ち着いてから 1 回だけ走らせる。
  //
  // 走っている往復が 1 つでもあれば待つ。版を進めうる往復は互いに素で
  // なければならず（`runExclusive`）、破棄の往復中に自動保存が走ると
  // 破棄対象がそのままサーバーへ書き込まれる。`busy` を依存にも置くのは、
  // 往復の開始で保留中のタイマーを確実に落とすためである（タイマーが
  // すでに発火していても `runExclusive` が占有を取れずに空振りする）。
  //
  // 失敗・競合・拒否のあとは自分から再開しない。同じ入力を 1.5 秒ごとに
  // 投げ直すだけで、競合は解決されず、失敗はサーバーへの連打になり、
  // 決定的な拒否は同じ答えを返し続ける。再開は利用者の「再試行」か競合の
  // 解決、拒否なら内容を直す打鍵が起点になる（`markDirty` が `failed` /
  // `conflict` を打鍵で降ろさないのは、この条件を守るためである）。
  //
  // アップロード中も待つ（`busy` に畳んである）。本文にはまだ仮の要素が
  // 入っていて、それを保存すると `data-hollow-upload` が落ちた素の `span`
  // が本文に残る。
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `commit` は毎描画で作り直されるので依存に入れない（入れるとタイマーが打鍵のたびに張り直され、遅延が意味を失う）。代わりに `commit` が読む値（タイトル・本文・ビジュアルの差分）を並べてある — 規則から見ると余分だが、これがタイマーを張り直す唯一の根拠である。
  useEffect(() => {
    if (!dirty || !editable || busy) return;
    if (
      status.kind === "conflict" ||
      status.kind === "failed" ||
      status.kind === "rejected"
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        await runExclusive({ kind: "saving" }, () => commit(false));
      });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, editable, busy, status.kind, title, body, visualDirty]);

  const requestMode = (next: EditorMode): void => {
    if (next === mode) return;
    if (next === "visual" && !visualAvailable) return;
    if (dirty) {
      setPendingMode(next);
      return;
    }
    enterMode(next);
  };

  /**
   * ED-04 の警告を出すか。問いは**モードが変わるか**ではなく、
   * 「これから面へ載る本文の装飾が、いま面に載っている本文より多く
   * 落ちるか」である — WYSIWYG の面は `baseline` が変わるたびに無条件で
   * `<style>` を落とすので（`surfaces.tsx`）、モードを変えない載せ直し
   * （版の復元・競合の解決・退避の復元）でも装飾はそこで失われる。
   *
   * - WYSIWYG へ**入る**とき: 材料は `target.mayLoseDecoration`（取り込み
   *   由来か。島からは見えない値なので、サーバーコンポーネントが畳んで
   *   渡す）と、これから面へ載る本文が `<style>` を持つかの or。断片を
   *   描いた時点の本文で判定すると、そのあと HTML モードで貼って自動保存
   *   したスタイルシートが警告も版理由も無しに落ちる（自動保存は断片を
   *   描き直さない）
   * - すでに WYSIWYG に**居る**とき: 比較対象は面がいま持っている本文で、
   *   そこからは `<style>` が既に落ちている。だから載せ直す本文が
   *   `<style>` を持てば、それは面に無かった装飾がこれから落ちるという
   *   ことである。`mayLoseDecoration` は入る瞬間の材料なので**足さない**
   *   — 足すと、取り込み由来のノートで保存のたびに警告が出る
   *
   * 「今後表示しない」は**置いていない** — ED-04 は「設定画面から再表示に
   * 戻せる」ことまで込みで定めており、戻し口を持つ設定画面は本スライスの
   * 外にある。戻せない一方通行の抑止だけを先に出すと、一度押した端末では
   * 装飾の喪失が二度と告げられなくなる。
   */
  const needsWysiwygWarning = (next: EditorMode, nextBody: string): boolean => {
    if (next !== "wysiwyg") return false;
    if (mode !== "wysiwyg") {
      return (
        (target.kind === "existing" && target.mayLoseDecoration) ||
        willDropStyleElements(nextBody)
      );
    }
    // 面が組まれる前（ref が空）は「面には何も載っていない」と読む。
    // 取りこぼさない側へ倒す判断である — 過検出は警告が 1 回余分に出る
    // だけだが、見落とすと装飾が警告も版も無しに失われる。門のもう一方の
    // 材料（`NoteEditor/index.tsx` の `hasStyleElement`）も同じ向きで、
    // 2 つは or で使う。
    return (
      willDropStyleElements(nextBody) &&
      !willDropStyleElements(wysiwygRef.current?.innerHTML ?? "")
    );
  };

  /**
   * 門に掛かったときに本文を載せる面。**WYSIWYG から逃げる**のが要点で、
   * 据え置きでは面がそのまま `<style>` を落としてしまい、門が何も守らない
   * （ED-04 は「警告を了解するまで WYSIWYG に居ない」ことで装飾を守る）。
   * 逃げ先が HTML なのは、開いた直後の既定（`initialMode`）と同じ理由 —
   * `<style>` を落とさない面のうち、どんな本文でも開ける唯一のものである。
   *
   * 呼ぶと警告と保留中のモードも立てる。返り値をそのまま `seedMode` へ
   * 渡す形にしてあるのは、門を通す経路すべてで「載せる面の決め方」を
   * 1 か所に閉じるためである。
   */
  const surfaceModeFor = (
    next: EditorMode,
    nextBody: string,
    acknowledged: boolean,
  ): EditorMode => {
    if (acknowledged || !needsWysiwygWarning(next, nextBody)) return next;
    setWysiwygWarning(true);
    setPendingMode(next);
    return mode === "wysiwyg" ? "html" : mode;
  };

  /**
   * 利用者が選んだモードへ入る（モードのラジオと「保存して切り替える」）。
   * 端末の既定を書くのはここと {@link acknowledgeWysiwyg} だけである
   * （{@link switchMode} の JSDoc）。
   */
  const enterMode = (next: EditorMode): void => {
    // ここで見られる「これから載る本文」は確定値である。正本を引き直した
    // 結果が違っていたら `reseedFromServer` がもう一度同じ門を通す。
    if (needsWysiwygWarning(next, confirmedRef.current.body)) {
      setWysiwygWarning(true);
      setPendingMode(next);
      return;
    }
    writePreferredMode(next);
    applyMode(next);
  };

  /**
   * 面を差し替える（ED-05）。**サーバーが持っている本文を引き直してから**
   * 載せる。ここが要るのは、確定済みの本文を画面だけでは組み立てられない
   * ためである — ビジュアルモードの保存は経路単位の書き換えなので結果の
   * HTML が手元に無く、HTML / WYSIWYG の保存が返すのも除去の一覧だけで
   * サニタイズ後の本文ではない。手元の値で再シードすると、保存した編集が
   * 画面上で巻き戻り、そのまま次の自動保存でサーバーへ書き戻される。
   */
  const applyMode = (next: EditorMode, acknowledged = false): void => {
    if (identityRef.current.kind === "new") {
      setPendingMode(null);
      setWysiwygWarning(false);
      // まだサーバーに正本が無いので確定値をそのまま載せる。門は
      // `enterMode` がその同じ本文で通している。
      seedMode(next, confirmedRef.current.title, confirmedRef.current.body);
      return;
    }
    void runExclusive({ kind: "reseeding" }, async () => {
      // 確認を畳むのは占有を取れたときだけ。`runExclusive` は取れなければ
      // 黙って何もしないので、外で畳むと押した痕跡だけが消えてモードは
      // 変わらない。
      setPendingMode(null);
      setWysiwygWarning(false);
      try {
        await reseedFromServer(next, acknowledged);
      } catch (error) {
        setStatus(
          classifySaveFailure(error, {
            kind: "mode",
            mode: next,
            acknowledged,
          }),
        );
        return;
      }
      setProgressStatus({ kind: "idle" });
    });
  };

  /**
   * サーバーの正本で面ごと載せ直す（`applyMode` の JSDoc に理由がある）。
   * 失敗は投げる — 呼び出し元によって「モードを切り替えない」と「保存は
   * 通ったが面を載せ直せなかった」で扱いが違う。占有は呼び出し元が
   * すでに取っている。
   *
   * 引き直した正本が `canEdit === false` を告げたらその場で `blocked` に
   * する。載せ直しは権限喪失を**次の保存を待たずに**知れる唯一の機会で、
   * 見送ると面はふつうに書ける状態で載り、そこから書いた分は保存できずに
   * ダウンロードするしか残らない。
   *
   * ED-04 の門はここでも通す。引き直した本文こそが**面へ実際に載る本文**
   * であり、他の利用者がスタイルシートを足していれば手元の確定値には
   * 現れないためである。門に掛かったら、正本は載せたうえで面を
   * `<style>` を落とさないほうへ倒し（{@link surfaceModeFor}）、警告を
   * 出して了解を待つ（`acknowledged` で通り抜ける）。
   */
  const reseedFromServer = async (
    next: EditorMode,
    acknowledged: boolean,
  ): Promise<void> => {
    const current = identityRef.current;
    if (current.kind === "new") return;
    const latest = await readEditState({ data: { noteId: current.noteId } });
    rememberIdentity({
      kind: "existing",
      noteId: current.noteId,
      version: latest.version,
    });
    seedMode(
      surfaceModeFor(next, latest.html, acknowledged),
      latest.title,
      latest.html,
    );
    if (!latest.canEdit) {
      setStatus({ kind: "blocked", message: EDIT_PERMISSION_LOST });
    }
  };

  /**
   * 面のモードだけを切り替える。本文を載せるのは呼び出し元で、正本を
   * 確定させる載せ直し（{@link seedMode}）と、未保存の内容を面へ載せる
   * だけの経路（退避の復元・競合の上書き）で載せる値が違うためである。
   *
   * 端末の既定（`writePreferredMode`）は**ここでは書かない**。この関数は
   * 門の逃げ先（{@link surfaceModeFor} が返す強制された `html`）も通るので、
   * ここで書くと利用者が選んでいないモードが既定になる — WYSIWYG で作業
   * 中に `<style>` を持つ版を復元しただけで、以後どのノートを開いても
   * HTML で開くことになる。ED-05 が端末に持つと定めているのは「**選んだ**
   * モード」なので、書くのは利用者の操作に由来する 2 か所だけである
   * （{@link enterMode} と {@link acknowledgeWysiwyg}）。
   */
  const switchMode = (next: EditorMode): void => {
    // 変換として記録するのは WYSIWYG へ**入った**最初の保存だけ。同じ面へ
    // 載せ直す（破棄）ときは、まだ記録していない変換の予定を落とさない。
    wysiwygConversionRef.current =
      next === "wysiwyg" &&
      (mode !== "wysiwyg" || wysiwygConversionRef.current);
    setMode(next);
  };

  const seedMode = (
    next: EditorMode,
    nextTitle: string,
    nextBody: string,
  ): void => {
    switchMode(next);
    reseed(nextTitle, nextBody);
  };

  /**
   * 確定値を丸ごと置き換える（遷移その 2）。渡すのはサーバーが持っている
   * 正本で、面もその値で組み直す。
   *
   * 経路表を `null` へ落とすのは、面を組み直すまでサーバーの木と噛み合う
   * 表が手元に無いためである。面が組み上がると `onReady` が
   * {@link attachVisualPaths} で表を報せ、そこで初めて経路単位の保存が
   * 使える状態に戻る。
   */
  const reseed = (nextTitle: string, nextBody: string): void => {
    const next: EditorSnapshot = {
      title: nextTitle,
      body: nextBody,
      visual: null,
    };
    confirmedRef.current = next;
    setConfirmed(next);
    loadSurface(nextTitle, nextBody);
  };

  /**
   * 面が組み上がったことを確定値へ書く（遷移その 3）。受け取るのは
   * 経路表だけなので、タイトルと本文はここから動かせない — 部分的な
   * 確定を書ける入口はこれ 1 つで、触れる範囲が引数の型で閉じている。
   *
   * 経路単位で送ってよいのは、面が**確定値そのもの**から組まれたとき
   * だけである。退避の復元・競合の上書きは確定値と違う本文を面へ載せる
   * ので、その経路表はサーバーの木と噛み合わない。
   */
  const attachVisualPaths = (paths: ReadonlyMap<string, string>): void => {
    const next: EditorSnapshot = {
      ...confirmedRef.current,
      visual: { paths, pathwise: baseline === confirmedRef.current.body },
    };
    confirmedRef.current = next;
    setConfirmed(next);
  };

  /**
   * 面へ本文を載せる（確定はしない）。`baselineSeed` を必ず進めるのは、
   * 同じ文字列へ戻す差し替え（破棄）でもビジュアルの面を組み直させる
   * ためである。ビジュアルの経路表もここで捨てる — 残すと、破棄したはずの
   * 書き換えが次の差分に混ざって自動保存で送られる。
   *
   * サニタイズ通知と skip 通知も落とす。どちらも「直近の保存結果」を
   * 指す表示なので、正本を載せ直した面の上に前の保存の結果が残っては
   * ならない。
   *
   * アップロードの一覧も畳む。行が指しているのは**前の面に挿した仮の
   * 要素**で、載せ直した面にそれはもう無い。残すと、挿入を持たない
   * ビジュアルモードでも「再試行」が押せてしまい、面に出ない生の
   * `data-hollow-upload` が本文の末尾へ継ぎ足される（ED-06 の挿入は
   * HTML / WYSIWYG にしかない）。
   */
  const loadSurface = (nextTitle: string, nextBody: string): void => {
    setTitle(nextTitle);
    setBody(nextBody);
    setBaseline(nextBody);
    setBaselineSeed((value) => value + 1);
    setVisualDirty(false);
    setSelectedImage(null);
    setRemoved([]);
    setSkipped([]);
    setUploads([]);
    visualCurrent.current = new Map();
  };

  /**
   * 破棄（ED-08 手順 3）。**サーバーから正本を引き直す**のは、手元の
   * 「確定済みの値」が最後に保存した状態とは限らないためである — ビジュアル
   * モードの保存は経路単位の書き換えなので、確定した本文の HTML は
   * 手元に無く、保存の応答も除去の一覧しか返さない。`applyMode` と同じく
   * 引き直すしか手が無い。手元の値へ戻すと、
   * 画面は保存済みの書き換えが消えた姿になり、次の編集が古い `expected` で
   * 送られて全件 `contentChanged` に落ちる。
   */
  const discard = (): void => {
    if (noteId !== null) clearDraft(noteId);
    setDraftOffer(null);
    applyMode(mode);
  };

  /** 競合の解決（ED-08）。どちらの枝も最新の版を引き直してから進む。 */
  const resolveConflict = (keepLocal: boolean): void => {
    if (identityRef.current.kind === "new") return;
    // ビジュアルモードでもここで写しを取る。`body` state のままだと
    // 「自分の内容」が面の編集を 1 文字も含まない。
    const local = takeSnapshot();
    void runExclusive({ kind: "reseeding" }, async () => {
      const current = identityRef.current;
      if (current.kind === "new") return;
      const noteId = current.noteId;
      let latest: Awaited<ReturnType<typeof readEditState>>;
      try {
        latest = await readEditState({ data: { noteId } });
      } catch (error) {
        setStatus(classifySaveFailure(error, { kind: "conflict", keepLocal }));
        return;
      }
      rememberIdentity({ kind: "existing", noteId, version: latest.version });
      // 引き直した正本が権限喪失を告げたら、どちらの枝へも進まない
      // （`reseedFromServer` と同じ理由）。上書きは保存が必ず拒まれ、
      // 破棄は書きかけを捨てるだけになる。
      if (!latest.canEdit) {
        setStatus({ kind: "blocked", message: EDIT_PERMISSION_LOST });
        return;
      }
      if (keepLocal) {
        // 確定値は正本で置き換え、そのうえで自分の内容を**未保存の編集
        // として**面へ載せ直す。載せ直しは同じ 1 つの遷移を通るので、
        // ビジュアルの経路表は面が組み上がった時点で「正本と噛み合わない」
        // と判定される（`onReady`）— 次の保存は経路単位ではなく丸ごとの
        // `updateNoteBody` へ落ちる。
        //
        // 門の材料は面へ実際に載る `local.body` である。いまの面から取った
        // 写しなので、面が落とすものは既に落ちている＝門は普通は掛からない。
        const surface = surfaceModeFor(mode, local.body, false);
        reseed(latest.title, latest.html);
        switchMode(surface);
        loadSurface(local.title, local.body);
        setStatus({ kind: "dirty" });
        return;
      }
      // 破棄する側は正本がそのまま面へ載るので、門は正本に当てる。他の
      // 利用者が足したスタイルシートを、警告も版理由も無しに WYSIWYG の
      // 面へ流し込まないための 1 本である。
      seedMode(
        surfaceModeFor(mode, latest.html, false),
        latest.title,
        latest.html,
      );
      setStatus({ kind: "idle" });
      await reconcile();
    });
  };

  const openRevisions = (): void => {
    const current = identityRef.current;
    if (current.kind === "new") return;
    setRevisionError(null);
    startSide(async () => {
      try {
        const list = await listRevisions({ data: { noteId: current.noteId } });
        setRevisions(list.revisions);
      } catch (error) {
        setRevisionError(displayError(error));
        setRevisions([]);
      }
    });
  };

  const restore = (revisionId: string): void => {
    if (identityRef.current.kind === "new") return;
    void runExclusive({ kind: "restoring" }, async () => {
      const current = identityRef.current;
      if (current.kind === "new") return;
      try {
        const restored = await restoreRevision({
          data: {
            noteId: current.noteId,
            revisionId,
            expectedVersion: current.version,
          },
        });
        rememberIdentity({
          kind: "existing",
          noteId: current.noteId,
          version: restored.version,
        });
        // 門は通す（`acknowledged` を立てない）。復元は**変換前の版へ
        // 戻す**操作なので、戻した本文が `<style>` を持つのはむしろ普通で、
        // WYSIWYG に居るまま載せると復元したはずの装飾がその場で落ちる。
        await reseedFromServer(mode, false);
        setProgressStatus({ kind: "saved" });
        setSavedAt(new Date());
        setRevisions(null);
      } catch (error) {
        setStatus(classifySaveFailure(error, { kind: "revision", revisionId }));
        return;
      }
      await reconcile();
    });
  };

  /**
   * HTML モードで続けて挿すときの次の位置。1 回のドロップに複数の
   * ファイルが来ると挿入はループの中で同期に走るので、あいだに再描画が
   * 入らず `textarea` の選択位置は 2 件目以降も 1 件目のままになる。
   * 挿し終えた位置を持ち回って前へ進めないと、選択範囲があるときに
   * 前の仮の要素を途中で切り落としてしまう。
   */
  const insertAtRef = useRef<number | null>(null);

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
    const pending = insertAtRef.current;
    const start = pending ?? textarea.selectionStart;
    const end = pending ?? textarea.selectionEnd;
    insertAtRef.current = start + markup.length;
    setBody((value) => value.slice(0, start) + markup + value.slice(end));
  };

  /**
   * 挿入した仮の要素を、保管できた要素で置き換える（`markup` が空なら
   * 取り除く）。WYSIWYG の本文は DOM が正本で HTML モードは文字列なので、
   * 面が持っているほうを直してから本文の state を揃える。
   *
   * 差し込んだ要素を返すのは、画像なら代替テキストの編集対象にできる
   * ようにするため（ED-06 手順 4）。
   */
  const settlePlaceholder = (id: string, markup: string): Element | null => {
    const surface = wysiwygRef.current;
    const node = surface?.querySelector(`[data-hollow-upload="${id}"]`) ?? null;
    if (surface !== null && node !== null) {
      const template = document.createElement("template");
      template.innerHTML = markup;
      const inserted = template.content.firstElementChild;
      if (inserted === null) {
        node.remove();
      } else {
        node.replaceWith(inserted);
      }
      setBody(surface.innerHTML);
      markDirty();
      return inserted;
    }
    // 置換値は**関数で**渡す。文字列で渡すと `$&` / `$'` / `` $` `` が
    // 展開され、`a$'b.png` のようなファイル名が本文の後半を `alt` の
    // 中へ生で流し込んで要素の境界を壊す（`escapeAttribute` は `$` を
    // 落とさない）。関数の戻り値はそのまま入る。
    setBody((value) => value.replace(placeholderPattern(id), () => markup));
    markDirty();
    return null;
  };

  const upload = (
    file: File,
    options: Readonly<{ retryOf?: string; batched?: boolean }> = {},
  ): void => {
    const { retryOf, batched = false } = options;
    // 単発の挿入は面の選択位置から始める。持ち回っている位置は 1 回の
    // ドロップの中でしか意味を持たない。
    if (!batched) insertAtRef.current = null;
    if (retryOf !== undefined) {
      setUploads((list) => list.filter((entry) => entry.id !== retryOf));
    }
    // 仮の要素は入れない。上限超えは往復しても答えが変わらないので、
    // 本文へ差し込んでから取り除く意味が無い。
    if (file.size > mediaLimitFor(file.type)) {
      setUploads((list) => [
        ...list,
        {
          id: nextUploadId(),
          name: file.name,
          status: "failed",
          message: OVERSIZE_MESSAGE,
          file,
        },
      ]);
      return;
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
    setUploads((list) => [...list, entry]);
    startSide(async () => {
      try {
        const payload = new FormData();
        payload.set("file", file);
        payload.set("noteId", noteId);
        const stored = await uploadMedia({ data: payload });
        const inserted = settlePlaceholder(
          id,
          mediaMarkup(stored.url, stored.mimeType, file.name),
        );
        // 続けて代替テキストを入れられるよう、入った画像を選んでおく。
        if (inserted instanceof HTMLImageElement) setSelectedImage(inserted);
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

  /**
   * ドロップは 1 件ずつ流す（ED-06 手順 1 の「本文にドロップする」）。
   * ループのあいだだけ挿入位置を持ち回り、抜けたら捨てる。
   */
  const uploadAll = (files: readonly File[]): void => {
    insertAtRef.current = null;
    for (const file of files) upload(file, { batched: true });
    insertAtRef.current = null;
  };

  /**
   * 代替テキストの編集（ED-06 手順 4）。WYSIWYG の本文は DOM が正本
   * なので属性を直に書き換え、そのあとで本文の state を揃える。
   */
  const editAlternativeText = (): void => {
    const surface = wysiwygRef.current;
    if (selectedImage === null || surface === null) return;
    if (!surface.contains(selectedImage)) {
      setSelectedImage(null);
      return;
    }
    const next = window.prompt(
      "画像の代替テキスト",
      selectedImage.getAttribute("alt") ?? "",
    );
    if (next === null) return;
    selectedImage.setAttribute("alt", next);
    setBody(surface.innerHTML);
    markDirty();
  };

  /**
   * ED-04 の警告の「了解して進む」。
   *
   * 面に未保存の内容があるときは**正本を引き直さない**。門を立てる 3 経路
   * のうち退避の復元だけは未保存の内容を面に載せたまま門へ入るので、
   * `applyMode` の引き直しをそのまま通すと、いま復元した内容がサーバーの
   * 正本で丸ごと置き換わる（利用者から見ると「復元した内容が了解と同時に
   * 消えて、また復元を勧められる」）。モードのラジオが未保存の変更に確認を
   * 挟むのと同じ扱いで、ここでは面だけを差し替えて中身は残す。
   *
   * 未保存が無いときは他の 2 経路と同じく引き直す — 面の内容は確定値と
   * 同じなので、引き直しても失われるものが無く、他の利用者の更新まで
   * 取り込める。
   */
  const acknowledgeWysiwyg = (): void => {
    const next = pendingMode;
    if (next === null) return;
    writePreferredMode(next);
    if (!dirty) {
      applyMode(next, true);
      return;
    }
    setWysiwygWarning(false);
    setPendingMode(null);
    const kept = takeSnapshot();
    switchMode(next);
    loadSurface(kept.title, kept.body);
    setStatus({ kind: "dirty" });
  };

  /**
   * 面を正本で載せ直す再試行の前に、未保存の内容を保存しておく
   * （{@link retryFailed}）。保存が通らなければ載せ直さない — 載せ直しは
   * 面を保存済みの内容へ戻すので、通らないまま進むと打鍵がそこで消える。
   * 「保存して切り替える」の主ボタンと同じ順であり、新しい確認は挟まない。
   */
  const reseedAfterSaving = (reseedAgain: () => void): void => {
    if (!dirty) {
      reseedAgain();
      return;
    }
    void (async () => {
      const saved = await runExclusive({ kind: "saving" }, () => commit(true));
      if (saved === true) reseedAgain();
    })();
  };

  /**
   * `failed` の「再試行」。**落ちた往復そのもの**を送り直す
   * （{@link RetryTarget}）。保存に固定すると、版の復元が通信エラーで
   * 落ちたあとの「再試行」が復元ではなく本文の保存を走らせる。
   *
   * 面を正本で載せ直す 2 つ（`mode` / `revision`）には、モードのラジオと
   * 同じ門を先に置く（{@link reseedAfterSaving}）。`failed` でも面は
   * `editable` のままなので利用者は失敗の Alert を見ながら打ち続けられ、
   * 門が無いと「再試行」が `discard` と同じ置き換えになってその打鍵を確認
   * なしに捨てる。
   *
   * `RetryTarget` 4 種 × `dirty` の 8 通りは次のとおりで、どれも打鍵を
   * 黙って捨てない。
   *
   * | 対象 | `dirty` | 押すと走るもの | 通ったとき | 落ちたとき |
   * | --- | --- | --- | --- | --- |
   * | `save` | 偽 | `commit(true)`（`explicit` なので差が無くても送る） | 落ちていた保存が確定して `saved` | `{ kind: "save" }` の `failed` を出し直す |
   * | `save` | 真 | `commit(true)`。送るのは写しを取り直した**いまの面**なので、失敗後の打鍵も一緒に届く | 同上 | 同上 |
   * | `mode` | 偽 | `applyMode`（正本を引き直して面ごと載せ直す） | モードが変わり `idle` | `{ kind: "mode" }` の `failed` |
   * | `mode` | 真 | `commit(true)` → 通れば `applyMode` | 打鍵が保存されてからモードが変わる | 保存が落ちたら載せ直さず `{ kind: "save" }` の `failed`。面の内容はそのまま残る |
   * | `conflict` | 偽 | `resolveConflict(keepLocal)` | 選んだ枝で解決（上書きは `dirty`、破棄は `idle`） | `{ kind: "conflict" }` の `failed` |
   * | `conflict` | 真 | 同上（門は置かない） | 上書きは面の写しを取り直して未保存のまま載せ直すので打鍵が残り、破棄はまさにそれを捨てる操作である | 同上 |
   * | `revision` | 偽 | `restore(revisionId)` | 本文がその版になり `saved` | `{ kind: "revision" }` の `failed` |
   * | `revision` | 真 | `commit(true)` → 通れば `restore(revisionId)` | 打鍵が版として記録されてから復元が走るので、戻したくなればその版から戻せる | 保存が落ちたら復元せず `{ kind: "save" }` の `failed` |
   *
   * `conflict` に門を置かないのは、そこでは保存そのものが止まっている
   * ためである — 先に `commit` を通しても同じ競合でもう一度落ちるだけで、
   * 解決の 2 枝へ進めなくなる。
   *
   * 保存が通ったあとの面の載せ直しはこの表に無い。落ちても `failed` に
   * せず、経路単位で送れる印を降ろして次の保存に噛み合わせ直させる
   * （{@link dropPathwise}）。
   */
  const retryFailed = (target: RetryTarget): void => {
    switch (target.kind) {
      case "save":
        void runExclusive({ kind: "saving" }, () => commit(true));
        return;
      case "mode":
        reseedAfterSaving(() => applyMode(target.mode, target.acknowledged));
        return;
      case "conflict":
        resolveConflict(target.keepLocal);
        return;
      case "revision":
        reseedAfterSaving(() => restore(target.revisionId));
        return;
    }
  };

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
            // 切り替えは正本の引き直しを挟むので、往復の最中は受け付け
            // ない（重ねて押すと後着が勝ち、面と `mode` が食い違う）。
            const disabled =
              (candidate === "visual" && !visualAvailable) || !editable || busy;
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

        {/* 破棄も版を進めうる往復（正本の引き直し）なので、面ごと凍って
            いるあいだは落とす。押せると、権限を失ったノートで唯一操作
            できるボタンとして残ってしまう。 */}
        <button
          type="button"
          onClick={discard}
          disabled={!dirty || busy || !editable}
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
                  disabled={busy}
                  onClick={() => {
                    // 退避は**未保存**の内容なので、確定値は動かさない
                    // （面へ載せるだけ）。動かすと復元した瞬間に
                    // 「保存済み」になり、次の自動保存が走らずサーバーへ
                    // 届かない。
                    //
                    // ビジュアルモードでは面の外から入った本文になるので、
                    // 面が組み上がった時点で経路表は「正本と噛み合わない」
                    // と判定され、次の保存は丸ごとの `updateNoteBody` へ
                    // 落ちる（`onReady`）。
                    //
                    // 退避は HTML モードで書かれた本文でもありうるので、
                    // ED-04 の門もここで通す。掛かったら `<style>` を
                    // 落とさない面へ倒してから載せる — 倒さずに載せると、
                    // 退避したはずの装飾が復元の瞬間に落ちる。
                    switchMode(surfaceModeFor(mode, draftOffer.html, false));
                    loadSurface(draftOffer.title, draftOffer.html);
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
                onClick={() => {
                  const snapshot = takeSnapshot();
                  downloadBody(snapshot.title, snapshot.body);
                }}
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
              // 再試行を出さないのは**ノートがまだ作られていない**ときだけ
              // である。作成は冪等ではなく（冪等鍵は作成そのものの持ち分で、
              // この画面からは運べない）、応答が届かなかった往復の結果を
              // 画面から知る術も無いため、押すたびに白紙のノートが 1 件ずつ
              // 増える。逃げ道は「権限喪失」と同じダウンロードにする。
              //
              // 退避できたかどうかでは分けない。退避を書けるのは保存の
              // `catch` だけで、モード切替・競合の解決・版の復元が通信
              // エラーで落ちたときは退避が無いまま `failed` になる —
              // そこは既存のノートなので、再試行こそが逃げ道である。
              // 送り直すのは**落ちた往復そのもの**（`status.retry`）で、
              // 本文の保存に固定しない。
              creationFailed ? (
                <button
                  type="button"
                  className={smallGhostClass}
                  onClick={() => {
                    const snapshot = takeSnapshot();
                    downloadBody(snapshot.title, snapshot.body);
                  }}
                >
                  内容をダウンロード
                </button>
              ) : (
                <button
                  type="button"
                  className={smallPrimaryClass}
                  disabled={busy}
                  onClick={() => retryFailed(status.retry)}
                >
                  再試行
                </button>
              )
            }
          >
            {status.message}{" "}
            {creationFailed
              ? "ノートがまだ作られていないため、内容はこの端末に退避できていません。ダウンロードして残してください。"
              : status.stashed
                ? "内容はこの端末に退避したので、次に開いたときに復元できます。"
                : "内容はまだこの端末に退避していません。もう一度お試しください。"}
          </Alert>
        ) : null}

        {status.kind === "rejected" ? (
          <Alert
            tone="error"
            title="この内容は保存できません"
            actions={
              // 再試行は出さない（同じ内容を送るかぎり必ず同じ答えが
              // 返る）。ノートがまだ作られていない場合だけは内容を持ち
              // 出す先が要る — 再送は白紙のノートを増やすだけなので、
              // 保存の入口はすべて閉じてある。
              creationFailed ? (
                <button
                  type="button"
                  className={smallGhostClass}
                  onClick={() => {
                    const snapshot = takeSnapshot();
                    downloadBody(snapshot.title, snapshot.body);
                  }}
                >
                  内容をダウンロード
                </button>
              ) : undefined
            }
          >
            {status.message}{" "}
            {creationFailed
              ? "ノートはまだ作られていないため、このまま保存し直すことはできません。ダウンロードして残してください。"
              : "内容を直すと自動保存を再開します。"}
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
                  disabled={busy}
                  onClick={acknowledgeWysiwyg}
                >
                  了解して進む
                </button>
                {/* ED-04 の「今後表示しない」はここに置かない。戻し口
                    （設定画面からの再表示）が本スライスの外にあり、
                    出すと一度きりの不可逆な抑止になるため。 */}
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
            このノートは書かれたままの HTML
            を保っています。エディタが解釈できない装飾のほか、本文に埋め込まれたスタイルシート（取り込んだ外部スタイルシートとその取り込み元の記録を含む）も失われます。保存の直前に版が記録されるので、あとから戻せます。
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
                  disabled={busy || creationFailed}
                  onClick={() => {
                    // 保存と切り替えは版を進めうる往復 2 つなので、直列に
                    // 並べて 1 つずつ占有を取る。保存が通らなかったら
                    // 切り替えない — 切り替えは面を保存済みの内容へ戻す
                    // ので、失敗したまま進むと書きかけがそこで消える。
                    void (async () => {
                      const saved = await runExclusive({ kind: "saving" }, () =>
                        commit(true),
                      );
                      if (saved === true) enterMode(pendingMode);
                    })();
                  }}
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
              {removed.map((entry, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 除去の一覧は出現ごとに 1 件積む派生値で、同じ要素が 2 つあれば `kind` / `name` / `reason` の 3 列は必ず一致する。並べ替えも部分更新も起きない。
                <li key={`${index}:${entry.kind}:${entry.name}`}>
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
            か所の書き換えを適用できませんでした。必要ならもう一度書き換えてください。
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
            markDirty();
          }}
          className="mb-6 block w-full border-none bg-transparent p-0 text-3xl font-normal tracking-tightest text-ink outline-none [caret-color:var(--color-accent)] placeholder:text-ink-tertiary"
        />

        {mode === "wysiwyg" ? (
          // 書式のコマンドは面の DOM を触るだけで往復を持たないので、
          // 保存中も落とさない（落とすと「打てるが太字にできない」）。
          <FormatBar
            disabled={!editable}
            onCommand={(command, value) => {
              wysiwygRef.current?.focus();
              document.execCommand(command, false, value);
              const surface = wysiwygRef.current;
              if (surface !== null) {
                setBody(surface.innerHTML);
                markDirty();
              }
            }}
            onPickMedia={upload}
            hasImageSelection={selectedImage !== null}
            onEditAlternativeText={editAlternativeText}
          />
        ) : null}

        {mode === "wysiwyg" ? (
          <WysiwygSurface
            baseline={baseline}
            editable={editable}
            surfaceRef={wysiwygRef}
            onChange={(html) => {
              setBody(html);
              markDirty();
            }}
            onSelectImage={setSelectedImage}
            onDropFiles={editable ? uploadAll : null}
          />
        ) : mode === "html" ? (
          <HtmlSurface
            value={body}
            editable={editable}
            textareaRef={sourceRef}
            onChange={(html) => {
              setBody(html);
              markDirty();
            }}
            onDropFiles={editable ? uploadAll : null}
          />
        ) : (
          <VisualSurface
            baseline={baseline}
            seed={baselineSeed}
            editable={editable}
            onReady={(paths) => {
              visualCurrent.current = paths;
              attachVisualPaths(paths);
              setVisualDirty(false);
            }}
            onChange={(current) => {
              visualCurrent.current = current;
              setVisualDirty(
                diffTextNodeEdits(
                  confirmedRef.current.visual?.paths ?? EMPTY_PATHS,
                  current,
                ).length > 0,
              );
              markDirty();
            }}
          />
        )}

        {uploads.length > 0 ? (
          <ul className="mt-4 space-y-1" aria-live="polite">
            {uploads.map((entry) => (
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
                      disabled={!editable}
                      onClick={() => upload(entry.file, { retryOf: entry.id })}
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
                    {/* 版の復元は破棄よりさらに強い「版を進める往復」
                        （`runExclusive({kind:"restoring"})`）なので、面ごと
                        凍っているあいだは破棄と同じく落とす。押せると、
                        権限を失ったノートで唯一操作できるボタンとして
                        残り、サーバーの拒否で `blocked` に戻るだけの
                        空振りになる。 */}
                    <button
                      type="button"
                      className={smallGhostClass}
                      disabled={busy || !editable}
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
            // 保管は版を進めない（`startSide`）ので、保存中も挿せる。
            <MediaButton disabled={!editable} onPick={upload} />
          )}
          <button
            type="button"
            className={actionButtonClass}
            // 一覧の取得は版を進めないが、面ごと凍っているあいだは落とす
            // — 一覧が出す操作は「復元」だけで、それは版を進める往復で
            // ある。開けても全行が押せない一覧を見せる意味が無い。
            disabled={noteId === null || isSideBusy || !editable}
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
            disabled={!editable || busy || creationFailed}
            aria-busy={busy}
            className="inline-flex h-9 items-center rounded-pill bg-accent px-4 text-sm font-medium text-bg transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-55"
          >
            {activity.kind === "saving" || isSubmitting ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * ビジュアルモードの経路表を HTML へ当て直す。面は本文の
 * state を動かさないので、退避・ダウンロード・丸ごとの保存に要る「いま
 * 面が持っている本文」はここで組む。
 *
 * 経路は面と同じ `baseline` を同じ走査（`collectEditableTextNodes`）で
 * 数えるので、面が付けた経路とそのまま噛み合う。
 */
const composeEditedHtml = (
  html: string,
  current: ReadonlyMap<string, string>,
): string => {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const entry of collectEditableTextNodes(template.content)) {
    const text = current.get(entry.path);
    if (text !== undefined && text !== entry.text) entry.node.nodeValue = text;
  }
  return template.innerHTML;
};

/**
 * 正本を引き直したときに `canEdit === false` だった場合の案内（ED-08 の
 * 「権限喪失」）。保存の応答から来る `blocked` と違い、ここには元になる
 * エラーが無いので文言を持つ。
 */
const EDIT_PERMISSION_LOST =
  "このノートを編集する権限が失われました。書いた内容はダウンロードして持ち出せます。";

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
      case "rejected":
        return "保存できません";
      case "new":
        return "未保存";
      default:
        if (dirty) return "未保存";
        return savedAt === null ? "" : "保存済み";
    }
  })();
  const tone =
    status.kind === "failed" ||
    status.kind === "rejected" ||
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

/**
 * 断る文言は許可集合そのものから組む。表を書き写すと、集合が増えたときに
 * 案内だけが古いまま残る。
 */
const LINK_SCHEME_REJECTED = `リンク先には ${Array.from(NAVIGATION_SCHEMES).join(" / ")} の URL か、同じサイト内の相対パスだけを指定できます。`;

function FormatBar({
  disabled,
  onCommand,
  onPickMedia,
  hasImageSelection,
  onEditAlternativeText,
}: {
  disabled: boolean;
  onCommand: (command: string, value?: string) => void;
  onPickMedia: (file: File) => void;
  hasImageSelection: boolean;
  onEditAlternativeText: () => void;
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
          if (url === null || url.length === 0) return;
          // 面は live DOM なので、`javascript:` の `href` はこの画面
          // （アプリのオリジン）でそのまま走る — 保存時のサニタイズは
          // 永続化を防ぐだけで、セッション中の実行は防がない。
          if (!isAllowedUrl(url, "navigation")) {
            window.alert(LINK_SCHEME_REJECTED);
            return;
          }
          onCommand("createLink", url);
        }}
        className="inline-flex h-[30px] items-center rounded-pill px-3 text-xs text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
      >
        リンク
      </button>
      <MediaButton disabled={disabled} onPick={onPickMedia} compact />
      {/* ED-06 手順 4「画像は代替テキストを入力できる」。対象は本文で
          選んでいる画像で、挿入した直後はその画像が選ばれている。 */}
      <button
        type="button"
        disabled={disabled || !hasImageSelection}
        onClick={onEditAlternativeText}
        className="inline-flex h-[30px] items-center rounded-pill px-3 text-xs text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
      >
        代替テキスト
      </button>
    </div>
  );
}

/** 受理される形式はドメインの `UploadValidationPolicy` が持つ表が正典。 */
const MEDIA_ACCEPT = MEDIA_ALLOWED_MIME_TYPES.join(",");

/**
 * 大きすぎるファイルは送る前に止める（ED-06）。止めないと、200 MB の動画も
 * 128 KB を超える SVG も転送境界（256 MB）まで往復してから拒まれる。
 * しきい値も文言も判定側と同じ出所から引くので、ドメインが上限を変えれば
 * 追随する（`UploadValidationPolicy` が「フォームへ上限を配る」と約束して
 * いる相手がこれである）。
 *
 * 手掛かりはブラウザーが名乗る `file.type` だけで、受理の判定はバイト列の
 * 署名で行われる。名乗りが当てにならない以上**厳しい側へは倒さない** —
 * 見覚えの無い型はいちばん緩い上限で通し、判定はサーバーに委ねる。
 */
const mediaLimitFor = (mimeType: string): number => {
  if (mimeType === "image/svg+xml") return MEDIA_SVG_MAX_BYTES;
  if (mimeType.startsWith("image/")) return MEDIA_IMAGE_MAX_BYTES;
  return MEDIA_VIDEO_MAX_BYTES;
};

const OVERSIZE_MESSAGE = renderErrorMessage({
  kind: "business",
  code: StorageErrorCode.FileTooLarge,
  message: "",
});

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
    [
      `<!doctype html><meta charset="utf-8"><title>${escapeText(title)}</title>${html}`,
    ],
    { type: "text/html" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title || "note"}.html`;
  document.body.append(anchor);
  anchor.click();
  // `click()` が保証するのはダウンロードの**開始**だけである。同じタスクの
  // 中で失効させると、ブラウザーによってはフェッチが始まる前に URL が
  // 無効になり、権限を失ったときの唯一の逃げ道が黙って失敗する。
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
