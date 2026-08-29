"use client";

import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ghostButtonClass } from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import { listMoveTargetsFn } from "@/routes/notes/-action";

/**
 * ノート移動の移動先セレクター（PAGE-p11-009 / PAGE-p10-007）。
 *
 * **移動そのものは実行しない** — 移動は「移動元の一覧からノートが消える」
 * 変更なので、server function を呼ぶのは一覧を所有する側で、この部品は
 * 選ばれた行き先を返すだけに留める（CLAUDE.md「Frontend」の所有権）。
 *
 * 候補はサーバーが editor 以上に絞って返す（`listMoveTargetsFn`）。
 * 現在の所有者はここで落とす — 同じ所有者への移動は `moveNote` が何も
 * せずに返す no-op で、選択肢として並べる意味が無い。
 */
export type MoveTarget = Readonly<{
  ownerType: "user" | "workspace";
  workspaceId: string | null;
  label: string;
}>;

type Listing =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "loaded"; targets: readonly MoveTarget[] }>
  | Readonly<{ kind: "failed"; message: string }>;

export function NoteMovePicker({
  currentOwnerType,
  currentOwnerId,
  busy,
  onSelect,
  onCancel,
}: {
  currentOwnerType: "user" | "workspace";
  currentOwnerId: string;
  busy: boolean;
  onSelect: (target: MoveTarget) => void;
  onCancel: () => void;
}) {
  const listTargets = useServerFn(listMoveTargetsFn);
  const [listing, setListing] = useState<Listing>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    listTargets({ data: { cursor: null } })
      .then((page) => {
        if (!live) return;
        const targets: MoveTarget[] = [];
        if (currentOwnerType !== "user") {
          targets.push({ ownerType: "user", workspaceId: null, label: "個人" });
        }
        for (const target of page.targets) {
          if (
            currentOwnerType === "workspace" &&
            currentOwnerId === target.workspaceId
          ) {
            continue;
          }
          targets.push({
            ownerType: "workspace",
            workspaceId: target.workspaceId,
            label: target.name,
          });
        }
        setListing({ kind: "loaded", targets });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setListing({ kind: "failed", message: displayError(error) });
      });
    return () => {
      live = false;
    };
  }, [listTargets, currentOwnerType, currentOwnerId]);

  return (
    <div className="mt-2 rounded-md border border-hairline p-2">
      <p className="px-2 py-1 text-xs text-ink-tertiary">移動先</p>
      {listing.kind === "loading" ? (
        <p className="px-2 py-1.5 text-sm text-ink-tertiary" role="status">
          読み込み中...
        </p>
      ) : null}
      {listing.kind === "failed" ? (
        <p className="px-2 py-1.5 text-xs text-error" role="status">
          {listing.message}
        </p>
      ) : null}
      {listing.kind === "loaded" && listing.targets.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-ink-tertiary">
          移動できる先がありません。editor 以上のワークスペースが必要です。
        </p>
      ) : null}
      {listing.kind === "loaded"
        ? listing.targets.map((target) => (
            <button
              key={`${target.ownerType}:${target.workspaceId ?? "self"}`}
              type="button"
              disabled={busy}
              onClick={() => onSelect(target)}
              className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface disabled:opacity-55"
            >
              {target.label}
            </button>
          ))
        : null}
      <div className="mt-1 px-1">
        <button
          type="button"
          className={ghostButtonClass}
          disabled={busy}
          onClick={onCancel}
        >
          やめる
        </button>
      </div>
    </div>
  );
}
