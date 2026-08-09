import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";
import { signUpSchema } from "../schema";

/**
 * P-01 サインアップ送信（JSON POST — CSRF 規律の既定形）。応答は登録済み
 * メールでも同一（usecase 側で保証）。セッションは発行しない — メール確認
 * が先。
 */
export const signUpFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .inputValidator(validateInput(signUpSchema))
  .handler(async ({ data }) => {
    const { container, module } = await loadServerDeps(
      () => import("@repo/core/application/identity/signUpWithPassword"),
    );
    const view = await module.signUpWithPassword({
      container,
      input: {
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        termsAccepted: data.termsAccepted,
      },
    });
    return { emailVerificationRequired: view.emailVerificationRequired };
  });
