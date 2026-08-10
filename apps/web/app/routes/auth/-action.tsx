import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";

const startSchema = z.object({
  provider: z.string().min(1).max(32),
  redirectTo: z.string().max(2048).nullable(),
});

/**
 * P-01 / P-02 の「Google で続ける」。intent は `signIn` に固定する —
 * 認証済み利用者への追加（`linkIdentity`）は要求条件が違うので、転送
 * 境界でも別の入口に分ける（P-22 の追加導線が自分の server function を
 * 持つ）。
 */
export const startOAuthSignInFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(startSchema))
  .handler(async ({ data }) => {
    const { container, module } = await loadServerDeps(
      () => import("@repo/core/application/identity/startOAuthFlow"),
    );
    const view = await module.startOAuthFlow({
      container,
      input: {
        provider: data.provider,
        intent: "signIn",
        redirectTo: data.redirectTo,
      },
    });
    return { authorizationUrl: view.authorizationUrl };
  });

const callbackSchema = z.object({
  provider: z.string().min(1).max(32),
  state: z.string().min(1).max(512),
  code: z.string().min(1).max(4096),
});

/**
 * P-05 のコールバック消費（JSON POST）。分岐根拠は `state` の intent
 * だけで、パスの `:provider` は照合にしか使わない（ADR-007）。成功時は
 * ここでセッション Cookie を焼く — `Set-Cookie` はこの応答にしか
 * 載せられない。
 */
export const completeOAuthCallbackFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(callbackSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, session] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/completeOAuthCallback"),
      ),
      import("@/presentation/session"),
    ]);
    const view = await module.completeOAuthCallback({
      container,
      input: { provider: data.provider, state: data.state, code: data.code },
    });
    session.setSessionCookie(
      view.sessionToken,
      session.sessionCookieExpiry(container.clock.now()),
    );
    // The pending-verification marker belongs to the password sign-up
    // flow; an OAuth account is verified by the provider, so leaving it
    // behind would send a later visit back to the verification screen.
    session.clearPendingVerificationCookie();
    return { redirectTo: view.redirectTo, created: view.created };
  });
