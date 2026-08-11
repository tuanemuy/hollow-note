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

/** P-21 のフォームフラグメント。未解決の promise を返してストリームさせる。 */
export const renderProfileForm = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ ProfileForm }, { requireSession }, { getContainer }] =
      await Promise.all([
        import("@/components/settings/ProfileForm"),
        import("@/presentation/session"),
        import("@repo/core/application/di/containerStore"),
      ]);
    const [user, container] = await Promise.all([
      requireSession(),
      getContainer(),
    ]);
    return {
      ProfileForm: renderServerFragment(() =>
        ProfileForm({ userId: user.userId, appUrl: container.config.appUrl }),
      ),
    };
  });

/** P-24 の使用量フラグメント。未解決の promise を返してストリームさせる。 */
export const renderUsagePanel = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ UsagePanel }, { requireSession }] = await Promise.all([
      import("@/components/settings/UsagePanel"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return {
      UsagePanel: renderServerFragment(() =>
        UsagePanel({ userId: user.userId }),
      ),
    };
  });

const DISPLAY_NAME_MAX_LENGTH = 50;
const BIO_MAX_LENGTH = 500;
const HANDLE_MAX_LENGTH = 30;
const AVATAR_URL_MAX_LENGTH = 2048;

// 転送境界の役目は形と DoS 上限だけ。表示名 50 / 自己紹介 500 /
// ハンドル 3〜30・予約語といった業務不変条件は値オブジェクトが持つ
// ので、ここで二重に書かない（CLAUDE.md「Input validation」）。
const updateProfileSchema = z.object({
  displayName: z
    .string()
    .max(DISPLAY_NAME_MAX_LENGTH + 1)
    .optional(),
  bio: z
    .string()
    .max(BIO_MAX_LENGTH + 1)
    .optional(),
  handle: z
    .string()
    .max(HANDLE_MAX_LENGTH + 1)
    .optional(),
  avatarUrl: z.string().max(AVATAR_URL_MAX_LENGTH).nullable().optional(),
});

/** PAGE-p21-001..003。表示名 / 自己紹介 / ハンドル / アイコンの保存。 */
export const updateProfileFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(updateProfileSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/updateProfile"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    // 省略されたキーは「変更しない」。`exactOptionalPropertyTypes` の
    // 下では `undefined` を渡すことと省略することが別物なので、明示的に
    // 積み直す。
    return module.updateProfile({
      container,
      input: {
        userId: user.userId,
        ...(data.displayName !== undefined
          ? { displayName: data.displayName }
          : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.handle !== undefined ? { handle: data.handle } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      },
    });
  });

const handleAvailabilitySchema = z.object({
  handle: z
    .string()
    .min(1)
    .max(HANDLE_MAX_LENGTH + 1),
});

/** P-21 のハンドル欄の目安表示。確定は保存時の予約が決める。 */
export const checkHandleAvailabilityFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(handleAvailabilitySchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/checkHandleAvailability"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.checkHandleAvailability({
      container,
      input: { userId: user.userId, handle: data.handle },
    });
  });

/**
 * 転送境界の DoS 上限。業務上の上限（5 MB）より広いのは意図的で、
 * 5〜8 MB は `UploadValidationPolicy` に届いて `FileTooLarge` として
 * 返る — 上限違反の理由をドメイン側の 1 か所に保つため。
 */
const AVATAR_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

const avatarUploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => file.size > 0 && file.size <= AVATAR_UPLOAD_MAX_BYTES),
});

/**
 * PAGE-p21-001。`storeAvatar` はバイト列を置くだけで `User` を書かない
 * ので、返った `url` を `updateProfileFn` へ渡す 2 段目が要る（ADR-016）。
 * 主体は Cookie のセッションで、`subjectId` を要求本文から取らない。
 */
export const uploadAvatarFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator((input: unknown) =>
    validateInput(avatarUploadSchema)({
      file: input instanceof FormData ? input.get("file") : undefined,
    }),
  )
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/storage/storeAvatar"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const body = new Uint8Array(await data.file.arrayBuffer());
    const view = await module.storeAvatar({
      container,
      input: {
        userId: user.userId,
        subjectType: "user",
        subjectId: user.userId,
        fileName: data.file.name,
        declaredMimeType: data.file.type,
        body,
      },
    });
    return { fileId: view.fileId, url: view.url };
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

const EMAIL_MAX_LENGTH = 254;

const deleteAccountSchema = z.object({
  confirmationEmail: z.string().max(EMAIL_MAX_LENGTH),
  // 形と DoS 上限だけ。UUID であることは `deleteAccount` が
  // `INVALID_REQUEST_ID` で判定する（重複排除の鍵としての要件なので、
  // 転送境界に写すと同じ規則が 2 か所に散る）。
  requestId: z.string().min(1).max(64),
});

/**
 * PAGE-p25-002。受理は 202 + 応答 body の status ticket（ADR-006）。
 *
 * 即時サインアウトは `Set-Cookie` によるセッション Cookie の破棄だけで
 * 済ませ、リダイレクトは返さない — 画面は P-25 に留まって ticket で
 * 進捗を追う必要があり、ここで遷移させると ticket を持つ島がその場で
 * 消える。
 */
export const deleteAccountFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(deleteAccountSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, session, ticketing, startServer] =
      await Promise.all([
        loadServerDeps(
          () => import("@repo/core/application/identity/deleteAccount/index"),
        ),
        import("@/presentation/session"),
        import("@/presentation/deletionTicket"),
        import("@tanstack/react-start/server"),
      ]);
    const user = await session.requireSession();
    const view = await module.deleteAccount({
      container,
      input: {
        type: "userRequest",
        userId: user.userId,
        confirmationEmail: data.confirmationEmail,
        requestId: data.requestId,
      },
    });
    const ticket = await ticketing.issueDeletionTicket(
      container.deletionTicketKeyRing,
      { operationId: view.operationId, now: container.clock.now() },
    );
    session.clearSessionCookie();
    startServer.setResponseStatus(202);
    return { operationId: view.operationId, status: view.status, ticket };
  });

const deletionStatusSchema = z.object({
  ticket: z.string().min(1).max(1024),
});

/**
 * PAGE-p25-003 の進捗照会。
 *
 * ここだけは `requireSession()` を通さない — 主体は削除の受理で失効した
 * セッションではなく ticket そのもので、そうでなければ「受理直後から
 * 進捗が読めない」という自己矛盾になる。読む対象の `operationId` は
 * **検証済み ticket からしか取らない**ので、要求本文で別の operation を
 * 指すことはできない（TC-identity-048）。
 */
export const getDeletionStatusFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(deletionStatusSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, ticketing] = await Promise.all([
      loadServerDeps(
        () =>
          import("@repo/core/application/identity/getAccountDeletionStatus"),
      ),
      import("@/presentation/deletionTicket"),
    ]);
    const claims = await ticketing.readDeletionTicket(
      container.deletionTicketKeyRing,
      data.ticket,
      container.clock.now(),
    );
    return module.getAccountDeletionStatus({
      container,
      input: { operationId: claims.operationId },
    });
  });
