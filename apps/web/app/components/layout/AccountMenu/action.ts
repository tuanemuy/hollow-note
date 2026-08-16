import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";

/**
 * サインアウト（UC-identity-009）。セッション行の削除は usecase が行い、
 * Cookie の破棄はこの応答にしか載せられないのでここで行う。
 *
 * JSON POST に限定する — GET にすると SameSite=Lax 下で
 * 外部リンクからのログアウト強制が成立してしまう。Cookie が無い / 不正
 * でも usecase は成功するので、この入口は常に成功応答を返す。
 */
export const signOutFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ container, module }, session] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/identity/signOut")),
      import("@/presentation/session"),
    ]);
    const sessionToken = session.readSessionToken();
    if (sessionToken !== null) {
      await module.signOut({ container, input: { sessionToken } });
    }
    session.clearSessionCookie();
    return { signedOut: true };
  });
