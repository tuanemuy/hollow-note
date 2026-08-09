import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";

/**
 * サインアウト glue（ADR-008）: Cookie 破棄のみの presentation 限定処理。
 * UC-identity-009（セッション行の削除）は後続スライスの正規実装に譲る。
 * JSON POST に限定する — Cookie 破棄も認証状態の変更であり、GET にすると
 * SameSite=Lax 下で外部リンクからのログアウト強制が成立してしまう。
 */
export const signOutFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const { clearSessionCookie } = await import("@/presentation/session");
    clearSessionCookie();
    return { signedOut: true };
  });
