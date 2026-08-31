"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useOptimistic, useState, useTransition } from "react";
import {
  dangerButtonClass,
  errorTextClass,
  ghostButtonClass,
} from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import {
  emptyTrashFn,
  purgeNoteFn,
  restoreNoteFn,
} from "@/routes/notes/-action";

/**
 * P-14 の一覧を所有する島（PAGE-p14-001〜004、モック P14-trash.html）。
 *
 * 復元も完全削除も**一覧メンバーシップの変更**なので、CLAUDE.md
 * 「Frontend」の所有権の規則どおりここが `useOptimistic` と server
 * function を持つ。行に持たせると、楽観的な除去が行を先にアンマウント
 * して失敗表示ごと消えてしまう。
 *
 * 表示用の文字列（削除日・残り日数）はサーバー側で組んで受け取る。残り
 * 日数は「いま」に依存するので、ここで数えるとサーバーとブラウザーの
 * 時計・タイムゾーンが食い違ってハイドレーションがずれる。
 */
export type TrashRowView = Readonly<{
  noteId: string;
  title: string;
  version: number;
  trashedLabel: string;
  remainingLabel: string;
}>;

/**
 * 空にした結果。`mode` で意味が変わるので件数だけを持ち回らない。
 *
 * `jobIds` は `scheduled` のときだけ中身を持つ。処理履歴（P-15）はまだ
 * 無いので導線は張れないが、予約そのものは ID として画面に出す — 「処理
 * 履歴で確認できます」とだけ書いて何も渡さないと、利用者は登録された
 * 予約を指す手掛かりを 1 つも持たないまま一覧へ戻ることになる。
 */
type EmptyOutcome = Readonly<{
  mode: "purged" | "scheduled";
  count: number;
  jobIds: readonly string[];
}>;

function withoutNote(
  current: readonly TrashRowView[],
  noteId: string,
): readonly TrashRowView[] {
  return current.filter((row) => row.noteId !== noteId);
}

export function TrashBoard({
  rows,
  workspaceId,
}: {
  rows: readonly TrashRowView[];
  workspaceId: string | null;
}) {
  const router = useRouter();
  const restoreNote = useServerFn(restoreNoteFn);
  const purgeNote = useServerFn(purgeNoteFn);
  const emptyTrash = useServerFn(emptyTrashFn);

  const [visibleRows, removeRow] = useOptimistic(rows, withoutNote);
  const [isBusy, startBusy] = useTransition();
  const [confirmingNoteId, setConfirmingNoteId] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<EmptyOutcome | null>(null);

  // 整合の失敗を「操作できなかった」と見せない。削除も復元ももう成立して
  // いるので、読み直しの失敗は別の話である。
  const reconcile = async (): Promise<void> => {
    await router.invalidate().catch(() => {
      console.error("Trash reconcile failed");
    });
  };

  const onRestore = (row: TrashRowView) => {
    startBusy(async () => {
      removeRow(row.noteId);
      try {
        await restoreNote({
          data: { noteId: row.noteId, expectedVersion: row.version },
        });
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setConfirmingNoteId(null);
      await reconcile();
    });
  };

  const onPurge = (row: TrashRowView) => {
    startBusy(async () => {
      removeRow(row.noteId);
      try {
        await purgeNote({
          data: { noteId: row.noteId, expectedVersion: row.version },
        });
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setConfirmingNoteId(null);
      await reconcile();
    });
  };

  const onEmpty = () => {
    startBusy(async () => {
      let result: Awaited<ReturnType<typeof emptyTrash>>;
      try {
        result = await emptyTrash({ data: { workspaceId } });
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setConfirmingEmpty(false);
      setOutcome({
        mode: result.mode,
        count: result.purgedCount,
        jobIds: result.jobIds,
      });
      // 51 件以上（`scheduled`）はまだ 1 件も消えていないので、一覧は
      // その場で空にせず読み直すだけにする（P-14 の状態表）。
      await reconcile();
    });
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-3xl font-light tracking-tightest leading-tight">
            ゴミ箱
          </h1>
          <p className="mt-2 text-sm text-ink-tertiary">
            削除から 30 日で完全に消えます
          </p>
        </div>
        {visibleRows.length > 0 ? (
          <div className="ml-auto">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirmingEmpty(true)}
              className={dangerButtonClass}
            >
              ゴミ箱を空にする
            </button>
          </div>
        ) : null}
      </div>

      {confirmingEmpty ? (
        <Alert
          tone="error"
          title="ゴミ箱をすべて完全に削除しますか"
          role="alert"
          actions={
            <>
              <button
                type="button"
                disabled={isBusy}
                onClick={onEmpty}
                className={dangerButtonClass}
              >
                {isBusy ? "削除中..." : "すべて完全に削除"}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setConfirmingEmpty(false)}
                className={ghostButtonClass}
              >
                やめる
              </button>
            </>
          }
        >
          元ファイル・挿入したメディア・版の履歴も消え、この操作は取り消せません。
        </Alert>
      ) : null}

      {outcome === null ? null : outcome.mode === "purged" ? (
        <Alert tone="success" title={`${outcome.count} 件を完全に削除しました`}>
          復元はできません。
        </Alert>
      ) : (
        <Alert tone="info" title={`${outcome.count} 件の削除を開始しました`}>
          件数が多いため、まとめて消す処理として登録しました。まだ 1
          件も消えていないので、この一覧はしばらく残ります。処理の進みは処理履歴で確認できます。
          {outcome.jobIds.length === 0 ? null : (
            <>
              {" "}
              登録した処理:{" "}
              <span className="break-all font-mono text-xs">
                {outcome.jobIds.join(", ")}
              </span>
            </>
          )}
        </Alert>
      )}

      {visibleRows.length === 0 ? (
        <EmptyState workspaceId={workspaceId} />
      ) : (
        <section aria-label="削除したノート">
          {visibleRows.map((row) => (
            <div
              key={row.noteId}
              className="rounded-md border-t border-hairline px-2 py-3 hover:bg-surface-elevated"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{row.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-tertiary">
                    <span>{row.trashedLabel} に削除</span>
                    <span className="text-hairline-strong">·</span>
                    <span className="text-warning">{row.remainingLabel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onRestore(row)}
                    className={ghostButtonClass}
                  >
                    復元
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setConfirmingNoteId(row.noteId)}
                    className={dangerButtonClass}
                  >
                    完全に削除
                  </button>
                </div>
              </div>

              {confirmingNoteId === row.noteId ? (
                <div className="mt-3">
                  <Alert
                    tone="error"
                    title="このノートを完全に削除しますか"
                    role="alert"
                    actions={
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onPurge(row)}
                          className={dangerButtonClass}
                        >
                          {isBusy ? "削除中..." : "完全に削除"}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmingNoteId(null)}
                          className={ghostButtonClass}
                        >
                          やめる
                        </button>
                      </>
                    }
                  >
                    元ファイル・挿入したメディア・版の履歴も消え、この操作は取り消せません。
                  </Alert>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      )}

      <p className={errorTextClass} role="status" aria-live="polite">
        {error}
      </p>
    </>
  );
}

function EmptyState({ workspaceId }: { workspaceId: string | null }) {
  return (
    <div className="rounded-xl border border-dashed border-hairline-strong px-6 py-12 text-center">
      <h2 className="text-lg font-semibold tracking-tight">ゴミ箱は空です</h2>
      <p className="mx-auto mt-3 max-w-[380px] text-sm text-ink-secondary">
        削除したノートはここに 30 日間残り、その間なら元に戻せます。
      </p>
      <div className="mt-6 flex justify-center">
        {workspaceId === null ? (
          <Link to="/notes" className={ghostButtonClass}>
            ノート一覧へ
          </Link>
        ) : (
          <Link
            to="/workspaces/$workspaceId/notes"
            params={{ workspaceId }}
            className={ghostButtonClass}
          >
            ノート一覧へ
          </Link>
        )}
      </div>
    </div>
  );
}
