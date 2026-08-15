import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";
import { signUpSchema } from "../schema";

/**
 * P-01 サインアップ送信（JSON POST — CSRF 規律の既定形）。応答は登録済み
 * メールでも同一（usecase 側で保証）。セッションは発行しない — メール確認
 * が先。
 *
 * 応答には確認待ち Cookie を**常に**焼く（spec/adr/029）。これが
 * `/verify-email` のセッション発行を「確認を要求したブラウザー」に束縛
 * する唯一の材料であり、条件分岐を入れると Cookie の有無そのものが
 * 利用者列挙のオラクルになる。
 */
export const signUpFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(signUpSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, session] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/signUpWithPassword"),
      ),
      import("@/presentation/session"),
    ]);
    const view = await module.signUpWithPassword({
      container,
      input: {
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        termsAccepted: data.termsAccepted,
      },
    });
    session.setPendingVerificationCookie(view.userId, container.clock.now());
    return { emailVerificationRequired: view.emailVerificationRequired };
  });
