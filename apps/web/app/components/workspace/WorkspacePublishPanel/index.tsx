import { loadWorkspaceSettings } from "@/components/workspace/settingsRead";
import { WorkspaceUnavailable } from "@/components/workspace/WorkspaceUnavailable";
import { WorkspacePublishBoard } from "./panel";

/**
 * P-33 ワークスペース公開設定の本体（モック P33-workspace-publish.html）。
 *
 * 公開 URL は配備のオリジンとスラッグから作るのでここで解決する。
 * 公開ノート件数は `publishWorkspace` の応答にしか無いため、初期表示では
 * 持たない（島が公開操作の応答から受け取る）。
 */
export async function WorkspacePublishPanel({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  const settings = await loadWorkspaceSettings(workspaceId, userId);
  if (settings === null) {
    return <WorkspaceUnavailable />;
  }
  return (
    <WorkspacePublishBoard
      workspace={settings}
      publicUrl={
        settings.slug === null
          ? null
          : `${settings.appUrl.replace(/\/$/, "")}/w/${settings.slug}`
      }
    />
  );
}
