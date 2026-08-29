import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";

/**
 * P-25 の「実行不可」が並べる、片づける先の一覧（PAGE-p25-004）。
 *
 * 主体は Cookie のセッションで、`userId` を要求本文で受け取らない。削除が
 * 拒否された直後にしか呼ばないので、その時点でセッションは生きている
 * （受理されなかった要求は Cookie を破棄しない）。
 *
 * 先頭ページだけを返し、続きは追加読込を持たない — 削除を通すには全部を
 * 片づける必要があり、片づけるたびに削除をやり直すとその時点の残りが
 * 引き直されるので、ページを繰る導線は残りを見せる役に立たない。続きが
 * あることだけは `hasMore` で伝える。
 *
 * `owner` かどうかだけを返すのは、譲渡（P-32）とワークスペース削除
 * （P-34）がどちらも owner 限定で、それ以外の行に出せる片づけ方は脱退
 * （P-32）しか無いためである。
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

export const listRemainingWorkspacesFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/listUserWorkspaces"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const page = await module.listUserWorkspaces({
      container,
      input: { userId: user.userId, cursor: null },
    });
    return {
      workspaces: page.workspaces.map(
        (workspace): RemainingWorkspace =>
          workspace.status === "active"
            ? {
                status: "active",
                workspaceId: workspace.workspaceId,
                name: workspace.name,
                isOwner: workspace.role === "owner",
              }
            : { status: "unavailable", workspaceId: workspace.workspaceId },
      ),
      hasMore: page.hasMore,
    };
  });
