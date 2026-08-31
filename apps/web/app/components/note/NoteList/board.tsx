"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useOptimistic, useState, useTransition } from "react";
import {
  dangerButtonClass,
  errorTextClass,
  ghostButtonClass,
  subtleButtonClass,
} from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import { moveNoteFn, restoreNoteFn, trashNoteFn } from "@/routes/notes/-action";
import {
  type MoveTarget,
  moveNotePayload,
  NoteMovePicker,
} from "../NoteMovePicker";
import type { NoteListOwner } from "./action";

/**
 * P-10 の一覧を所有する島（PAGE-p10-007）。
 *
 * 移動も削除も**一覧メンバーシップの変更**（一覧からノートが消える）な
 * ので、CLAUDE.md「Frontend」の所有権の規則どおり親であるこの一覧が
 * `useOptimistic` と server function を持つ。行に持たせると、楽観的な
 * 除去が行を先にアンマウントして失敗表示ごと消えてしまう。
 *
 * 表示用の文字列はサーバー側で組んで受け取る。日時の整形をこの島でやると
 * サーバーとブラウザーのタイムゾーンが食い違ってハイドレーションが
 * ずれるためで、`Intl` はサーバーコンポーネント側に閉じてある。
 */
export type NoteRowView = Readonly<{
  noteId: string;
  title: string;
  /** `trashNote` の `expectedVersion`。画面が見た版をそのまま運ぶ。 */
  version: number;
  /** 公開・限定公開のいずれか。削除の確認で警告を出し分ける（ED-09）。 */
  isPublished: boolean;
  visibilityLabel: string;
  visibilityDotClass: string;
  updatedLabel: string;
  dateLabel: string;
}>;

/** ゴミ箱へ移した直後の通知。版は「元に戻す」のためだけに持つ。 */
type TrashedState = Readonly<{
  noteId: string;
  title: string;
  restoreVersion: number;
}>;

/** 行を開く先は文脈で変わる（PAGE-p10-005「current scope 用 P-11 URL」）。 */
function NoteRowLabel({ row }: { row: NoteRowView }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block size-1.5 shrink-0 rounded-full ${row.visibilityDotClass}`}
        />
        <span className="min-w-0 truncate text-md tracking-tight">
          {row.title}
        </span>
      </span>
      <span className="mt-1 block text-xs text-ink-tertiary">
        <span className="sr-only">{row.visibilityLabel}。</span>更新{" "}
        {row.updatedLabel}
      </span>
    </>
  );
}

function withoutNote(
  current: readonly NoteRowView[],
  noteId: string,
): readonly NoteRowView[] {
  return current.filter((row) => row.noteId !== noteId);
}

const rowMenuItemClass =
  "block w-full rounded-sm px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface disabled:opacity-55";

export function NoteListBoard({
  rows,
  owner,
}: {
  rows: readonly NoteRowView[];
  owner: NoteListOwner;
}) {
  const router = useRouter();
  // `moveNote` / `deleteNote` はどちらも最小ロールが editor なので、
  // 1 つの可否で両方を出し分ける。
  const canMove = owner.kind === "personal" || owner.canWrite;
  const moveNote = useServerFn(moveNoteFn);
  const trashNote = useServerFn(trashNoteFn);
  const restoreNote = useServerFn(restoreNoteFn);

  const [visibleRows, removeRow] = useOptimistic(rows, withoutNote);
  const [isMoving, startMoving] = useTransition();
  const [openMenuNoteId, setOpenMenuNoteId] = useState<string | null>(null);
  const [pickingNoteId, setPickingNoteId] = useState<string | null>(null);
  const [confirmingNoteId, setConfirmingNoteId] = useState<string | null>(null);
  const [trashed, setTrashed] = useState<TrashedState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 整合の失敗を「操作できなかった」と見せない（もう成立している）。
  const reconcile = async (): Promise<void> => {
    await router.invalidate().catch(() => {
      console.error("Note list reconcile failed");
    });
  };

  const onMove = (noteId: string, target: MoveTarget) => {
    startMoving(async () => {
      removeRow(noteId);
      try {
        await moveNote({ data: { noteId, ...moveNotePayload(target) } });
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setPickingNoteId(null);
      setOpenMenuNoteId(null);
      await reconcile();
    });
  };

  /**
   * 一覧からの削除（ED-09 手順 1「ノート詳細または一覧のメニューから
   * 『削除』を選ぶ」）。
   *
   * 「元に戻す」に要る版は `trashNote` の応答が持ってくる。移動のついでに
   * ジョブの強制終端で版がもう 1 つ進むことがあるので、行が見た版から
   * 数えて当てることはできない（詳細画面と同じ）。
   */
  const onTrash = (row: NoteRowView) => {
    startMoving(async () => {
      removeRow(row.noteId);
      let restoreVersion: number;
      try {
        restoreVersion = (
          await trashNote({
            data: { noteId: row.noteId, expectedVersion: row.version },
          })
        ).version;
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setConfirmingNoteId(null);
      setOpenMenuNoteId(null);
      setTrashed({
        noteId: row.noteId,
        title: row.title,
        restoreVersion,
      });
      // 楽観的な除去は transition が終わると戻るので、行を実際に消すのは
      // この読み直しである。通知は島の state なので作り直されない。
      await reconcile();
    });
  };

  const onRestore = () => {
    if (trashed === null) return;
    const { noteId, restoreVersion } = trashed;
    startMoving(async () => {
      try {
        await restoreNote({
          data: { noteId, expectedVersion: restoreVersion },
        });
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setTrashed(null);
      await reconcile();
    });
  };

  return (
    <>
      {/* ED-09 手順 3「削除直後は画面上の『元に戻す』で取り消せる」。
          一覧に留まるので、詳細（`NoteDetail`）と違って行き先の案内は
          要らない。 */}
      {trashed === null ? null : (
        <Alert
          tone="success"
          title={`「${trashed.title}」をゴミ箱に移しました`}
          role="status"
          actions={
            <>
              <button
                type="button"
                disabled={isMoving}
                onClick={onRestore}
                className={subtleButtonClass}
              >
                {isMoving ? "元に戻しています..." : "元に戻す"}
              </button>
              <button
                type="button"
                onClick={() => setTrashed(null)}
                className={ghostButtonClass}
              >
                閉じる
              </button>
            </>
          }
        >
          30 日以内ならゴミ箱から元に戻せます。公開・共有の URL
          からは読めなくなりました。
        </Alert>
      )}

      <section aria-label="ノート">
        {visibleRows.map((row) => (
          <div
            key={row.noteId}
            className="rounded-md hover:bg-surface-elevated"
          >
            <div className="grid grid-cols-[1fr_auto_auto] items-start gap-2 px-2 py-3">
              {owner.kind === "personal" ? (
                <Link
                  to="/notes/$noteId"
                  params={{ noteId: row.noteId }}
                  className="col-span-1 min-w-0"
                >
                  <NoteRowLabel row={row} />
                </Link>
              ) : (
                <Link
                  to="/workspaces/$workspaceId/notes/$noteId"
                  params={{
                    workspaceId: owner.workspaceId,
                    noteId: row.noteId,
                  }}
                  className="col-span-1 min-w-0"
                >
                  <NoteRowLabel row={row} />
                </Link>
              )}
              <span className="text-xs whitespace-nowrap text-ink-tertiary tabular-nums">
                {row.dateLabel}
              </span>
              {/* viewer に開ける項目は 1 つも無いので、空のメニューを
                  出さずにトリガーごと消す（L-01「使えない行き先は並べずに
                  消す」と同じ扱い）。 */}
              {canMove ? (
                <button
                  type="button"
                  aria-expanded={openMenuNoteId === row.noteId}
                  aria-label={`${row.title} の操作`}
                  disabled={isMoving}
                  onClick={() => {
                    setOpenMenuNoteId((current) =>
                      current === row.noteId ? null : row.noteId,
                    );
                    setPickingNoteId(null);
                  }}
                  className="inline-flex size-6 items-center justify-center rounded-sm text-ink-tertiary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                </button>
              ) : (
                <span />
              )}
            </div>

            {openMenuNoteId === row.noteId ? (
              <div className="px-2 pb-3">
                {pickingNoteId === row.noteId ? (
                  <NoteMovePicker
                    currentOwnerType={
                      owner.kind === "personal" ? "user" : "workspace"
                    }
                    currentOwnerId={
                      owner.kind === "personal" ? "" : owner.workspaceId
                    }
                    busy={isMoving}
                    onSelect={(target) => onMove(row.noteId, target)}
                    onCancel={() => setPickingNoteId(null)}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={isMoving}
                      onClick={() => setPickingNoteId(row.noteId)}
                      className={rowMenuItemClass}
                    >
                      移動...
                    </button>
                    <button
                      type="button"
                      disabled={isMoving}
                      onClick={() =>
                        setConfirmingNoteId((current) =>
                          current === row.noteId ? null : row.noteId,
                        )
                      }
                      className={`${rowMenuItemClass} text-error`}
                    >
                      削除...
                    </button>
                    {confirmingNoteId === row.noteId ? (
                      <div className="mt-2">
                        <Alert
                          tone="error"
                          title="このノートをゴミ箱へ移しますか"
                          role="alert"
                          actions={
                            <>
                              <button
                                type="button"
                                disabled={isMoving}
                                onClick={() => onTrash(row)}
                                className={dangerButtonClass}
                              >
                                {isMoving ? "移しています..." : "ゴミ箱へ移す"}
                              </button>
                              <button
                                type="button"
                                disabled={isMoving}
                                onClick={() => setConfirmingNoteId(null)}
                                className={ghostButtonClass}
                              >
                                やめる
                              </button>
                            </>
                          }
                        >
                          {row.isPublished
                            ? "公開中のノートです。ゴミ箱へ移すと、公開・共有の URL からは読めなくなります。30 日以内なら元に戻せます。"
                            : "30 日以内ならゴミ箱から元に戻せます。変換や再生成が実行中の場合は、それを取り消してから移します。"}
                        </Alert>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </section>
      <p className={errorTextClass} role="status" aria-live="polite">
        {error}
      </p>
    </>
  );
}
