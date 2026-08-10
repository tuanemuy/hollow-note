import { Session } from "@repo/core/domain/identity/session";
import { AuthTokenPurpose } from "@repo/core/domain/identity/valueObject";
import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";
import { loadServerDeps } from "./serverAction";

/**
 * Session-cookie transport (spec/presentation/index.md 資格情報の運搬).
 *
 * Server-only module: import it dynamically from server-function handlers
 * and RSC data loaders so `@tanstack/react-start/server` never enters a
 * client graph.
 *
 * Attributes: `HttpOnly` / `SameSite=Lax` / `Path=/`, `Secure` outside
 * dev (the spec mandates it unconditionally; dev over plain http is the
 * one accepted degradation), no `Domain`, and `Expires` = the session's
 * server-side expiry so the cookie never outlives the row.
 */
const SESSION_COOKIE_NAME = "hollow_session";

/**
 * Marks the browser that asked for a verification mail (ADR-038). The
 * value is the `userId` the sign-up response projected; `verifyEmail`
 * only issues a session when it matches the token's owner, so following
 * somebody else's verification link can never sign the visitor in.
 */
const PENDING_VERIFICATION_COOKIE_NAME = "hollow_pending_verification";

const isProduction = (): boolean => process.env.NODE_ENV === "production";

export function readSessionToken(): string | null {
  const value = getCookie(SESSION_COOKIE_NAME);
  return value !== undefined && value !== "" ? value : null;
}

export function setSessionCookie(token: string, expiresAt: Date): void {
  setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    expires: expiresAt,
  });
}

export function clearSessionCookie(): void {
  deleteCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
  });
}

export function readPendingVerificationUserId(): string | null {
  const value = getCookie(PENDING_VERIFICATION_COOKIE_NAME);
  return value !== undefined && value !== "" ? value : null;
}

/**
 * Written on **every** sign-up response, including the one a duplicate
 * e-mail gets: `SignUpView.userId` is a decoy there, so an unconditional
 * write keeps the cookie's presence and shape from becoming a user
 * enumeration oracle.
 */
export function setPendingVerificationCookie(userId: string, now: Date): void {
  setCookie(PENDING_VERIFICATION_COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
    expires: new Date(
      now.getTime() + AuthTokenPurpose.ttlMs("email_verification"),
    ),
  });
}

export function clearPendingVerificationCookie(): void {
  deleteCookie(PENDING_VERIFICATION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isProduction(),
  });
}

/**
 * The usecase views expose `sessionToken` but not the row's `expiresAt`,
 * so the cookie expiry is re-derived from the same domain constant. The
 * sub-second skew against the row only ever makes the cookie the earlier
 * of the two.
 */
export function sessionCookieExpiry(now: Date): Date {
  return new Date(now.getTime() + Session.ttlMs);
}

/**
 * Resolves the authenticated user behind the session cookie, or throws
 * `ValidationError("UNAUTHENTICATED")` (→ 401 at the boundary). Purely
 * read-only: an invalid cookie is left in place — clearing it here would
 * make a GET path mutate auth state (spec/presentation/index.md CSRF 規約).
 */
export async function requireSession() {
  const token = readSessionToken();
  const { container, module } = await loadServerDeps(
    () => import("@repo/core/application/identity/authenticateSession"),
  );
  if (token === null) {
    const { ValidationError } = await import("@repo/core/application/errors");
    throw new ValidationError("UNAUTHENTICATED", "Not authenticated");
  }
  return module.authenticateSession({
    container,
    input: { sessionToken: token },
  });
}

/** Like {@link requireSession} but resolves to `null` when unauthenticated. */
export async function sessionUserOrNull() {
  try {
    return await requireSession();
  } catch (error) {
    const { isApplicationError } = await import(
      "@repo/core/application/errors"
    );
    if (isApplicationError(error) && error.code === "UNAUTHENTICATED") {
      return null;
    }
    throw error;
  }
}
