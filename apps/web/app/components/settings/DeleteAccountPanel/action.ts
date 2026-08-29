import { createServerFn } from "@tanstack/react-start";
import type {
  RemainingPage,
  RemainingWorkspace,
} from "@/components/settings/DeleteAccountPanel/remaining";
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
 * **この一覧は拒否の根拠と同じ集合ではない。** `listUserWorkspaces` は
 * `UserWorkspaceDirectory.listActiveByUser` の `active` な edge だけを
 * 返すのに対し、受理を拒む `admitAccountDeletion` は settled な edge
 * （`active` / `pending` / `removing`）を数える。ポートの JSDoc が
 * 「`listActiveByUser` は代用にならない」と定めているとおりで、脱退直後
 * （`removing`）・受諾が未確定（`pending`）の利用者は拒否されたまま 0 件
 * になりうる。その窓の表示は `remaining.ts` の `settling` が持つ。
 *
 * `owner` かどうかだけを返すのは、譲渡（P-32）とワークスペース削除
 * （P-34）がどちらも owner 限定で、それ以外の行に出せる片づけ方は脱退
 * （P-32）しか無いためである。
 */
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
    } satisfies RemainingPage;
  });
