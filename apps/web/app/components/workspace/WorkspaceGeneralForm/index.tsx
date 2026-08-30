import { WorkspaceUnavailable } from "@/components/workspace/WorkspaceUnavailable";
import { serializeError } from "@/presentation/errorResponse";
import { workspaceUnavailability } from "@/presentation/scope";
import { loadWorkspaceGeneral } from "./action";
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
  // 断片の中で `throw` すると `kind` タグを失ってルート境界に届くので、
  // 「開けない」は終端表示としてここで描き切る（`WorkspaceMembersPanel` と
  // 同じ）。どの失敗がそれに当たるかは `workspaceUnavailability` だけが決める。
  let general: Awaited<ReturnType<typeof loadWorkspaceGeneral>>;
  try {
    general = await loadWorkspaceGeneral(workspaceId, userId);
  } catch (error) {
    if (workspaceUnavailability(serializeError(error)) !== null) {
      return <WorkspaceUnavailable />;
    }
    throw error;
  }

  return (
    <WorkspaceGeneralEditor
      workspace={general.settings}
      slugPrefix={slugPrefix(general.appUrl)}
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
