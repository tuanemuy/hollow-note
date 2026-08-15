import { createHash } from "node:crypto";

/**
 * PKCE S256 challenge (RFC 7636 §4.2): `base64url(sha256(verifier))`,
 * always 43 characters and free of padding. Shared by every
 * `SignInOAuthClient` adapter — the transform is fixed by the protocol,
 * so a provider-specific variant would be a bug, not a choice.
 */
export function deriveCodeChallengeS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}
