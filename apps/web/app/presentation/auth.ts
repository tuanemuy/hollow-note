import type { AuthenticatedUserView } from "@repo/core/application/identity/view";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "./errorResponseMiddleware";

/**
 * Session probe for route guards. GET because it is purely read-only
 * (an invalid cookie is not cleared — see `presentation/session.ts`);
 * returns `null` instead of throwing so `beforeLoad` can branch without
 * catching.
 */
export const sessionUserFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async (): Promise<AuthenticatedUserView | null> => {
    const { sessionUserOrNull } = await import("@/presentation/session");
    return sessionUserOrNull();
  });

/**
 * Open-redirect guard: only same-origin absolute paths survive
 * (`//evil.example` and scheme-ful values fall back to `/notes`).
 */
export function safeRedirectPath(value: string | undefined | null): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  ) {
    return value;
  }
  return "/notes";
}

/**
 * `beforeLoad` guard for app routes: resolves the session user or
 * redirects to `/signin` carrying the attempted same-origin path so a
 * successful sign-in returns there.
 */
export async function requireAuthenticated(
  locationHref: string,
): Promise<AuthenticatedUserView> {
  const user = await sessionUserFn();
  if (user === null) {
    throw redirect({
      to: "/signin",
      search: { redirect: safeRedirectPath(locationHref) },
    });
  }
  return user;
}
