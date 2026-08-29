import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * ワークスペース設定 3 画面（P-31 / P-33 / P-34）が共有する読み出し。
 *
 * 権限と存在の判定は `resolveWorkspaceAccess`（UC-workspace-001）が行い、
 * 非メンバーは `null` を返す — WS-02 の「除名された・削除済みのワークス
 * ペースを URL で直接開いた」経路をここで畳む。
 *
 * 表示に要る `description` / `avatarUrl` / `slug` だけは `WorkspaceReader`
 * を直接読んでいる。**ワークスペース自身の設定を読むユースケースが
 * `application/workspace/` に無い**ためで（`resolveWorkspaceAccess` は
 * 名前と公開状態しか返さず、`WorkspaceProfileView` を返すのは書き込みの
 * `updateWorkspaceProfile` だけ）、読み取りユースケースが入ったらこの
 * 関数はその呼び出し 1 本に縮む。認可の判断は上のユースケースが持ったまま
 * なので、ここで増えているのは射影だけである。
 */
export type WorkspaceSettingsView = Readonly<{
  workspaceId: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  slug: string | null;
  publication: "private" | "published";
  role: "owner" | "editor" | "viewer";
  canManage: boolean;
  appUrl: string;
}>;

export const loadWorkspaceSettings = cache(
  serverData(
    () => import("@repo/core/application/workspace/resolveWorkspaceAccess"),
    async (
      { container },
      { resolveWorkspaceAccess },
      workspaceId: string,
      userId: string,
    ): Promise<WorkspaceSettingsView | null> => {
      const access = await resolveWorkspaceAccess({
        container,
        input: { workspaceId, userId },
      });
      const role = access.role;
      if (role === null) return null;

      const [{ ScopeKey }, { WorkspaceId }, { WorkspaceAuthorization }] =
        await Promise.all([
          import("@repo/core/application/scope"),
          import("@repo/core/domain/workspace/valueObject"),
          import("@repo/core/domain/workspace/services/workspaceAuthorization"),
        ]);
      const id = WorkspaceId.create(workspaceId);
      const stored = await container
        .workspaceReaderFor(ScopeKey.workspace(id))
        .workspace.findById(id);
      if (stored === null) return null;
      const workspace = stored.entity;

      return {
        workspaceId: workspace.id,
        name: workspace.name,
        description: workspace.description,
        avatarUrl: workspace.avatarUrl,
        slug: workspace.slug,
        publication: workspace.publication,
        role,
        canManage: WorkspaceAuthorization.can(role, "manageWorkspace"),
        appUrl: container.config.appUrl,
      };
    },
  ),
);
