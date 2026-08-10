import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";
import { shouldIssueVerificationSession } from "@/presentation/verificationSession";
import { verifyEmailSchema } from "../schema";

/**
 * P-03 メール確認のトークン消費。GET 描画から分離した POST（ADR-007）:
 * 単回消費トークンを状態変更 GET で消費しない。使用済みトークンの再訪
 * （`alreadyVerified`）はセッションを発行しない。
 *
 * セッション Cookie は「確認を要求したブラウザー」にのみ焼く
 * （ADR-038）: `signUpFn` が残した確認待ち Cookie の `userId` が
 * トークンの持ち主と一致することが条件で、一致しなければ確認自体は
 * 成立させたうえでセッションを出さない。これがないと、攻撃者が自分の
 * 確認リンクを被害者に踏ませるだけで被害者のブラウザーに攻撃者の
 * セッションが焼ける（login CSRF）。
 */
export const verifyEmailFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(verifyEmailSchema))
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
    const signedIn = shouldIssueVerificationSession(
      session.readPendingVerificationUserId(),
      view,
    );
    if (signedIn) {
      session.setSessionCookie(
        view.sessionToken,
        session.sessionCookieExpiry(container.clock.now()),
      );
      session.clearPendingVerificationCookie();
    }
    return { alreadyVerified: view.alreadyVerified, signedIn };
  });
