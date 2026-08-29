"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useOptimistic, useState, useTransition } from "react";
import { errorTextClass } from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import { moveNoteFn } from "@/routes/notes/-action";
import { type MoveTarget, NoteMovePicker } from "../NoteMovePicker";

/**
 * P-10 の一覧を所有する島（PAGE-p10-007）。
 *
 * 移動は**一覧メンバーシップの変更**（移動元の一覧からノートが消える）
 * なので、CLAUDE.md「Frontend」の所有権の規則どおり親であるこの一覧が
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
  visibilityLabel: string;
  visibilityDotClass: string;
  updatedLabel: string;
  dateLabel: string;
}>;

function withoutNote(
  current: readonly NoteRowView[],
  noteId: string,
): readonly NoteRowView[] {
  return current.filter((row) => row.noteId !== noteId);
}

export function NoteListBoard({ rows }: { rows: readonly NoteRowView[] }) {
  const router = useRouter();
  const moveNote = useServerFn(moveNoteFn);

  const [visibleRows, removeRow] = useOptimistic(rows, withoutNote);
  const [isMoving, startMoving] = useTransition();
  const [openMenuNoteId, setOpenMenuNoteId] = useState<string | null>(null);
  const [pickingNoteId, setPickingNoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onMove = (noteId: string, target: MoveTarget) => {
    startMoving(async () => {
      removeRow(noteId);
      try {
        await moveNote({
          data: {
            noteId,
            targetOwnerType: target.ownerType,
            targetWorkspaceId: target.workspaceId,
          },
        });
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setPickingNoteId(null);
      setOpenMenuNoteId(null);
      // 移動はもう成立しているので、整合の失敗を「移動できなかった」と
      // 見せない（try の外に置く）。
      await router.invalidate().catch(() => {
        console.error("Note list reconcile failed");
      });
    });
  };

  return (
    <>
      <section aria-label="ノート">
        {visibleRows.map((row) => (
          <div
            key={row.noteId}
            className="rounded-md hover:bg-surface-elevated"
          >
            <div className="grid grid-cols-[1fr_auto_auto] items-start gap-2 px-2 py-3">
              <Link
                to="/notes/$noteId"
                params={{ noteId: row.noteId }}
                className="col-span-1 min-w-0"
              >
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
                  <span className="sr-only">{row.visibilityLabel}。</span>
                  更新 {row.updatedLabel}
                </span>
              </Link>
              <span className="text-xs whitespace-nowrap text-ink-tertiary tabular-nums">
                {row.dateLabel}
              </span>
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
            </div>

            {openMenuNoteId === row.noteId ? (
              <div className="px-2 pb-3">
                {pickingNoteId === row.noteId ? (
                  <NoteMovePicker
                    currentOwnerType="user"
                    currentOwnerId=""
                    busy={isMoving}
                    onSelect={(target) => onMove(row.noteId, target)}
                    onCancel={() => setPickingNoteId(null)}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={isMoving}
                    onClick={() => setPickingNoteId(row.noteId)}
                    className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface disabled:opacity-55"
                  >
                    移動...
                  </button>
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
