import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * P-31 の読み出し（`getWorkspaceSettings`）。
 *
 * スラッグ欄の接頭辞に要る配備のオリジンは、どのユースケースの DTO にも
 * 無い設定値なので同じ 1 回で添える。島が `config` を読まずに済む。
 */
export const loadWorkspaceGeneral = cache(
  serverData(
    () => import("@repo/core/application/workspace/getWorkspaceSettings"),
    async (
      { container },
      { getWorkspaceSettings },
      workspaceId: string,
      userId: string,
    ) => ({
      settings: await getWorkspaceSettings({
        container,
        input: { workspaceId, userId },
      }),
      appUrl: container.config.appUrl,
    }),
  ),
);
