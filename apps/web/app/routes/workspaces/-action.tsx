import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createWorkspaceSchema,
  workspaceSlugAvailabilitySchema,
} from "@/components/workspace/schema";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { REDIRECT_MAX_LENGTH } from "@/presentation/redirect";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";

/**
 * P-30 ワークスペース作成の server function 置き場。
 *
 * 主体は Cookie のセッションで、`userId` を要求本文で受け取らない。
 *
 * スラッグの可否照会だけは P-31（`settings/-action.tsx`）からも使う。
 * 同じ 1 つのユースケースを 2 つの画面が同じ形で呼ぶだけなので、
 * `/workspaces` 配下の入口であるこの置き場に 1 本だけ置く。
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
    const [{ requireSessionOrRedirect }, { getContainer }, { toViewerView }] =
      await Promise.all([
        import("@/presentation/sessionGuard"),
        import("@repo/core/application/di/containerStore"),
        import("@/presentation/auth"),
      ]);
    const [user, container] = await Promise.all([
      requireSessionOrRedirect(data.redirect),
      getContainer(),
    ]);
    return { user: toViewerView(user), appUrl: container.config.appUrl };
  });

/**
 * P-30 / P-31 のスラッグ欄の目安表示（WS-01「入力中に検出して代替候補を
 * 示す」）。可否を確定させるのは作成・変更時の予約なので、ここでの
 * 「使用できます」は送信可否を左右しない。副作用を持たない読みなので
 * GET で宣言する。
 */
export const checkWorkspaceSlugAvailabilityFn = createServerFn({
  method: "GET",
})
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceSlugAvailabilitySchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () =>
          import(
            "@repo/core/application/workspace/checkWorkspaceSlugAvailability"
          ),
      ),
      import("@/presentation/session"),
    ]);
    await requireSession();
    return module.checkWorkspaceSlugAvailability({
      container,
      input: { slug: data.slug, workspaceId: data.workspaceId },
    });
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
