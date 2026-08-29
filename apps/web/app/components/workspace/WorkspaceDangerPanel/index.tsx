import type { WorkspaceSettingsView } from "@repo/core/application/workspace/view";
import {
  dangerPanelClass,
  dangerPanelTitleClass,
  ghostButtonClass,
  panelNoteClass,
} from "@/components/settings/panelStyles";
import { WorkspaceUnavailable } from "@/components/workspace/WorkspaceUnavailable";
import { serializeError } from "@/presentation/errorResponse";
import { loadWorkspaceDeletionStatus, loadWorkspaceSettings } from "./action";
import { WorkspaceDeletionForm } from "./panel";

/**
 * P-34 ワークスペース削除の本体（モック P34-workspace-danger.html）。
 *
 * 影響の説明に出す件数（ノート数・容量・メンバー数）は、それを読み出す
 * ユースケースが無いため数字では出さず、何が消えるかの列挙に留める。
 *
 * 進行（P-34 の「実行中 / 完了」）は `getWorkspaceDeletionStatus` が答える。
 * 完了したワークスペースには行が残らないので、そのときだけ
 * `getWorkspaceSettings` を呼ばずに終端表示へ落ちる。
 */
export async function WorkspaceDangerPanel({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  let settings: WorkspaceSettingsView;
  let deletion: Awaited<ReturnType<typeof loadWorkspaceDeletionStatus>>;
  try {
    deletion = await loadWorkspaceDeletionStatus(workspaceId, userId);
    if (deletion.status === "completed") {
      return <WorkspaceDeletionCompleted />;
    }
    settings = await loadWorkspaceSettings(workspaceId, userId);
  } catch (error) {
    // 非メンバー・削除済みの畳み方は `WorkspaceGeneralForm` と同じ。
    const { kind } = serializeError(error);
    if (kind === "business" || kind === "forbidden" || kind === "notFound") {
      return <WorkspaceUnavailable />;
    }
    throw error;
  }

  return (
    <WorkspaceDeletionForm
      workspace={settings}
      inProgress={deletion.status === "inProgress"}
    />
  );
}

function WorkspaceDeletionCompleted() {
  return (
    <section className={dangerPanelClass}>
      <h2 className={dangerPanelTitleClass}>
        このワークスペースは削除されました
      </h2>
      <p className={panelNoteClass}>
        ノート・タグ・公開ページはすべて削除され、メンバー全員がアクセスできなくなりました。
      </p>
      <a className={ghostButtonClass} href="/notes">
        個人のノートへ
      </a>
    </section>
  );
}
