/**
 * 表示中のスコープ（WS-02、spec/pages/index.md#L-01 のスコープトークン）。
 *
 * フレームワークに依存しない純関数だけを置く — Cookie の運搬は
 * `presentation/scopeCookie.ts`、UI は `components/layout/ScopeToken`。
 * この分割は `redirect.ts` と `sessionGuard.ts` の関係と同じで、判定を
 * サーバー関数のランタイム無しで単体テストできる形に保つためにある。
 */
export type ScopeSelection =
  | Readonly<{ kind: "personal" }>
  | Readonly<{ kind: "workspace"; workspaceId: string }>;

export const PERSONAL_SCOPE: ScopeSelection = { kind: "personal" };

const WORKSPACE_PREFIX = "workspace:";

/**
 * ワークスペース ID の転送境界上限の**正本**。ID は生成器由来なので実際は
 * これよりずっと短い。Cookie 経路（`parseScope`）と本文経路
 * （`components/workspace/schema.ts` が再 export する）が同じ長さを受け付ける
 * ように、この層に 1 つだけ置く — 依存は components → presentation の一方向
 * なので、逆向きに引くと循環しうる。
 */
export const WORKSPACE_ID_MAX_LENGTH = 128;

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * その選択がこのワークスペースを名指しているか。
 *
 * 脱退・削除は**表示中のスコープ以外からも**実行できる（P-24 の使用量
 * 一覧と P-25 の残存一覧が任意のワークスペースの P-32 / P-34 へ直接
 * リンクする）ので、応答が引き継ぎを畳んでよいのはここが真のときだけ
 * になる。無条件に消すと、無関係なワークスペースを片づけただけで
 * WS-02 手順 4 の「選択は次回の訪問時にも引き継がれる」が壊れる。
 */
export function namesWorkspace(
  scope: ScopeSelection,
  workspaceId: string,
): boolean {
  return scope.kind === "workspace" && scope.workspaceId === workspaceId;
}

/**
 * 開こうとしたワークスペースが「もう開けない」理由。`gone` は行が残って
 * いない（削除の完了 / 不在）、`denied` はメンバーでないことによる拒否。
 */
export type WorkspaceUnavailability = "gone" | "denied";

/**
 * その読み出しの失敗が「この文脈はもう開けない」を意味するか、意味するなら
 * どちらの理由か（意味しなければ `null`）。
 *
 * **どちらの理由も他の owner が起こせる** — 除名（WS-05）とワークスペース
 * ごとの削除（WS-10）である。だから引き継ぎ Cookie を畳む判定は「自分が
 * 実行した脱退・削除の応答」ではなく**文脈を開こうとした読み出しの失敗**に
 * 置く。応答側だけで畳むと、他者が起こした変化では誰も畳まず、入口
 * （`routes/index.tsx` の `beforeLoad`）が毎回その ID へ送り続ける
 * （誘導先の `/notes` も Cookie を書かないので自己修復しない）。
 *
 * `business` を丸ごと `denied` に寄せるのは、設定シェルと 4 つの断片が
 * 同じ 3 kind を 1 つの終端表示に畳んでいるためで、判定の広さをそちらと
 * 揃えてある（`kind` ごとの写像はここ 1 か所）。
 */
export function workspaceUnavailability(
  failure: Readonly<{ kind: string }>,
): WorkspaceUnavailability | null {
  if (failure.kind === "notFound") return "gone";
  if (failure.kind === "forbidden" || failure.kind === "business") {
    return "denied";
  }
  return null;
}

export function serializeScope(scope: ScopeSelection): string {
  return scope.kind === "personal"
    ? "personal"
    : `${WORKSPACE_PREFIX}${scope.workspaceId}`;
}

/**
 * Cookie に入っていた値をスコープへ戻す。読めない値はすべて個人へ倒す
 * — この値は「次にどこを開くか」しか決めないので、壊れた Cookie で
 * 到達不能な URL へ飛ばすより、既定の文脈へ戻すほうが安全側になる。
 */
export function parseScope(raw: string | null | undefined): ScopeSelection {
  if (raw === null || raw === undefined || !raw.startsWith(WORKSPACE_PREFIX)) {
    return PERSONAL_SCOPE;
  }
  const workspaceId = raw.slice(WORKSPACE_PREFIX.length);
  if (
    workspaceId.length === 0 ||
    workspaceId.length > WORKSPACE_ID_MAX_LENGTH ||
    !WORKSPACE_ID_PATTERN.test(workspaceId)
  ) {
    return PERSONAL_SCOPE;
  }
  return { kind: "workspace", workspaceId };
}
