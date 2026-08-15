import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";
import { signInSchema } from "../schema";

/**
 * P-02 サインイン送信（JSON POST）。成功時はハンドラー内でセッション
 * Cookie を焼き込む — Set-Cookie はこの応答にしか載せられないため。
 * 失敗の内訳（INVALID_CREDENTIALS / EMAIL_NOT_VERIFIED / THROTTLED /
 * LOCKED / ACCOUNT_DELETING）は kind タグ + code でクライアントへ渡り、
 * 待機秒・解除時刻は `fieldErrors.waitSeconds` / `unlockAt` に載る
 * （spec/adr/028）。
 */
export const signInFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(signInSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { resolveClientKey }, session] =
      await Promise.all([
        loadServerDeps(
          () => import("@repo/core/application/identity/signInWithPassword"),
        ),
        import("@/presentation/clientKey"),
        import("@/presentation/session"),
      ]);
    const view = await module.signInWithPassword({
      container,
      input: {
        email: data.email,
        password: data.password,
        clientKey: resolveClientKey(),
      },
    });
    session.setSessionCookie(
      view.sessionToken,
      session.sessionCookieExpiry(container.clock.now()),
    );
    return { userId: view.userId };
  });
