import { WorkspaceUnavailable } from "@/components/workspace/WorkspaceUnavailable";
import { serializeError } from "@/presentation/errorResponse";
import { loadWorkspacePublication } from "./action";
import { WorkspacePublishBoard } from "./panel";

/**
 * P-33 ワークスペース公開設定の本体（モック P33-workspace-publish.html）。
 *
 * 公開 URL も公開ノート件数も `getWorkspacePublication` が初期表示で返す。
 * 件数は非公開のときも数えるので、「公開ページが空のままになる」注意は
 * 判断を変えられる唯一の瞬間、つまり公開する前に出せる（WS-08 手順 2）。
 */
export async function WorkspacePublishPanel({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  // 非メンバー・削除済みの畳み方は `WorkspaceGeneralForm` と同じ。
  let publication: Awaited<ReturnType<typeof loadWorkspacePublication>>;
  try {
    publication = await loadWorkspacePublication(workspaceId, userId);
  } catch (error) {
    const { kind } = serializeError(error);
    if (kind === "business" || kind === "forbidden" || kind === "notFound") {
      return <WorkspaceUnavailable />;
    }
    throw error;
  }

  return <WorkspacePublishBoard publication={publication} />;
}
