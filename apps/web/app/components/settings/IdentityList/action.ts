import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

/** P-22 の一覧読み出し（UC-identity-016）。 */
export const loadIdentities = cache(
  serverData(
    () => import("@repo/core/application/identity/listIdentities"),
    ({ container }, { listIdentities }, userId: string) =>
      listIdentities({ container, input: { userId } }),
  ),
);
