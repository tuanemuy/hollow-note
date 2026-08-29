/**
 * 移動先候補の畳み込み（PAGE-p11-009 / PAGE-p10-007）。
 *
 * コンポーネントから分けてあるのは、DOM もサーバー関数のランタイムも
 * 無しでこの遷移を単体テストできる形に保つため。
 */
export type MoveTarget = Readonly<{
  ownerType: "user" | "workspace";
  workspaceId: string | null;
  label: string;
}>;

export type Loaded = Readonly<{
  kind: "loaded";
  targets: readonly MoveTarget[];
  currentLabel: string | null;
  nextCursor: string | null;
  pending: boolean;
  error: string | null;
}>;

export type Listing =
  | Readonly<{ kind: "loading" }>
  | Loaded
  | Readonly<{ kind: "failed"; message: string }>;

export type TargetPage = Readonly<{
  targets: readonly Readonly<{ workspaceId: string; name: string }>[];
  nextCursor: string | null;
}>;

export const PERSONAL_LABEL = "個人";

/**
 * `loaded` が `null` のときだけ「個人」行を先頭に置き、以降のページは
 * 既存の候補に追記する。現在の所有者は候補から落として名前だけ覚える
 * — 同じ所有者への移動は `moveNote` の no-op なので選択肢にならず、
 * 名前は確認の文面（誰が読めなくなるか）で要る。
 */
export function appendPage(
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
