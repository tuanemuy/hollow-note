import type { AuthenticatedUserView } from "@repo/core/application/identity/view";
import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "./errorResponseMiddleware";

/**
 * Session probe for route guards. GET because it is purely read-only
 * (an invalid cookie is not cleared — see `presentation/session.ts`);
 * returns `null` instead of throwing so the calling guard can branch
 * without catching.
 */
export const sessionUserFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async (): Promise<AuthenticatedUserView | null> => {
    const { sessionUserOrNull } = await import("@/presentation/session");
    return sessionUserOrNull();
  });
