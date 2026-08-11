import type { SignInOAuthClient } from "../../domain/identity/ports/signInOAuthClient";
import { createDevSignInOAuthClient } from "./devSignInOAuthClient";
import {
  createGoogleSignInOAuthClient,
  type GoogleOAuthCredentials,
} from "./googleSignInOAuthClient";

/**
 * Which sign-in identity provider the process talks to. The
 * discriminated union is what makes "Google selected but no credentials"
 * unrepresentable — the composition root decides once, at boot, and
 * every consumer downstream just holds a `SignInOAuthClient`.
 */
export type OAuthRuntimeConfig =
  | Readonly<{ mode: "dev" }>
  | Readonly<{ mode: "google" } & GoogleOAuthCredentials>;

export function createSignInOAuthClient(
  config: OAuthRuntimeConfig,
  appUrl: string,
): SignInOAuthClient {
  return config.mode === "dev"
    ? createDevSignInOAuthClient({ appUrl })
    : createGoogleSignInOAuthClient(config);
}
