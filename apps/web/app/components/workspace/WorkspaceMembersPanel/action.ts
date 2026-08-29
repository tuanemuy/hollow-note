import { createServerFn } from "@tanstack/react-start";
import { cache } from "react";
import { z } from "zod";
import { WORKSPACE_ID_MAX_LENGTH } from "@/components/workspace/schema";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps, serverData } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";

/**
 * P-32 の読み出し（`listMembers` / `listPendingInvitations`）。
 *
 * 2 つに分けてあるのは権限の境界が違うため — メンバー一覧はどのメンバー
 * も読めるが、保留中の招待は `manageMembers` だけが読める（未参加の
 * アドレスは名簿の一部ではない）。呼び出し側は先に前者の `canManage` を
 * 見てから後者を呼ぶ。
 */

/** どちらの一覧も 1 ページ 50 件（両ユースケースの既定と同じ）。 */
const MEMBER_PAGE_SIZE = 50;

export const loadMembers = cache(
  serverData(
    () => import("@repo/core/application/workspace/listMembers"),
    ({ container }, { listMembers }, workspaceId: string, userId: string) =>
      listMembers({
        container,
        input: { workspaceId, userId, page: 1, limit: MEMBER_PAGE_SIZE },
      }),
  ),
);

export const loadPendingInvitations = cache(
  serverData(
    () => import("@repo/core/application/workspace/listPendingInvitations"),
    (
      { container },
      { listPendingInvitations },
      workspaceId: string,
      userId: string,
    ) =>
      listPendingInvitations({
        container,
        input: { workspaceId, userId, page: 1, limit: MEMBER_PAGE_SIZE },
      }),
  ),
);

/**
 * 転送境界の DoS 上限。オフセット送りは `(page - 1) × limit` 行を読み飛ばす
 * ので、ページ番号そのものに天井を置く（業務上の上限ではない）。
 */
const MAX_PAGE = 1_000;

const memberPageSchema = z.object({
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH),
  page: z.number().int().min(1).max(MAX_PAGE),
});

/**
 * PAGE-p32-001 の「さらに読み込む」。総数は先頭ページの `count` /
 * `ownerCount` が持ち、各ミューテーションの `router.invalidate()` で
 * 更新されるので、ここは追加の行だけを返す。
 */
export const loadMoreMembersFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(memberPageSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/listMembers"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const view = await module.listMembers({
      container,
      input: {
        workspaceId: data.workspaceId,
        userId: user.userId,
        page: data.page,
        limit: MEMBER_PAGE_SIZE,
      },
    });
    return { members: view.members };
  });

/** 保留中の招待の「さらに読み込む」。{@link loadMoreMembersFn} と同じ形。 */
export const loadMorePendingInvitationsFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(memberPageSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/listPendingInvitations"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const view = await module.listPendingInvitations({
      container,
      input: {
        workspaceId: data.workspaceId,
        userId: user.userId,
        page: data.page,
        limit: MEMBER_PAGE_SIZE,
      },
    });
    return { invitations: view.invitations };
  });
