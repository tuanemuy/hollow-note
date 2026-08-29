import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * P-32 の読み出し（`listMembers` / `listPendingInvitations`）。
 *
 * 2 つに分けてあるのは権限の境界が違うため — メンバー一覧はどのメンバー
 * も読めるが、保留中の招待は `manageMembers` だけが読める（未参加の
 * アドレスは名簿の一部ではない）。呼び出し側は先に前者の `canManage` を
 * 見てから後者を呼ぶ。
 */
export const loadMembers = cache(
  serverData(
    () => import("@repo/core/application/workspace/listMembers"),
    ({ container }, { listMembers }, workspaceId: string, userId: string) =>
      listMembers({ container, input: { workspaceId, userId } }),
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
    ) => listPendingInvitations({ container, input: { workspaceId, userId } }),
  ),
);
