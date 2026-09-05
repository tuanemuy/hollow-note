"use client";

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useTransition } from "react";
import {
  dangerButtonClass,
  errorTextClass,
  ghostButtonClass,
} from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import { moveNoteFn } from "@/routes/notes/-action";
import {
  type MoveTarget,
  moveNotePayload,
  NoteMovePicker,
} from "../NoteMovePicker";
import type { NoteDetailContext } from "./action";

/**
 * P-11 の操作メニュー。本スライスが担うのは編集（PAGE-p11-007）・
 * 表示スタイル（PAGE-p11-008）・移動（PAGE-p11-009）・削除
 * （PAGE-p11-013）の 4 つで、タグ・共有・ダウンロード・再生成・バック
 * アップは対応画面が後続スライスなので並べない（L-01「使えない行き先は
 * 並べずに消す」）。
 *
 * 版を要する操作（表示スタイル・削除）は自分では実行しない。ノート 1 件
 * の版はこの画面に 1 つしかないのに、タイトルの自動保存でも動くため、
 * 所有者を島（`detail.tsx`）に一本化してある。ここが持つのは開閉と確認の
 * 状態だけで、移動だけは例外的に自分で実行する — `moveNote` は版を取らず
 * （`moveNoteFn` の JSDoc）、この画面では行の増減にもならないためである。
 */
export function NoteDetailMenu({
  noteId,
  ownerType,
  ownerId,
  context,
  canDelete,
  isPublished,
  styleMode,
  onStyleMode,
  onTrash,
  busy,
}: {
  noteId: string;
  ownerType: "user" | "workspace";
  ownerId: string;
  context: NoteDetailContext;
  canDelete: boolean;
  isPublished: boolean;
  styleMode: "default" | "preserve";
  onStyleMode: (next: "default" | "preserve") => void;
  onTrash: () => void;
  busy: boolean;
}) {
  const router = useRouter();
  const moveNote = useServerFn(moveNoteFn);

  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"none" | "move" | "style" | "delete">(
    "none",
  );
  const [isMoving, startMoving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<readonly string[]>([]);

  const disabled = busy || isMoving;

  const onSelect = (target: MoveTarget) => {
    startMoving(async () => {
      let droppedTagNames: readonly string[];
      try {
        const moved = await moveNote({
          data: { noteId, ...moveNotePayload(target) },
        });
        droppedTagNames = moved.droppedTagNames;
      } catch (failure) {
        setError(displayError(failure));
        return;
      }
      setError(null);
      setDropped(droppedTagNames);
      setPanel("none");
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
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
          setPanel("none");
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
        <div className="absolute top-full right-0 z-40 mt-1 w-72 rounded-lg border border-hairline bg-bg p-2 text-left shadow-sm">
          {panel === "move" ? (
            <NoteMovePicker
              currentOwnerType={ownerType}
              currentOwnerId={ownerId}
              busy={isMoving}
              onSelect={onSelect}
              onCancel={() => setPanel("none")}
            />
          ) : panel === "style" ? (
            <StylePanel
              styleMode={styleMode}
              busy={disabled}
              onSelect={onStyleMode}
              onClose={() => setPanel("none")}
            />
          ) : panel === "delete" ? (
            <DeletePanel
              isPublished={isPublished}
              busy={disabled}
              onConfirm={() => {
                setOpen(false);
                setPanel("none");
                onTrash();
              }}
              onCancel={() => setPanel("none")}
            />
          ) : (
            <>
              {context.kind === "workspace" ? (
                <Link
                  to="/workspaces/$workspaceId/notes/$noteId/edit"
                  params={{ workspaceId: context.workspaceId, noteId }}
                  className={itemClass}
                >
                  編集
                </Link>
              ) : (
                <Link
                  to="/notes/$noteId/edit"
                  params={{ noteId }}
                  className={itemClass}
                >
                  編集
                </Link>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPanel("style")}
                className={itemButtonClass}
              >
                表示スタイル...
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPanel("move")}
                className={itemButtonClass}
              >
                {isMoving ? "移動中..." : "移動..."}
              </button>
              {canDelete ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setPanel("delete")}
                  className={`${itemButtonClass} text-error`}
                >
                  削除...
                </button>
              ) : null}
            </>
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

const itemClass =
  "block w-full rounded-sm px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface";

const itemButtonClass = `${itemClass} disabled:opacity-55`;

/**
 * 表示スタイルの切替（ED-11）。現在の設定と、それが取り込み時の自動判定
 * 由来である旨を並べる（[ADR 007](spec/adr/007-default-style-isolation.md)）。
 * 選ぶとその場で本文の描画が変わる — 適用は島が `useOptimistic` で行う。
 */
function StylePanel({
  styleMode,
  busy,
  onSelect,
  onClose,
}: {
  styleMode: "default" | "preserve";
  busy: boolean;
  onSelect: (next: "default" | "preserve") => void;
  onClose: () => void;
}) {
  const choices = [
    {
      value: "default",
      label: "既定スタイルを適用",
      note: "読みやすさを揃えたスタイルで表示します。",
    },
    {
      value: "preserve",
      label: "元の装飾のみ",
      note: "本文が持っている装飾だけで表示します。",
    },
  ] as const;

  return (
    <div>
      <p className="px-2 py-1.5 text-xs text-ink-tertiary">
        表示スタイル（取り込み時に自動で判定した設定です）
      </p>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          disabled={busy}
          aria-current={styleMode === choice.value ? "true" : undefined}
          onClick={() => onSelect(choice.value)}
          className={`${itemButtonClass} ${
            styleMode === choice.value ? "bg-surface font-medium" : ""
          }`}
        >
          <span className="block">{choice.label}</span>
          <span className="mt-0.5 block text-xs text-ink-tertiary">
            {choice.note}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClose}
        className="mt-1 block w-full rounded-sm px-2 py-1.5 text-left text-sm text-ink-secondary transition-colors hover:bg-surface"
      >
        戻る
      </button>
    </div>
  );
}

/** 削除の確認（ED-09）。公開中は URL から読めなくなることを先に告げる。 */
function DeletePanel({
  isPublished,
  busy,
  onConfirm,
  onCancel,
}: {
  isPublished: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-2 py-1.5">
      <p className="text-sm text-ink">このノートをゴミ箱へ移しますか</p>
      <p className="mt-1 text-xs text-ink-secondary">
        {isPublished
          ? "公開中のノートです。ゴミ箱へ移すと、公開・共有の URL からは読めなくなります。30 日以内ならゴミ箱から元に戻せます。"
          : "30 日以内ならゴミ箱から元に戻せます。変換や再生成が実行中の場合は、それを取り消してから移します。"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={dangerButtonClass}
        >
          ゴミ箱へ移す
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={ghostButtonClass}
        >
          やめる
        </button>
      </div>
    </div>
  );
}
