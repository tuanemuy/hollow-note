"use client";

import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useTransition } from "react";
import { errorTextClass } from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import { moveNoteFn } from "@/routes/notes/-action";
import { type MoveTarget, NoteMovePicker } from "../NoteMovePicker";

/**
 * P-11 の操作メニュー（PAGE-p11-009 の「移動」）。編集・表示スタイル・
 * ダウンロード・削除は対応画面が後続スライスなので並べない
 * （L-01「使えない行き先は並べずに消す」）。
 *
 * 移動はこの画面では**行の増減にならない**（開いているノートは 1 件の
 * まま）ので、ここが自分で server function を持つ。一覧から移す場合は
 * 一覧側が所有する（`NoteList/board.tsx`）。
 *
 * 移動後の URL は自分では動かさない。`router.invalidate()` で読み直した
 * `NoteDetail` が新しい所属先を見て正規な URL へ送るので（PAGE-p11-009 /
 * OR-12）、正規化の判断は 1 か所に置く。
 *
 * 落ちたタグは移動の応答が返す。タグドメインが入るまでは必ず空なので、
 * 出るのは実装が入ってからになる。
 */
export function NoteDetailMenu({
  noteId,
  ownerType,
  ownerId,
}: {
  noteId: string;
  ownerType: "user" | "workspace";
  ownerId: string;
}) {
  const router = useRouter();
  const moveNote = useServerFn(moveNoteFn);

  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [isMoving, startMoving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<readonly string[]>([]);

  const onSelect = (target: MoveTarget) => {
    startMoving(async () => {
      let droppedTagNames: readonly string[];
      try {
        const moved = await moveNote({
          data: {
            noteId,
            targetOwnerType: target.ownerType,
            targetWorkspaceId: target.workspaceId,
          },
        });
        droppedTagNames = moved.droppedTagNames;
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setDropped(droppedTagNames);
      setPicking(false);
      setOpen(false);
      // 移動はもう成立しているので、整合の失敗を「移動できなかった」と
      // 見せない（try の外に置く）。
      await router.invalidate().catch(() => {
        console.error("Note reconcile failed");
      });
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="ノートの操作"
        disabled={isMoving}
        onClick={() => {
          setOpen((value) => !value);
          setPicking(false);
        }}
        className="inline-flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      {open ? (
        <div className="absolute top-full right-0 z-40 mt-1 w-64 rounded-lg border border-hairline bg-bg p-2 shadow-sm">
          {picking ? (
            <NoteMovePicker
              currentOwnerType={ownerType}
              currentOwnerId={ownerId}
              busy={isMoving}
              onSelect={onSelect}
              onCancel={() => setPicking(false)}
            />
          ) : (
            <button
              type="button"
              disabled={isMoving}
              onClick={() => setPicking(true)}
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface disabled:opacity-55"
            >
              {isMoving ? "移動中..." : "移動..."}
            </button>
          )}
        </div>
      ) : null}

      <p className={errorTextClass} role="status" aria-live="polite">
        {error}
      </p>
      <p
        className="text-xs text-ink-tertiary not-empty:mt-2"
        role="status"
        aria-live="polite"
      >
        {dropped.length === 0
          ? ""
          : `移動先に無いタグを外しました: ${dropped.join(", ")}`}
      </p>
    </div>
  );
}
