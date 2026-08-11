import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

/**
 * 設定画面（`/settings/*`）の server function 置き場。
 *
 * どれも「主体は Cookie のセッション」で、`userId` を要求本文で受け取ら
 * ない — 転送境界から来た値で他人の設定を触れる経路を作らないため。
 * 認証は各ハンドラーの中で `requireSession()` を通す（ルートガードは
 * リダイレクトのため、こちらは 401 を返す二重化）。
 */

const PASSWORD_MAX_LENGTH = 128;

/** P-22 の一覧フラグメント。未解決の promise を返してストリームさせる。 */
export const renderIdentityList = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ IdentityList }, { requireSession }] = await Promise.all([
      import("@/components/settings/IdentityList"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return {
      IdentityList: renderServerFragment(() =>
        IdentityList({ userId: user.userId }),
      ),
    };
  });

const addPasswordSchema = z.object({
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/** PAGE-p22-002。リスト増減なので、応答は親 island が再整合に使う。 */
export const addPasswordFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(addPasswordSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/addPasswordIdentity"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const view = await module.addPasswordIdentity({
      container,
      input: { userId: user.userId, newPassword: data.newPassword },
    });
    return { identityId: view.identityId };
  });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/**
 * PAGE-p22-003。現在のセッショントークンは Cookie から取る — クライアント
 * に持たせて送り返させると、HttpOnly の意味が無くなる。成功しても現在の
 * セッションは `refreshAuthEpoch` で新世代へ追随するので Cookie は据え置く。
 */
export const changePasswordFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(changePasswordSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, session] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/changePassword"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await session.requireSession();
    const sessionToken = session.readSessionToken();
    if (sessionToken === null) {
      const { ValidationError } = await import("@repo/core/application/errors");
      throw new ValidationError("UNAUTHENTICATED", "Not authenticated");
    }
    await module.changePassword({
      container,
      input: {
        userId: user.userId,
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        currentSessionToken: sessionToken,
      },
    });
    return { changed: true };
  });

const removeIdentitySchema = z.object({
  identityId: z.string().min(1).max(128),
});

/** PAGE-p22-005。既に削除済みの再送も receipt から成功として返る。 */
export const removeIdentityFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(removeIdentitySchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/removeIdentity"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    await module.removeIdentity({
      container,
      input: { userId: user.userId, identityId: data.identityId },
    });
    return { removed: true };
  });

const startOAuthLinkSchema = z.object({
  provider: z.string().min(1).max(32),
});

/**
 * PAGE-p22-004。intent は `linkIdentity` に固定する — サインイン開始
 * （`routes/auth/-action` の `startOAuthSignInFn`）とは認証要件が違うので、
 * 転送境界で intent をクライアントに選ばせない。
 */
export const startOAuthLinkFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(startOAuthLinkSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/startOAuthFlow"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const view = await module.startOAuthFlow({
      container,
      input: {
        provider: data.provider,
        intent: "linkIdentity",
        userId: user.userId,
        redirectTo: "/settings/auth",
      },
    });
    return { authorizationUrl: view.authorizationUrl };
  });

/** PAGE-p22-006。この端末は残るので Cookie には触れない。 */
export const signOutOtherSessionsFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ container, module }, session] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/signOutOtherSessions"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await session.requireSession();
    const sessionToken = session.readSessionToken();
    if (sessionToken === null) {
      const { ValidationError } = await import("@repo/core/application/errors");
      throw new ValidationError("UNAUTHENTICATED", "Not authenticated");
    }
    const view = await module.signOutOtherSessions({
      container,
      input: { userId: user.userId, currentSessionToken: sessionToken },
    });
    return { revocationAccepted: view.revocationAccepted };
  });
