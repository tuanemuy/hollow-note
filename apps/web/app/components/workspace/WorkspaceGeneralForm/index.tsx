import { WorkspaceUnavailable } from "@/components/workspace/WorkspaceUnavailable";
import { serializeError } from "@/presentation/errorResponse";
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
  // 非メンバー（`InsufficientRole`）と削除済み（`WORKSPACE_NOT_FOUND`）は
  // 同じ終端表示に畳む。断片の中で `throw` すると `kind` タグを失って
  // ルート境界に届くので、ここで描き切る（`WorkspaceMembersPanel` と同じ）。
  let general: Awaited<ReturnType<typeof loadWorkspaceGeneral>>;
  try {
    general = await loadWorkspaceGeneral(workspaceId, userId);
  } catch (error) {
    const { kind } = serializeError(error);
    if (kind === "business" || kind === "forbidden" || kind === "notFound") {
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
