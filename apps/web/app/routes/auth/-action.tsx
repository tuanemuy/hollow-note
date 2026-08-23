import type { RequestContainer } from "@repo/core/application/di/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serializeError } from "@/presentation/errorResponse";
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
    stateCookie.setOAuthStateCookie(view.stateBinding, container.clock.now());
    return { authorizationUrl: view.authorizationUrl };
  });

const abandonSchema = z.object({
  state: z.string().min(1).max(512),
});

/**
 * 消費 POST が起きずに終わった往復（プロバイダーのキャンセル・`code` の
 * 欠落）で束縛 Cookie を捨てる。捨ててよいのはユースケースがフロー行を
 * 解放できたときだけ — 無条件に捨てると単なる GET を踏ませるだけで他人の
 * 進行中フローを壊せる。`state` を伴わない往復は照合できないので、破棄
 * せず TTL に委ねる（呼ぶ側で落とす）。
 *
 * 応答は `null` に固定する。結果を返すと「この `state` と自分の Cookie が
 * 対だったか」を答える口が増えるだけで、呼び出し元は使っていない。
 *
 * 後始末の失敗はここで畳んで記録する。呼び出し元はコールバック画面の
 * loader で、投げ返すと「失敗した往復の理由」を描く画面そのものが落ちる —
 * 掃除できなかった Cookie と `state` 行は TTL が引き取る。畳む対象には
 * コンテナの取得も含める。取得自体が失敗したときは記録先の logger も無い
 * ので、記録は残らず画面だけが生き残る。
 */
export const abandonOAuthFlowFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(abandonSchema))
  .handler(async ({ data }) => {
    const stateCookie = await import("@/presentation/oauthStateCookie");
    const stateBinding = stateCookie.readOAuthStateCookie();
    if (stateBinding === null) {
      return null;
    }
    let container: RequestContainer | null = null;
    try {
      const deps = await loadServerDeps(
        () => import("@repo/core/application/identity/abandonOAuthFlow"),
      );
      container = deps.container;
      const view = await deps.module.abandonOAuthFlow({
        container,
        input: { state: data.state, stateBinding },
      });
      if (view.abandoned) {
        stateCookie.clearOAuthStateCookie();
      }
    } catch (cause) {
      container?.logger.error("Abandoning the OAuth flow failed", { cause });
    }
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
 * 束縛の照合は `state` の消費と同じ原子操作の中で起きるので、ここは
 * Cookie を運ぶだけ。Cookie が無い要求だけはユースケースを呼ぶ前に畳む。
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
      const stateBinding = stateCookie.requireOAuthStateCookie();
      let view: Awaited<ReturnType<typeof module.completeOAuthCallback>>;
      try {
        view = await module.completeOAuthCallback({
          container,
          input: {
            provider: data.provider,
            state: data.state,
            stateBinding,
            code: data.code,
          },
        });
      } catch (error) {
        // `OAUTH_STATE_INVALID` と言い切れるときだけ残す — 束縛が `state`
        // と噛み合わなかったという答えは「この Cookie はまだ進行中の別の
        // フローのもの」を意味し、捨てると踏ませるだけで他人のフローを壊せ
        // る。判らないものまで残すと消費済みの Cookie が取り残されるので、
        // それ以外は捨てる。判定を `instanceof` で書くと、動的 import でモ
        // ジュールグラフが分かれたときに取りこぼしが「捨てる」側へ倒れる。
        const serialized = serializeError(error);
        if (
          !(
            serialized.kind === "validation" &&
            serialized.code === "OAUTH_STATE_INVALID"
          )
        ) {
          stateCookie.clearOAuthStateCookie();
        }
        throw error;
      }
      stateCookie.clearOAuthStateCookie();
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
