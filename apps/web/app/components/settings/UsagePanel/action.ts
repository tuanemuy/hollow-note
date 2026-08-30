import { createServerFn } from "@tanstack/react-start";
import { cache } from "react";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps, serverData } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";

/**
 * P-24 が 1 ページに載せるワークスペースの件数（spec/pages/index.md#P-24
 * 「workspace を 20 件ずつ読み込む導線」）。`getUsageSnapshot` の既定と
 * 同じ値だが、画面の約束として明示して渡す。
 */
const WORKSPACE_PAGE_SIZE = 20;

/** P-24 の使用量読み出し（UC-usage-001）。初回はワークスペースの先頭ページ。 */
export const loadUsageSnapshot = cache(
  serverData(
    () => import("@repo/core/application/usage/getUsageSnapshot"),
    ({ container }, { getUsageSnapshot }, userId: string) =>
      getUsageSnapshot({
        container,
        input: {
          userId,
          workspaceCursor: null,
          workspaceLimit: WORKSPACE_PAGE_SIZE,
        },
      }),
  ),
);

const workspaceUsagePageSchema = z.object({
  cursor: z.string().min(1).max(512),
});

/**
 * PAGE-p24-002。次の 20 件を取りに行く。
 *
 * 個人と LLM の数値も一緒に返ってくるが、島はワークスペースの行だけを
 * 使う — 画面の「◯◯時点」は先頭ページの `updatedAt` に固定する約束で
 * （`getUsageSnapshot` の JSDoc）、ページを繰るたびに基準時刻が動いて
 * 見えるのを避けるためである。
 */
export const loadMoreWorkspaceUsageFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceUsagePageSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/usage/getUsageSnapshot"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const snapshot = await module.getUsageSnapshot({
      container,
      input: {
        userId: user.userId,
        workspaceCursor: data.cursor,
        workspaceLimit: WORKSPACE_PAGE_SIZE,
      },
    });
    return {
      workspaces: snapshot.workspaces,
      nextWorkspaceCursor: snapshot.nextWorkspaceCursor,
    };
  });
