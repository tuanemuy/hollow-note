import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createWorkspaceSchema } from "@/components/workspace/schema";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { REDIRECT_MAX_LENGTH } from "@/presentation/redirect";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";

/**
 * P-30 ワークスペース作成の server function 置き場。
 *
 * 主体は Cookie のセッションで、`userId` を要求本文で受け取らない。
 */

const pageInputSchema = z.object({
  redirect: z.string().min(1).max(REDIRECT_MAX_LENGTH),
});

/**
 * P-30 の入口。読み出すサーバー状態を持たない画面なので断片を返さず、
 * セッション（＝ガード）と、スラッグ欄の接頭辞に使う配備オリジンだけを
 * 返す。セッションが無ければ `redirect` を投げる。
 */
export const loadWorkspaceCreatePage = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(pageInputSchema))
  .handler(async ({ data }) => {
    const [{ requireSessionOrRedirect }, { getContainer }] = await Promise.all([
      import("@/presentation/sessionGuard"),
      import("@repo/core/application/di/containerStore"),
    ]);
    const [user, container] = await Promise.all([
      requireSessionOrRedirect(data.redirect),
      getContainer(),
    ]);
    return { user, appUrl: container.config.appUrl };
  });

/**
 * PAGE-p30-002。作成に成功した文脈をそのまま表示中のスコープにする
 * （WS-01 手順 4）ので、次回訪問の引き継ぎ Cookie もこの応答で書く。
 */
export const createWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(createWorkspaceSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }, scopeCookie] =
      await Promise.all([
        loadServerDeps(
          () => import("@repo/core/application/workspace/createWorkspace"),
        ),
        import("@/presentation/session"),
        import("@/presentation/scopeCookie"),
      ]);
    const user = await requireSession();
    const slug = data.slug.trim();
    const view = await module.createWorkspace({
      container,
      input: {
        userId: user.userId,
        name: data.name,
        description: data.description,
        slug: slug === "" ? null : slug,
      },
    });
    scopeCookie.writeScopeSelection({
      kind: "workspace",
      workspaceId: view.workspaceId,
    });
    return view;
  });
