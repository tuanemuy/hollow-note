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
 * 4 つの `catch`（保存・モード切替・競合の解決・版の復元）が同じ `failed`
 * を作る以上、「何が落ちたか」を値に持たないと再試行は 1 つの操作しか
 * 指せない。持たせないと、版の復元が通信エラーで落ちたあとの「再試行」が
 * 復元ではなく本文の保存を走らせる。
 *
 * 保存のあとの面の載せ直しはこの 4 つに入らない。保存はもう確定して
 * いるので、載せ直しが落ちても状態は `saved` のままであり、降ろすのは
 * 経路単位で送れる印だけで再試行の対象にはならない。
 */
export type RetryTarget =
  | Readonly<{ kind: "save" }>
  | Readonly<{ kind: "mode"; mode: EditorMode; acknowledged: boolean }>
  | Readonly<{ kind: "conflict"; keepLocal: boolean }>
  | Readonly<{ kind: "revision"; revisionId: string }>;

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
   * 版の復元）が落ちたときも偽で入る。退避を書けるのは保存の `catch`
   * だけだからである。
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
 * 版を進めうる往復が投げたものを、この画面の状態へ写す純関数。
 *
 * 4 つの `catch`（保存・モード切替・競合の解決・版の復元）が共有するので、
 * 「何が落ちたか」は呼び出し元が {@link RetryTarget} で渡す。
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
