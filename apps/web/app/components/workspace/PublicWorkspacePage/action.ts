import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * P-43 の読み出し。どちらも**未サインインで走る**ので、セッションを
 * 前提にしない。
 *
 * `getPublicWorkspace`（UC-workspace-020）は不正スラッグ・未使用スラッグ・
 * 非公開・削除済みをすべて `WORKSPACE_NOT_FOUND` に畳むので、このページが
 * 「どのワークスペースが private に存在するか」の判定器にならない。
 */
export const loadPublicWorkspace = cache(
  serverData(
    () => import("@repo/core/application/workspace/getPublicWorkspace"),
    ({ container }, { getPublicWorkspace }, slug: string) =>
      getPublicWorkspace({ container, input: { slug } }),
  ),
);

/**
 * 外部向け表示バナー（P-43「メンバー閲覧」）の出し分けだけに使う。
 * 非メンバーは `role: null` で、公開ページの中身は role によって一切
 * 変わらない — 変えると公開されていない情報がこの URL から漏れる。
 */
export const loadViewerWorkspaceRole = cache(
  serverData(
    () => import("@repo/core/application/workspace/resolveWorkspaceAccess"),
    async (
      { container },
      { resolveWorkspaceAccess },
      workspaceId: string,
      userId: string,
    ) => {
      const access = await resolveWorkspaceAccess({
        container,
        input: { workspaceId, userId },
      });
      return access.role;
    },
  ),
);
