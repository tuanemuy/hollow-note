import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  changeMemberRoleSchema,
  changeWorkspaceSlugSchema,
  deleteWorkspaceSchema,
  invitationRefSchema,
  inviteMemberSchema,
  membershipRefSchema,
  updateWorkspaceProfileSchema,
  WORKSPACE_ID_MAX_LENGTH,
  workspaceAvatarUploadSchema,
  workspaceRefSchema,
} from "@/components/workspace/schema";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { REDIRECT_MAX_LENGTH } from "@/presentation/redirect";
import { loadServerDeps } from "@/presentation/serverAction";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

/**
 * ワークスペース設定（`/workspaces/:workspaceId/settings/*`）の server
 * function 置き場。
 *
 * どれも主体は Cookie のセッションで、`userId` を要求本文で受け取らない。
 * 対象のワークスペースだけが本文から来るので、権限は各ユースケースが
 * `resolveWorkspaceAccess` → `WorkspaceAuthorization.ensureCan` で毎回
 * 判定する。レイアウトの `loader` ガードは遷移の誘導にすぎない。
 */

const shellInputSchema = z.object({
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH),
  redirect: z.string().min(1).max(REDIRECT_MAX_LENGTH),
});

/**
 * レイアウト（シェル + タブ列）の読み出し。断片ではなく素の値を返すのは、
 * シェルがルートの `component` 側に留まる必要があるため — RSC ペイロード
 * に含めると子ルートを跨ぐたびに作り直され、メニューの開閉が飛ぶ。
 *
 * 非メンバー・削除済みは `workspace: null` として返し、画面側が個人の
 * 文脈への導線を出す（WS-02）。
 */
export const loadWorkspaceSettingsShell = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(shellInputSchema))
  .handler(async ({ data }) => {
    const [
      { loadWorkspaceSettings },
      { requireSessionOrRedirect },
      { toViewerView },
    ] = await Promise.all([
      import("@/components/workspace/settingsRead"),
      import("@/presentation/sessionGuard"),
      import("@/presentation/auth"),
    ]);
    const user = await requireSessionOrRedirect(data.redirect);
    const settings = await loadWorkspaceSettings(data.workspaceId, user.userId);
    return {
      user: toViewerView(user),
      workspace:
        settings === null
          ? null
          : {
              workspaceId: settings.workspaceId,
              name: settings.name,
              slug: settings.slug,
              publication: settings.publication,
              role: settings.role,
            },
    };
  });

/** P-31 の一般設定フラグメント。 */
export const renderWorkspaceGeneralForm = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceRefSchema))
  .handler(async ({ data }) => {
    const [{ WorkspaceGeneralForm }, { requireSession }] = await Promise.all([
      import("@/components/workspace/WorkspaceGeneralForm"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return {
      WorkspaceGeneralForm: renderServerFragment(() =>
        WorkspaceGeneralForm({
          workspaceId: data.workspaceId,
          userId: user.userId,
        }),
      ),
    };
  });

/** P-33 の公開設定フラグメント。 */
export const renderWorkspacePublishPanel = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceRefSchema))
  .handler(async ({ data }) => {
    const [{ WorkspacePublishPanel }, { requireSession }] = await Promise.all([
      import("@/components/workspace/WorkspacePublishPanel"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return {
      WorkspacePublishPanel: renderServerFragment(() =>
        WorkspacePublishPanel({
          workspaceId: data.workspaceId,
          userId: user.userId,
        }),
      ),
    };
  });

/** P-32 のメンバー管理フラグメント。 */
export const renderWorkspaceMembersPanel = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceRefSchema))
  .handler(async ({ data }) => {
    const [{ WorkspaceMembersPanel }, { requireSession }] = await Promise.all([
      import("@/components/workspace/WorkspaceMembersPanel"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return {
      WorkspaceMembersPanel: renderServerFragment(() =>
        WorkspaceMembersPanel({
          workspaceId: data.workspaceId,
          userId: user.userId,
        }),
      ),
    };
  });

/** P-34 の削除フラグメント。 */
export const renderWorkspaceDangerPanel = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceRefSchema))
  .handler(async ({ data }) => {
    const [{ WorkspaceDangerPanel }, { requireSession }] = await Promise.all([
      import("@/components/workspace/WorkspaceDangerPanel"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return {
      WorkspaceDangerPanel: renderServerFragment(() =>
        WorkspaceDangerPanel({
          workspaceId: data.workspaceId,
          userId: user.userId,
        }),
      ),
    };
  });

/** PAGE-p31-002。名前・説明・アイコンの保存。 */
export const updateWorkspaceProfileFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(updateWorkspaceProfileSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/updateWorkspaceProfile"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    // 省略されたキーは「変更しない」。`exactOptionalPropertyTypes` の下では
    // `undefined` を渡すことと省略することが別物なので明示的に積み直す。
    return module.updateWorkspaceProfile({
      container,
      input: {
        workspaceId: data.workspaceId,
        userId: user.userId,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      },
    });
  });

/** PAGE-p31-003。空文字はスラッグの解除。 */
export const changeWorkspaceSlugFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(changeWorkspaceSlugSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/changeWorkspaceSlug"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const slug = data.slug.trim();
    return module.changeWorkspaceSlug({
      container,
      input: {
        workspaceId: data.workspaceId,
        userId: user.userId,
        slug: slug === "" ? null : slug,
      },
    });
  });

/**
 * PAGE-p31-004。`storeAvatar` はバイト列を置くだけでワークスペースを
 * 書かないので、返った `url` を `updateWorkspaceProfileFn` へ渡す 2 段目が
 * 要る（P-21 のアイコンと同じ形）。
 */
export const uploadWorkspaceAvatarFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator((input: unknown) =>
    validateInput(workspaceAvatarUploadSchema)({
      file: input instanceof FormData ? input.get("file") : undefined,
      workspaceId:
        input instanceof FormData ? input.get("workspaceId") : undefined,
    }),
  )
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/storage/storeAvatar"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const body = new Uint8Array(await data.file.arrayBuffer());
    const view = await module.storeAvatar({
      container,
      input: {
        userId: user.userId,
        subjectType: "workspace",
        subjectId: data.workspaceId,
        fileName: data.file.name,
        body,
      },
    });
    return { fileId: view.fileId, url: view.url };
  });

/** PAGE-p33-002。公開ノート件数は応答からしか得られない。 */
export const publishWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceRefSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/publishWorkspace"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.publishWorkspace({
      container,
      input: { workspaceId: data.workspaceId, userId: user.userId },
    });
  });

/** PAGE-p33-002（非公開化）。 */
export const unpublishWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceRefSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/unpublishWorkspace"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.unpublishWorkspace({
      container,
      input: { workspaceId: data.workspaceId, userId: user.userId },
    });
  });

/**
 * PAGE-p34-002。受理（202）までが要求経路の答えで、以降はワーカー面が
 * 続ける。この文脈はもう開けないので、引き継ぎ Cookie を個人へ戻すのも
 * この応答の仕事になる。
 */
export const deleteWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(deleteWorkspaceSchema))
  .handler(async ({ data }) => {
    const [
      { container, module },
      { requireSession },
      scopeCookie,
      startServer,
    ] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/deleteWorkspace"),
      ),
      import("@/presentation/session"),
      import("@/presentation/scopeCookie"),
      import("@tanstack/react-start/server"),
    ]);
    const user = await requireSession();
    const view = await module.deleteWorkspace({
      container,
      input: {
        workspaceId: data.workspaceId,
        userId: user.userId,
        confirmationName: data.confirmationName,
      },
    });
    scopeCookie.clearScopeSelection();
    startServer.setResponseStatus(202);
    return view;
  });

/**
 * PAGE-p32-002。応答の `invitationUrl` は招待リンクのコピー
 * （PAGE-p32-003）が使える唯一の経路 — 一覧はトークンを載せないので、
 * 発行した本人が発行直後に受け取るこの 1 回きりになる。
 */
export const inviteMemberFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(inviteMemberSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/inviteMember"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.inviteMember({
      container,
      input: {
        workspaceId: data.workspaceId,
        userId: user.userId,
        email: data.email,
        role: data.role,
      },
    });
  });

/** PAGE-p32-004。新しい期限と新しいリンクを返す。 */
export const resendInvitationFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(invitationRefSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/resendInvitation"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.resendInvitation({
      container,
      input: {
        workspaceId: data.workspaceId,
        userId: user.userId,
        invitationId: data.invitationId,
      },
    });
  });

/** PAGE-p32-005。 */
export const revokeInvitationFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(invitationRefSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/revokeInvitation"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    await module.revokeInvitation({
      container,
      input: {
        workspaceId: data.workspaceId,
        userId: user.userId,
        invitationId: data.invitationId,
      },
    });
    return { revoked: true };
  });

/** PAGE-p32-006。 */
export const changeMemberRoleFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(changeMemberRoleSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/changeMemberRole"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.changeMemberRole({
      container,
      input: {
        workspaceId: data.workspaceId,
        actorUserId: user.userId,
        membershipId: data.membershipId,
        role: data.role,
      },
    });
  });

/** PAGE-p32-007。 */
export const removeMemberFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(membershipRefSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/removeMember"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    await module.removeMember({
      container,
      input: {
        workspaceId: data.workspaceId,
        actorUserId: user.userId,
        membershipId: data.membershipId,
      },
    });
    return { removed: true };
  });

/**
 * PAGE-p32-008。脱退するとこの文脈はもう開けないので、引き継ぎ Cookie を
 * 個人へ戻すのもこの応答の仕事になる（削除と同じ扱い）。
 */
export const leaveWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceRefSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }, scopeCookie] =
      await Promise.all([
        loadServerDeps(
          () => import("@repo/core/application/workspace/leaveWorkspace"),
        ),
        import("@/presentation/session"),
        import("@/presentation/scopeCookie"),
      ]);
    const user = await requireSession();
    await module.leaveWorkspace({
      container,
      input: { workspaceId: data.workspaceId, userId: user.userId },
    });
    scopeCookie.clearScopeSelection();
    return { left: true };
  });
