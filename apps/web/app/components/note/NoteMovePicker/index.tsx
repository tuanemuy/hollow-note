"use client";

import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  ghostButtonClass,
  primaryButtonClass,
} from "@/components/settings/panelStyles";
import { displayError } from "@/presentation/errorDisplay";
import { listMoveTargetsFn } from "@/routes/notes/-action";

/**
 * ノート移動の移動先セレクター（PAGE-p11-009 / PAGE-p10-007）。
 *
 * **移動そのものは実行しない** — 移動は「移動元の一覧からノートが消える」
 * 変更なので、server function を呼ぶのは一覧を所有する側で、この部品は
 * 選ばれた行き先を返すだけに留める（CLAUDE.md「Frontend」の所有権）。
 *
 * 行き先を選んでから `onSelect` を呼ぶまでのあいだに**確認の段**を挟み、
 * 移動後に誰が読めるようになる / 読めなくなるかを示す（OR-12 手順 3）。
 * 確認をこの部品の中に閉じてあるので、所有者側は「確定した行き先が来る」
 * ままで変わらない。
 *
 * 候補はサーバーが editor 以上に絞って返す（`listMoveTargetsFn`）。
 * 現在の所有者はここで落とす — 同じ所有者への移動は `moveNote` が何も
 * せずに返す no-op で、選択肢として並べる意味が無い。落とすときにその
 * 名前だけ覚えておき、確認の文面で「誰が読めなくなるか」に使う。
 *
 * ページは 1 枚では終わらない。`listUserWorkspaces` の 1 ページを引いてから
 * ロールで絞る後段の形なので、1 ページぶんが全部 viewer なら候補は 0 件でも
 * 続きがある。`nextCursor` が残るあいだは「さらに読み込む」を出し、21 件目
 * 以降のワークスペースへも移せるようにする。
 */
export type MoveTarget = Readonly<{
  ownerType: "user" | "workspace";
  workspaceId: string | null;
  label: string;
}>;

type Loaded = Readonly<{
  kind: "loaded";
  targets: readonly MoveTarget[];
  currentLabel: string | null;
  nextCursor: string | null;
  pending: boolean;
  error: string | null;
}>;

type Listing =
  | Readonly<{ kind: "loading" }>
  | Loaded
  | Readonly<{ kind: "failed"; message: string }>;

type TargetPage = Readonly<{
  targets: readonly Readonly<{ workspaceId: string; name: string }>[];
  nextCursor: string | null;
}>;

const PERSONAL_LABEL = "個人";

function appendPage(
  loaded: Loaded | null,
  page: TargetPage,
  currentOwnerType: "user" | "workspace",
  currentOwnerId: string,
): Loaded {
  const targets: MoveTarget[] =
    loaded !== null
      ? [...loaded.targets]
      : currentOwnerType === "user"
        ? []
        : [{ ownerType: "user", workspaceId: null, label: PERSONAL_LABEL }];
  let currentLabel = loaded?.currentLabel ?? null;
  for (const target of page.targets) {
    if (
      currentOwnerType === "workspace" &&
      currentOwnerId === target.workspaceId
    ) {
      currentLabel = target.name;
      continue;
    }
    targets.push({
      ownerType: "workspace",
      workspaceId: target.workspaceId,
      label: target.name,
    });
  }
  return {
    kind: "loaded",
    targets,
    currentLabel,
    nextCursor: page.nextCursor,
    pending: false,
    error: null,
  };
}

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
  const [chosen, setChosen] = useState<MoveTarget | null>(null);

  useEffect(() => {
    let live = true;
    listTargets({ data: { cursor: null } })
      .then((page) => {
        if (!live) return;
        setListing(appendPage(null, page, currentOwnerType, currentOwnerId));
      })
      .catch((error: unknown) => {
        if (!live) return;
        setListing({ kind: "failed", message: displayError(error) });
      });
    return () => {
      live = false;
    };
  }, [listTargets, currentOwnerType, currentOwnerId]);

  const loadMore = (cursor: string) => {
    setListing((current) =>
      current.kind === "loaded"
        ? { ...current, pending: true, error: null }
        : current,
    );
    listTargets({ data: { cursor } })
      .then((page) => {
        setListing((current) =>
          current.kind === "loaded"
            ? appendPage(current, page, currentOwnerType, currentOwnerId)
            : current,
        );
      })
      .catch((error: unknown) => {
        const message = displayError(error);
        setListing((current) =>
          current.kind === "loaded"
            ? { ...current, pending: false, error: message }
            : current,
        );
      });
  };

  const currentLabel =
    currentOwnerType === "user"
      ? PERSONAL_LABEL
      : listing.kind === "loaded" && listing.currentLabel !== null
        ? listing.currentLabel
        : "いまのワークスペース";

  if (chosen !== null) {
    return (
      <div className="mt-2 rounded-md border border-hairline p-2">
        <p className="px-2 py-1 text-sm text-ink">
          {chosen.label} へ移動しますか
        </p>
        <p className="px-2 py-1 text-xs text-ink-secondary">
          {chosen.ownerType === "user"
            ? `移動すると、このノートを読めるのはあなただけになります。${currentLabel}のメンバーは読めなくなります。`
            : currentOwnerType === "user"
              ? `移動すると、${chosen.label}のメンバー全員がこのノートを読めるようになります。`
              : `移動すると、${chosen.label}のメンバーが読めるようになり、${currentLabel}のメンバーは読めなくなります。`}
        </p>
        <p className="px-2 py-1 text-xs text-ink-tertiary">
          タグは移動先に引き継がれません（移動先に同名のタグがあれば付け替えます）。公開ページと共有リンクの
          URL は変わりません。
        </p>
        <div className="mt-1 flex flex-wrap gap-2 px-1">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy}
            aria-busy={busy}
            onClick={() => onSelect(chosen)}
          >
            {busy ? "移動中..." : `${chosen.label}へ移動`}
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            disabled={busy}
            onClick={() => setChosen(null)}
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

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
      {listing.kind === "loaded" &&
      listing.targets.length === 0 &&
      listing.nextCursor === null ? (
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
              onClick={() => setChosen(target)}
              className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface disabled:opacity-55"
            >
              {target.label}
            </button>
          ))
        : null}
      {listing.kind === "loaded" && listing.error !== null ? (
        <p className="px-2 py-1.5 text-xs text-error" role="status">
          {listing.error}
        </p>
      ) : null}
      {listing.kind === "loaded" && listing.nextCursor !== null ? (
        <LoadMoreTargets
          cursor={listing.nextCursor}
          pending={listing.pending}
          retry={listing.error !== null}
          busy={busy}
          onSelect={loadMore}
        />
      ) : null}
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

function LoadMoreTargets({
  cursor,
  pending,
  retry,
  busy,
  onSelect,
}: {
  cursor: string;
  pending: boolean;
  retry: boolean;
  busy: boolean;
  onSelect: (cursor: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={busy || pending}
      aria-busy={pending}
      onClick={() => onSelect(cursor)}
      className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-ink-secondary transition-colors hover:bg-surface hover:text-ink disabled:opacity-55"
    >
      {pending
        ? "読み込み中..."
        : retry
          ? "もう一度読み込む"
          : "さらに読み込む"}
    </button>
  );
}
