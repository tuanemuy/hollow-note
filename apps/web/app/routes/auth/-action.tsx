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
    const [{ container, module }, stateCookie] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/startOAuthFlow"),
      ),
      import("@/presentation/oauthStateCookie"),
    ]);
    const view = await module.startOAuthFlow({
      container,
      input: {
        provider: data.provider,
        intent: "signIn",
        redirectTo: data.redirectTo,
      },
    });
    await stateCookie.setOAuthStateCookie(view.state, container.clock.now());
    return { authorizationUrl: view.authorizationUrl };
  });

/**
 * 消費 POST が起きずに終わった往復（プロバイダーのキャンセル・`state` /
 * `code` の欠落）で束縛 Cookie を捨てる。破棄は照合と対で成立するもの
 * なので、照合に辿り着かない往復にも破棄の入口を用意する。
 */
export const abandonOAuthFlowFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const stateCookie = await import("@/presentation/oauthStateCookie");
    stateCookie.clearOAuthStateCookie();
    return null;
  });

const callbackSchema = z.object({
  provider: z.string().min(1).max(32),
  state: z.string().min(1).max(512),
  code: z.string().min(1).max(4096),
});

/**
 * P-05 のコールバック消費（JSON POST）。分岐根拠は `state` の intent
 * だけで、パスの `:provider` は照合にしか使わない。サインイン
 * のときだけここでセッション Cookie を焼く — `Set-Cookie` はこの応答に
 * しか載せられない。認証手段の追加（`linkIdentity`）は既に認証済みの
 * 要求なので Cookie に触れず、戻り先だけを返す。
 *
 * 画面が分岐できるよう、応答は intent 付きの判別共用体にする。
 *
 * `state` は消費の前にフローを開始したブラウザーへの束縛を照合する
 * （`oauthStateCookie`）。踏ませるだけで認証状態が変わる経路を作らない
 * ため、ユースケースより先に通す。
 */
export const completeOAuthCallbackFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(callbackSchema))
  .handler(
    async ({
      data,
    }): Promise<
      | { intent: "signIn"; redirectTo: string | null; created: boolean }
      | { intent: "linkIdentity"; redirectTo: string | null }
    > => {
      const [{ container, module }, session, stateCookie] = await Promise.all([
        loadServerDeps(
          () => import("@repo/core/application/identity/completeOAuthCallback"),
        ),
        import("@/presentation/session"),
        import("@/presentation/oauthStateCookie"),
      ]);
      await stateCookie.assertOAuthStateCookie(data.state);
      // 照合を通った時点で束縛の役目は終わる（この先の最初の一手が
      // `state` の単回消費なので、交換が失敗しても往復はやり直せない）。
      // 破棄をここに置くと、成功・失敗のどちらでも取り残されない。
      stateCookie.clearOAuthStateCookie();
      const view = await module.completeOAuthCallback({
        container,
        input: { provider: data.provider, state: data.state, code: data.code },
      });
      if (view.intent === "linkIdentity") {
        return { intent: "linkIdentity", redirectTo: view.redirectTo };
      }
      session.setSessionCookie(
        view.sessionToken,
        session.sessionCookieExpiry(container.clock.now()),
      );
      // The pending-verification marker belongs to the password sign-up
      // flow; an OAuth account is verified by the provider, so leaving it
      // behind would send a later visit back to the verification screen.
      session.clearPendingVerificationCookie();
      return {
        intent: "signIn",
        redirectTo: view.redirectTo,
        created: view.created,
      };
    },
  );
