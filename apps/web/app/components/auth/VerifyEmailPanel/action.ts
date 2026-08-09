import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";
import { verifyEmailSchema } from "../schema";

/**
 * P-03 メール確認のトークン消費。GET 描画から分離した POST（ADR-007）:
 * 単回消費トークンを状態変更 GET で消費しない。成功経路はセッション
 * Cookie をこの応答で焼き込む。使用済みトークンの再訪
 * （`alreadyVerified`）はセッションを発行しない。
 */
export const verifyEmailFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .inputValidator(validateInput(verifyEmailSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, session] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/verifyEmail"),
      ),
      import("@/presentation/session"),
    ]);
    const view = await module.verifyEmail({
      container,
      input: { token: data.token },
    });
    if (view.sessionToken !== null) {
      session.setSessionCookie(
        view.sessionToken,
        session.sessionCookieExpiry(container.clock.now()),
      );
    }
    return {
      alreadyVerified: view.alreadyVerified,
      signedIn: view.sessionToken !== null,
    };
  });
