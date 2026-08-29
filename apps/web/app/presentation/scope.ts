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

/** 転送境界の上限。ID は生成器由来なので実際はこれよりずっと短い。 */
export const WORKSPACE_ID_MAX_LENGTH = 128;

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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
