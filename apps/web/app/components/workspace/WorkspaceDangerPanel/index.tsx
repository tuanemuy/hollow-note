import { loadWorkspaceSettings } from "@/components/workspace/settingsRead";
import { WorkspaceUnavailable } from "@/components/workspace/WorkspaceUnavailable";
import { WorkspaceDeletionForm } from "./panel";

/**
 * P-34 ワークスペース削除の本体（モック P34-workspace-danger.html）。
 *
 * 影響の説明に出す件数（ノート数・容量・メンバー数）は、それを読み出す
 * ユースケースが無いため数字では出さず、何が消えるかの列挙に留める。
 */
export async function WorkspaceDangerPanel({
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
  return <WorkspaceDeletionForm workspace={settings} />;
}
