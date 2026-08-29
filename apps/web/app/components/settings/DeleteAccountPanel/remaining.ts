/**
 * P-25 の実行不可（PAGE-p25-004）が並べる「片づける先」の行と、一覧が
 * 空だった場合・引けなかった場合の畳み方。
 *
 * 3 つに割るのは、拒否の根拠と一覧の出所が同じ集合ではないからである。
 * 受理を拒むのは settled な edge の数（`active` / `pending` / `removing`）
 * で、一覧が返すのは `active` な edge だけなので、脱退直後・受諾が未確定
 * の利用者は**拒否されたのに 1 件も並ばない**。取得の失敗と同じ表示に
 * 潰すと、どちらも「片づける先が無いのに拒否された」としか読めない。
 *
 * `listed` が空の一覧を持てない形にしてあるので、「並べる行があるのに
 * 反映待ちと言う」表示は型の上で作れない。
 *
 * DOM もサーバー関数のランタイムも無しでこの畳み込みを単体テストできる
 * よう島から出してある（`submit.ts` と同じ理由）。
 */
export type RemainingWorkspace =
  | Readonly<{
      status: "active";
      workspaceId: string;
      name: string;
      isOwner: boolean;
    }>
  /** ディレクトリの shard が答えられなかった行。名前も権限も出せない。 */
  | Readonly<{ status: "unavailable"; workspaceId: string }>;

export type RemainingPage = Readonly<{
  workspaces: readonly RemainingWorkspace[];
  hasMore: boolean;
}>;

export type RemainingListing =
  | Readonly<{
      kind: "listed";
      workspaces: readonly [RemainingWorkspace, ...RemainingWorkspace[]];
      hasMore: boolean;
    }>
  /** 拒否されたのに 1 件も無い。まだ反映されていない edge が残っている。 */
  | Readonly<{ kind: "settling" }>
  /** 一覧そのものを引けなかった。拒否の事実と理由は残る。 */
  | Readonly<{ kind: "unavailable" }>;

export function remainingListing(page: RemainingPage | null): RemainingListing {
  if (page === null) {
    return { kind: "unavailable" };
  }
  const [first, ...rest] = page.workspaces;
  if (first === undefined) {
    return { kind: "settling" };
  }
  return {
    kind: "listed",
    workspaces: [first, ...rest],
    hasMore: page.hasMore,
  };
}
