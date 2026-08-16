import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";
import { requestPasswordResetSchema, resetPasswordSchema } from "../schema";

/**
 * P-04 状態 1 の申請。応答は成否のみで、宛先が登録済みか・パスワード
 * 認証手段を持つか・発行間隔にかかったかを一切載せない。usecase 自身も
 * 全経路で同じ空の成功を返すので、ここで潰す分岐は無い。
 */
export const requestPasswordResetFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(requestPasswordResetSchema))
  .handler(async ({ data }) => {
    const { container, module } = await loadServerDeps(
      () => import("@repo/core/application/identity/requestPasswordReset"),
    );
    await module.requestPasswordReset({
      container,
      input: { email: data.email },
    });
    return { requested: true };
  });

/**
 * P-04 状態 3 の実行。成功時点で利用者の `authEpoch` が進み、この
 * ブラウザーのセッションも含めて全端末が失効するので、手元の Cookie も
 * ここで捨てる — 残しても認証できない値を送り続けるだけになる。
 */
export const resetPasswordFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(resetPasswordSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, session] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/resetPassword"),
      ),
      import("@/presentation/session"),
    ]);
    await module.resetPassword({
      container,
      input: { token: data.token, newPassword: data.newPassword },
    });
    session.clearSessionCookie();
    return { reset: true };
  });
