import type { OAuthFlowState } from "@repo/core/application/ports/oauthStateStore";
import { SameOriginPolicy } from "@repo/core/domain/identity/services/sameOriginPolicy";
import { OAuthProvider, UserId } from "@repo/core/domain/identity/valueObject";
import { UnauthorizedError, ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import type { StartOAuthFlowView } from "./view";

export type StartOAuthFlowInput = Readonly<{
  provider: string;
  intent: "signIn" | "linkIdentity";
  redirectTo?: string | null;
  userId?: string | null;
}>;

/** Lifetime of one authorization round-trip (spec/usecases/identity.md 手順4). */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Callback route the authorization request is answered on. */
export const oauthRedirectUri = (appUrl: string, provider: string): string =>
  `${appUrl}/auth/callback/${provider}`;

/**
 * Builds the authorization URL for a sign-in or identity-link flow and
 * parks the `state` / `codeVerifier` for the callback
 * (UC-identity-005, spec/usecases/identity.md#startoauthflow).
 *
 * The `state` row is the only carrier of the flow's intent: the callback
 * decides which usecase to run from it alone (ADR-007), so a
 * `linkIdentity` flow records the authenticated user and the epoch it
 * started under, and a `signIn` flow records neither.
 */
export async function startOAuthFlow({
  container,
  input,
}: ServiceArgs<StartOAuthFlowInput>): Promise<StartOAuthFlowView> {
  const {
    config,
    userReader,
    secureTokenGenerator,
    signInOAuthClient,
    oauthStateStore,
  } = container;

  const provider = OAuthProvider.create(input.provider);
  const redirectTo = input.redirectTo ?? null;
  // `redirectTo` is replayed as a browser navigation once the flow returns.
  if (redirectTo !== null && !SameOriginPolicy.isSameOriginPath(redirectTo)) {
    throw new ValidationError(
      "INVALID_REDIRECT",
      "redirectTo must be a same-origin path",
    );
  }

  let userId: UserId | null = null;
  let userAuthEpoch: number | null = null;
  if (input.intent === "linkIdentity") {
    if (input.userId === null || input.userId === undefined) {
      throw new ValidationError(
        "USER_REQUIRED",
        "linkIdentity requires an authenticated user",
      );
    }
    const candidate = UserId.create(input.userId);
    const versioned = await userReader.findById(candidate);
    // A user who has started deletion is no longer an authenticated
    // principal, so no state row is created for them at all.
    if (versioned === null || versioned.entity.status !== "active") {
      throw new UnauthorizedError("UNAUTHENTICATED", "Not authenticated");
    }
    userId = candidate;
    userAuthEpoch = versioned.entity.authEpoch;
  }

  const state = secureTokenGenerator.issue();
  const codeVerifier = secureTokenGenerator.issue();
  const flowState: OAuthFlowState = {
    provider,
    codeVerifier: codeVerifier.token,
    redirectTo,
    intent: input.intent,
    userId,
    userAuthEpoch,
  };
  await oauthStateStore.put(state.token, flowState, OAUTH_STATE_TTL_MS);

  return {
    state: state.token,
    authorizationUrl: signInOAuthClient.buildAuthorizationUrl({
      provider,
      state: state.token,
      codeChallenge: signInOAuthClient.deriveCodeChallenge(codeVerifier.token),
      redirectUri: oauthRedirectUri(config.appUrl, provider),
    }),
  };
}
