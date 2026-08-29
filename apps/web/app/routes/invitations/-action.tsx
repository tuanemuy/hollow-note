import { createServerFn } from "@tanstack/react-start";
import { invitationTokenSchema } from "@/components/workspace/schema";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

/**
 * P-06 招待の確認（`/invitations/:token`）の server function 置き場。
 *
 * トークンは URL のパスから来る**外部入力**なので、どちらの関数も
 * `invitationTokenSchema` で転送境界を閉じる（形と DoS 上限のみ。
 * 本物かどうかはハッシュ照合が決める）。
 */

/**
 * PAGE-p06-002。未サインインでも読める — 参加の条件を先に示し、
 * セッションを求めるのは受諾の時点だけ（WS-04）。
 *
 * 閲覧者のメールアドレスは招待先との照合にだけ使い、断片の中で消費する。
 * クライアントへ渡すのは一致したかどうかだけ（`InvitationPreview`）。
 */
export const renderInvitationPreview = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(invitationTokenSchema))
  .handler(async ({ data }) => {
    const [{ InvitationPreview }, { sessionUserOrNull }] = await Promise.all([
      import("@/components/workspace/InvitationPreview"),
      import("@/presentation/session"),
    ]);
    const user = await sessionUserOrNull();
    return {
      InvitationPreview: renderServerFragment(() =>
        InvitationPreview({
          token: data.token,
          viewer:
            user === null ? null : { userId: user.userId, email: user.email },
        }),
      ),
    };
  });

/**
 * PAGE-p06-003。参加した文脈をそのまま表示中のスコープにするので、
 * 次回訪問の引き継ぎ Cookie もこの応答で書く（作成と同じ扱い）。
 */
export const acceptInvitationFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(invitationTokenSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }, scopeCookie] =
      await Promise.all([
        loadServerDeps(
          () => import("@repo/core/application/workspace/acceptInvitation"),
        ),
        import("@/presentation/session"),
        import("@/presentation/scopeCookie"),
      ]);
    const user = await requireSession();
    const view = await module.acceptInvitation({
      container,
      input: { token: data.token, userId: user.userId },
    });
    scopeCookie.writeScopeSelection({
      kind: "workspace",
      workspaceId: view.workspaceId,
    });
    return view;
  });
