import type { AuthenticatedUserView } from "@repo/core/application/identity/view";
import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "./errorResponseMiddleware";

/**
 * The session view as screens receive it. `AuthenticatedUserView` carries
 * the viewer's own e-mail address; the shell (name, avatar, handle) never
 * needs it, so the address stops at the server and only the code that
 * compares it with an invited address reads it there.
 */
export type ViewerView = Omit<AuthenticatedUserView, "email">;

export const toViewerView = (user: AuthenticatedUserView): ViewerView => ({
  userId: user.userId,
  displayName: user.displayName,
  handle: user.handle,
  avatarUrl: user.avatarUrl,
});

/**
 * Session probe for route guards. GET because it is purely read-only
 * (an invalid cookie is not cleared — see `presentation/session.ts`);
 * returns `null` instead of throwing so the calling guard can branch
 * without catching.
 */
export const sessionUserFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async (): Promise<ViewerView | null> => {
    const { sessionUserOrNull } = await import("@/presentation/session");
    const user = await sessionUserOrNull();
    return user === null ? null : toViewerView(user);
  });
