/**
 * P-12 の保存状態と、往復が投げたものをその状態へ写す規則。
 *
 * 島（`editor.tsx`）から出してあるのは、`spec/pages/index.md` の P-12
 * 状態表「保存できません（内容の拒否）」が**閉じた集合**として書かれて
 * いるためである。閉じる向きが逆転しても型は通るので、規則そのものを
 * 表で固定できる位置に置く（`docs/test.md`「島から持ち上げた純関数」）。
 */

import { renderErrorMessage } from "@/presentation/errorDisplay";
import {
  extractSerializedError,
  type SerializedErrorKind,
} from "@/presentation/errorResponse";
import type { EditorMode } from "./preferences";

/**
 * 落ちた往復を、もう一度だけ送り直せる形にしたもの。`failed` の「再試行」
 * が押す先である。
 *
 * **一次経路と 1 対 1** に対応する 5 種で閉じてある。再試行は対応する
 * 一次経路の入口を呼ぶだけで、再試行に固有の判断（独自の分岐・独自の門）
 * は持たない。多対一の対応を許すと、同じ `kind` を通る 2 つの操作のうち
 * 片方にしか当てはまらない扱いが再試行に紛れ込む。
 *
 * | 種類 | 一次経路 | 再試行が呼ぶ入口 |
 * | --- | --- | --- |
 * | `save` | 自動保存・明示保存 | `commit(true)` |
 * | `mode` | モードのラジオ・WYSIWYG 警告の了解 | `requestMode(mode, acknowledged)` |
 * | `conflict` | 競合の「上書き」「破棄」 | `resolveConflict(keepLocal)` |
 * | `revision` | 版一覧の「復元」 | `restore(revisionId)` |
 * | `reload` | 破棄 | `reloadFromServer()` |
 *
 * 保存が確定したあとの面の載せ直しはこの 5 種に入らない。保存はもう
 * 確定しているので、載せ直しが落ちても状態は `saved` のままであり、
 * 降ろすのは経路単位で送れる印だけで再試行の対象にはならない。
 */
export type RetryTarget =
  | Readonly<{ kind: "save" }>
  | Readonly<{ kind: "mode"; mode: EditorMode; acknowledged: boolean }>
  | Readonly<{ kind: "conflict"; keepLocal: boolean }>
  | Readonly<{ kind: "revision"; revisionId: string }>
  | Readonly<{ kind: "reload" }>;

export type SaveStatus =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "dirty" }>
  | Readonly<{ kind: "saving" }>
  | Readonly<{ kind: "saved" }>
  /**
   * 往復そのものが成立しなかった失敗。`stashed` は**実際に端末へ退避
   * できたか**で、退避の鍵が `noteId` である以上、まだ作られていない
   * ノートでは偽になる。ただし偽の意味は「退避していない」だけで、
   * 「ノートが無い」ではない — 保存以外の往復（モード切替・競合の解決・
   * 版の復元・正本の引き直し）が落ちたときも偽で入る。退避を書けるのは
   * 保存の `catch` だけだからである。
   *
   * したがって案内と逃げ道（再試行 / ダウンロード）を分けるのは
   * `creationFailed` のほうで、この値が語るのは「次に開けば復元できる」
   * の 1 文だけである — 退避していないのに「退避した」と告げると、
   * 利用者はそれを信じて画面を離れる。
   *
   * `retry` は落ちた往復そのもの（{@link RetryTarget}）。
   */
  | Readonly<{
      kind: "failed";
      message: string;
      stashed: boolean;
      retry: RetryTarget;
    }>
  /**
   * 決定的な業務拒否。同じ内容を送るかぎり必ず同じ答えが返るので、
   * `failed` と違って再試行も端末への退避も出さない — 解けるのは利用者が
   * 内容を直したときだけである。集合の決め方は
   * {@link classifySaveFailure} が持つ。
   */
  | Readonly<{ kind: "rejected"; message: string }>
  /** 他者の更新。上書きするか破棄するかを選ばせる。 */
  | Readonly<{ kind: "conflict" }>
  /** 変換・再生成のジョブが実行中。編集を受け付けず完了を待つよう案内する。 */
  | Readonly<{ kind: "locked" }>
  /** 権限喪失・ゴミ箱。内容のダウンロードを出す。 */
  | Readonly<{ kind: "blocked"; message: string }>;

/**
 * 面ごと凍らせる失敗。ノートがもう編集の対象でないことを告げるので、
 * 内容を直しても再送しても解けない。残す逃げ道は内容のダウンロードだけ。
 */
export const BLOCKING_ERROR_CODES: ReadonlySet<string> = new Set([
  "NOTE_NOT_FOUND",
  "NOTE_ACCESS_DENIED",
  "NOTE_IS_TRASHED",
  "WORKSPACE_INSUFFICIENT_ROLE",
]);

/**
 * 往復そのものが成立しなかった失敗の `kind`。**再試行のボタンと端末への
 * 退避を出してよいのはここだけ**である。
 *
 * - `system` / `unknown` — 通信断・サーバー側の障害。同じ内容があとで通る
 * - `unauthorized` — 途中でセッションが切れた。サインインし直せば同じ
 *   内容がそのまま通るので、退避して次に開いたときに復元させるのが正しい
 *
 * 集合を**この向きで**閉じているのが要点である。拒否コードを列挙する形に
 * すると、ドメインが新しい拒否を足すたびにここが取りこぼし、成功しえない
 * 「再試行」と上限を超えた本文の `localStorage` への書き込みが同時に
 * 起きる。逆向きに閉じておけば、増えた拒否は既定で `rejected`（再試行も
 * 退避も出さない側）へ落ちる — 誤るとしても「一時的な失敗を決定的な拒否
 * として出す」方向にしかならず、内容を直す打鍵で降りて自動保存が再開する。
 */
export const TRANSIENT_ERROR_KINDS: ReadonlySet<SerializedErrorKind> = new Set([
  "system",
  "unknown",
  "unauthorized",
]);

/**
 * `failed` の見出し。落ちた往復ごとに分けるのは、見出しが**押した操作の
 * 結果**を語るためである — 版の復元が落ちたときに「保存できませんでした」
 * と出すと、利用者は保存されていない打鍵を探しに行く。
 */
const FAILED_TITLE: Readonly<Record<RetryTarget["kind"], string>> = {
  save: "保存できませんでした",
  mode: "モードを切り替えられませんでした",
  conflict: "競合を解決できませんでした",
  revision: "版を復元できませんでした",
  reload: "最新の内容を読み込めませんでした",
};

/**
 * 上部バーが出す `failed` の短いラベル。{@link FAILED_TITLE} と同じ理由で
 * 往復ごとに分ける — Alert の見出しだけを分けても、同じ画面のバーが
 * 「保存に失敗しました」と言えば利用者は保存されていない打鍵を探しに行く。
 * バーは幅が狭いので、見出しより短い言い回しを持つ。
 */
export const FAILED_LABEL: Readonly<Record<RetryTarget["kind"], string>> = {
  save: "保存に失敗しました",
  mode: "切り替えに失敗しました",
  conflict: "解決に失敗しました",
  revision: "復元に失敗しました",
  reload: "読み込みに失敗しました",
};

/** 往復そのものが成立せず、面もサーバーも動いていない。 */
const UNCHANGED_HINT = "面の内容はそのままです。もう一度お試しください。";

const FAILED_HINT: Readonly<Record<RetryTarget["kind"], string>> = {
  save: "内容はまだこの端末に退避していません。もう一度お試しください。",
  mode: UNCHANGED_HINT,
  conflict: UNCHANGED_HINT,
  revision: UNCHANGED_HINT,
  reload: UNCHANGED_HINT,
};

/**
 * 退避できたときの案内。`stashed` が真になるのは保存の `catch` だけで、
 * 他の往復は退避を書かない。
 */
const STASHED_HINT =
  "内容はこの端末に退避したので、次に開いたときに復元できます。";

/**
 * ノートがまだ作られていないときの案内。退避の鍵は `noteId` なので退避
 * そのものが成立せず、残る逃げ道はダウンロードだけである。
 */
const CREATION_FAILED_HINT =
  "ノートがまだ作られていないため、内容はこの端末に退避できていません。ダウンロードして残してください。";

/**
 * `failed` の Alert が出す見出しと案内。表を島の外へ出してあるのは
 * {@link RetryTarget} の 5 種と 1 対 1 であることを型で閉じるためで、
 * 種類が増えれば `Record` がその場でコンパイルエラーになる。
 */
export const describeFailure = (
  status: Readonly<{ stashed: boolean; retry: RetryTarget }>,
  creationFailed: boolean,
): Readonly<{ title: string; hint: string }> => ({
  title: FAILED_TITLE[status.retry.kind],
  hint: creationFailed
    ? CREATION_FAILED_HINT
    : status.stashed
      ? STASHED_HINT
      : FAILED_HINT[status.retry.kind],
});

/**
 * 版を進めうる往復が投げたものを、この画面の状態へ写す純関数。
 *
 * 5 つの `catch`（保存・モード切替・競合の解決・版の復元・正本の引き直し）
 * が共有するので、「何が落ちたか」は呼び出し元が {@link RetryTarget} で
 * 渡す。
 *
 * 決定的な業務拒否（`rejected`）は `spec/pages/index.md` の P-12 状態表
 * 「保存できません（内容の拒否）」に対応する。集合は
 * {@link TRANSIENT_ERROR_KINDS} の補集合として閉じてあり、列挙していない
 * コードは既定でこちらへ落ちる。
 */
export const classifySaveFailure = (
  error: unknown,
  retry: RetryTarget,
): SaveStatus => {
  const serialized = extractSerializedError(error);
  const message = renderErrorMessage(serialized);
  const code = serialized.code;
  if (code === "OPTIMISTIC_LOCK_FAILURE") return { kind: "conflict" };
  if (code === "NOTE_LOCKED_BY_JOB") return { kind: "locked" };
  if (code !== null && BLOCKING_ERROR_CODES.has(code)) {
    return { kind: "blocked", message };
  }
  if (TRANSIENT_ERROR_KINDS.has(serialized.kind)) {
    // 退避したかどうかを知っているのは `writeDraft` を呼ぶ側だけなので、
    // ここでは「していない」から始める。
    return { kind: "failed", message, stashed: false, retry };
  }
  return { kind: "rejected", message };
};
