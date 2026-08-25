import type { AuthTokenRepository } from "../../../../domain/identity/ports/authTokenRepository";
import type { IdentityRepository } from "../../../../domain/identity/ports/identityRepository";
import type { LoginAttemptStore } from "../../../../domain/identity/ports/loginAttemptStore";
import type { SessionRepository } from "../../../../domain/identity/ports/sessionRepository";
import type { UserBatchReader } from "../../../../domain/identity/ports/userBatchReader";
import type { UserRepository } from "../../../../domain/identity/ports/userRepository";
import type { IdentityRemovalReceiptStore } from "../../../../application/ports/identityRemovalReceiptStore";
import type { OAuthStateStore } from "../../../../application/ports/oauthStateStore";
import { port } from "../pendingPorts";
import type { GlobalPortDeps } from "./deps";

/**
 * Step 5 — the D1 Identity bundle.
 *
 * Owner of this file wires each port by (1) deleting its name from
 * `PENDING_PORTS` and (2) passing the adapter factory as the second
 * argument of the matching `port(...)` call. Nothing outside this file
 * has to change.
 *
 * Suites: `conformance/identity.test.ts`.
 */
export type IdentityPorts = Readonly<{
  userRepository: UserRepository;
  identityRepository: IdentityRepository;
  sessionRepository: SessionRepository;
  authTokenRepository: AuthTokenRepository;
  identityRemovalReceiptStore: IdentityRemovalReceiptStore;
  userBatchReader: UserBatchReader;
  loginAttemptStore: LoginAttemptStore;
  oauthStateStore: OAuthStateStore;
}>;

export function createIdentityPorts(_deps: GlobalPortDeps): IdentityPorts {
  return {
    userRepository: port<UserRepository>("UserRepository"),
    identityRepository: port<IdentityRepository>("IdentityRepository"),
    sessionRepository: port<SessionRepository>("SessionRepository"),
    authTokenRepository: port<AuthTokenRepository>("AuthTokenRepository"),
    identityRemovalReceiptStore: port<IdentityRemovalReceiptStore>(
      "IdentityRemovalReceiptStore",
    ),
    userBatchReader: port<UserBatchReader>("UserBatchReader"),
    loginAttemptStore: port<LoginAttemptStore>("LoginAttemptStore"),
    oauthStateStore: port<OAuthStateStore>("OAuthStateStore"),
  };
}
