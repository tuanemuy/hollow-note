import { loadWorkspaceSettings } from "@/components/workspace/settingsRead";
import { WorkspaceUnavailable } from "@/components/workspace/WorkspaceUnavailable";
import { WorkspaceGeneralEditor } from "./editor";

/**
 * P-31 ワークスペース一般設定の本体（モック P31-workspace-general.html）。
 *
 * 読み出しはこのサーバーコンポーネントが行い、編集はすべて島
 * （`WorkspaceGeneralEditor`）に渡す。スラッグ欄の接頭辞は配備のオリジンから
 * 作るので、島が `config` を読まずに済むようここで解決する。
 */
export async function WorkspaceGeneralForm({
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
    <WorkspaceGeneralEditor
      workspace={settings}
      slugPrefix={slugPrefix(settings.appUrl)}
    />
  );
}

function slugPrefix(appUrl: string): string {
  try {
    return `${new URL(appUrl).host}/w/`;
  } catch {
    return "/w/";
  }
}
