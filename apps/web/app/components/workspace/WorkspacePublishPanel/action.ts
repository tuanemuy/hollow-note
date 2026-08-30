import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/** P-33 の読み出し（`getWorkspacePublication`）。 */
export const loadWorkspacePublication = cache(
  serverData(
    () => import("@repo/core/application/workspace/getWorkspacePublication"),
    (
      { container },
      { getWorkspacePublication },
      workspaceId: string,
      userId: string,
    ) => getWorkspacePublication({ container, input: { workspaceId, userId } }),
  ),
);
