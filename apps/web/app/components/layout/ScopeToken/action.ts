import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { WORKSPACE_ID_MAX_LENGTH } from "@/components/workspace/schema";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import type { ScopeSelection } from "@/presentation/scope";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";

/**
 * スコープトークン（L-01）のサーバー関数。
 *
 * 主体は Cookie のセッションで、`userId` を要求本文で受け取らない。
 * 切り替えの正本は URL で、ここで書く Cookie は次回訪問の引き継ぎ
 * （WS-02）にしか使わない。
 */

const scopeSelectionSchema = z.object({
  // `null` は個人の文脈。
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH).nullable(),
});

/** WS-02 手順 4。切り替えた文脈を次回訪問へ引き継ぐ。 */
export const selectScopeFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(scopeSelectionSchema))
  .handler(async ({ data }) => {
    const [{ requireSession }, scopeCookie] = await Promise.all([
      import("@/presentation/session"),
      import("@/presentation/scopeCookie"),
    ]);
    await requireSession();
    scopeCookie.writeScopeSelection(
      data.workspaceId === null
        ? { kind: "personal" }
        : { kind: "workspace", workspaceId: data.workspaceId },
    );
    return { selected: true };
  });

/**
 * 入口（`/`）が読む引き継ぎ。権限は開いた先が判定するので、ここでは
 * 記録された選択をそのまま返す。
 */
export const lastScopeFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async (): Promise<ScopeSelection> => {
    const { readScopeSelection } = await import("@/presentation/scopeCookie");
    return readScopeSelection();
  });

const workspacePageSchema = z.object({
  cursor: z.string().min(1).max(512).nullable(),
});

/** WS-02 手順 2。参加中のワークスペースを 20 件ずつ追加読込する。 */
export const listMyWorkspacesFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspacePageSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/listUserWorkspaces"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.listUserWorkspaces({
      container,
      input: { userId: user.userId, cursor: data.cursor },
    });
  });
