import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { validateInput } from "@/presentation/validator";

/**
 * dev IdP の同意画面（ADR-021）を支える 2 本。`OAUTH_DEV_MODE` の判定は
 * composition root が `RequestContainer.oauthDevMode` として供給する値を
 * 読むだけで、ここでも画面側でも env を直読みしない。
 */
export const loadDevOAuthModeFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const { getContainer } = await import(
      "@repo/core/application/di/containerStore"
    );
    const container = await getContainer();
    return { enabled: container.oauthDevMode };
  });

const consentSchema = z.object({
  redirectUri: z.string().min(1).max(2048),
  state: z.string().min(1).max(512),
  codeChallenge: z.string().min(1).max(512),
  decision: z.enum(["approve", "deny"]),
  email: z.string().max(254),
  displayName: z.string().max(50),
  emailVerified: z.boolean(),
});

/**
 * 同意画面の「許可する」「キャンセル」。応答は遷移先だけを返し、実際の
 * 遷移はクライアント側のフル遷移で行う（外部 IdP からの復帰と同じ形に
 * するため）。承認コードは dev アダプターが復号できる自己完結トークン。
 */
export const submitDevConsentFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(consentSchema))
  .handler(async ({ data }) => {
    const [{ getContainer }, devClient, redirects, errors] = await Promise.all([
      import("@repo/core/application/di/containerStore"),
      import("@repo/core/adapters/oauth/devSignInOAuthClient"),
      import("@/presentation/devOAuth"),
      import("@repo/core/application/errors"),
    ]);
    const container = await getContainer();
    if (!container.oauthDevMode) {
      throw new errors.NotFoundError(
        "NOT_FOUND",
        "Dev identity provider is off",
      );
    }
    const appUrl = container.config.appUrl;
    if (data.decision === "deny") {
      return {
        location: redirects.devDenialRedirect({
          appUrl,
          redirectUri: data.redirectUri,
          state: data.state,
        }),
      };
    }
    const email = data.email.trim().toLowerCase();
    const displayName = data.displayName.trim();
    return {
      location: redirects.devApprovalRedirect({
        appUrl,
        redirectUri: data.redirectUri,
        state: data.state,
        code: devClient.encodeDevAuthorizationCode({
          providerAccountId: devClient.devProviderAccountId(email),
          email,
          emailVerified: data.emailVerified,
          displayName: displayName.length > 0 ? displayName : null,
          codeChallenge: data.codeChallenge,
        }),
      }),
    };
  });
