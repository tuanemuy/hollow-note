import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/** P-24 の使用量読み出し（UC-usage-001）。 */
export const loadUsageSnapshot = cache(
  serverData(
    () => import("@repo/core/application/usage/getUsageSnapshot"),
    ({ container }, { getUsageSnapshot }, userId: string) =>
      getUsageSnapshot({ container, input: { userId } }),
  ),
);
