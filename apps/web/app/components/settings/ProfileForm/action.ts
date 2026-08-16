import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/** P-21 の初期値読み出し（UC-identity-022）。 */
export const loadProfile = cache(
  serverData(
    () => import("@repo/core/application/identity/getProfile"),
    ({ container }, { getProfile }, userId: string) =>
      getProfile({ container, input: { userId } }),
  ),
);
