import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/**
 * P-06 の読み出し（`getInvitationPreview`）。`userId` は任意で、未サイン
 * インのまま招待の内容を読む経路がある（WS-04）。
 */
export const loadInvitationPreview = cache(
  serverData(
    () => import("@repo/core/application/workspace/getInvitationPreview"),
    (
      { container },
      { getInvitationPreview },
      token: string,
      userId: string | null,
    ) => getInvitationPreview({ container, input: { token, userId } }),
  ),
);
