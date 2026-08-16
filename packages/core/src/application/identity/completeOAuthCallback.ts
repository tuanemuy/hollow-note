import type { ServiceArgs } from "../types";
import {
  completeOAuthSignInForFlow,
  oauthStateInvalid,
} from "./completeOAuthSignIn";
import { linkOAuthIdentityForFlow } from "./linkOAuthIdentity";
import type { OAuthCallbackView } from "./view";

export type CompleteOAuthCallbackInput = Readonly<{
  /** Path parameter of the callback route, matched against the provider
   * stored on the flow state. */
  provider: string;
  state: string;
  code: string;
}>;

/**
 * Single entry point of `/auth/callback/:provider`, dispatching to the
 * usecase the flow was started for.
 *
 * The **only** branching evidence is `OAuthFlowState.intent`. It cannot
 * be the query string (attacker-controlled) nor the current session
 * (not guaranteed to match the flow's start), and `take` is atomic, so
 * the intent is exactly what the server decided when the flow began.
 * The route's `:provider` must agree with the stored one or the state is
 * treated as invalid.
 */
export async function completeOAuthCallback({
  container,
  input,
}: ServiceArgs<CompleteOAuthCallbackInput>): Promise<OAuthCallbackView> {
  const flow = await container.oauthStateStore.take(input.state);
  if (flow === null || flow.provider !== input.provider) {
    throw oauthStateInvalid();
  }
  switch (flow.intent) {
    case "signIn": {
      const view = await completeOAuthSignInForFlow(
        container,
        flow,
        input.code,
      );
      return { intent: "signIn", ...view };
    }
    case "linkIdentity": {
      const view = await linkOAuthIdentityForFlow(container, flow, input.code);
      return {
        intent: "linkIdentity",
        redirectTo: flow.redirectTo,
        ...view,
      };
    }
    // `integration` lands with the external-connection slice; until then
    // its states cannot have been minted by this app.
    case "integration":
      throw oauthStateInvalid();
  }
}
