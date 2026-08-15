import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";
import { resendVerificationSchema } from "../schema";

/**
 * 確認メールの再送（P-03 状態 3・5、P-02 状態 3）。
 *
 * 応答は成否のみで、宛先が登録済みか・保留中か・発行間隔にかかったかを
 * 一切載せない（spec/adr/028-account-enumeration-resistance.md）。
 * usecase 自身も全経路で同じ空の成功を返すので、ここで潰す分岐は無い。
 */
export const resendVerificationFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(resendVerificationSchema))
  .handler(async ({ data }) => {
    const { container, module } = await loadServerDeps(
      () => import("@repo/core/application/identity/resendVerificationEmail"),
    );
    await module.resendVerificationEmail({
      container,
      input: { email: data.email },
    });
    return { requested: true };
  });
