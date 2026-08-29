import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * P-34 の読み出し。進行（`getWorkspaceDeletionStatus`）と、確認入力に要る
 * 名前・可否（`getWorkspaceSettings`）の 2 本に分かれる。
 *
 * 順に呼ぶこと。削除が終わったワークスペースには行そのものが無く、
 * `getWorkspaceSettings` は `WORKSPACE_NOT_FOUND` を投げるので、先に進行を
 * 読まないと「完了」を描けない。
 */
export const loadWorkspaceDeletionStatus = cache(
  serverData(
    () => import("@repo/core/application/workspace/getWorkspaceDeletionStatus"),
    (
      { container },
      { getWorkspaceDeletionStatus },
      workspaceId: string,
      userId: string,
    ) =>
      getWorkspaceDeletionStatus({ container, input: { workspaceId, userId } }),
  ),
);

export const loadWorkspaceSettings = cache(
  serverData(
    () => import("@repo/core/application/workspace/getWorkspaceSettings"),
    (
      { container },
      { getWorkspaceSettings },
      workspaceId: string,
      userId: string,
    ) => getWorkspaceSettings({ container, input: { workspaceId, userId } }),
  ),
);
