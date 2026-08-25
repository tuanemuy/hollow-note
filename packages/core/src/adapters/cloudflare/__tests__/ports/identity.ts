import type { IdentityRemovalReceiptStore } from "../../../../application/ports/identityRemovalReceiptStore";
import type { OAuthStateStore } from "../../../../application/ports/oauthStateStore";
import type { AuthTokenRepository } from "../../../../domain/identity/ports/authTokenRepository";
import type { IdentityRepository } from "../../../../domain/identity/ports/identityRepository";
import type { LoginAttemptStore } from "../../../../domain/identity/ports/loginAttemptStore";
import type { SessionRepository } from "../../../../domain/identity/ports/sessionRepository";
import type { UserBatchReader } from "../../../../domain/identity/ports/userBatchReader";
import type { UserRepository } from "../../../../domain/identity/ports/userRepository";
import { createD1AuthTokenRepository } from "../../d1/repositories/authTokenRepository";
import { createD1IdentityRemovalReceiptStore } from "../../d1/repositories/identityRemovalReceiptStore";
import { createD1IdentityRepository } from "../../d1/repositories/identityRepository";
import { createD1LoginAttemptStore } from "../../d1/repositories/loginAttemptStore";
import { createD1OAuthStateStore } from "../../d1/repositories/oauthStateStore";
import { createD1SessionRepository } from "../../d1/repositories/sessionRepository";
import { createD1UserBatchReader } from "../../d1/repositories/userBatchReader";
import { createD1UserRepository } from "../../d1/repositories/userRepository";
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

export function createIdentityPorts(deps: GlobalPortDeps): IdentityPorts {
  return {
    userRepository: port<UserRepository>("UserRepository", () =>
      createD1UserRepository(deps),
    ),
    identityRepository: port<IdentityRepository>("IdentityRepository", () =>
      createD1IdentityRepository(deps),
    ),
    sessionRepository: port<SessionRepository>("SessionRepository", () =>
      createD1SessionRepository(deps),
    ),
    authTokenRepository: port<AuthTokenRepository>("AuthTokenRepository", () =>
      createD1AuthTokenRepository(deps),
    ),
    identityRemovalReceiptStore: port<IdentityRemovalReceiptStore>(
      "IdentityRemovalReceiptStore",
      () => createD1IdentityRemovalReceiptStore(deps),
    ),
    userBatchReader: port<UserBatchReader>("UserBatchReader", () =>
      createD1UserBatchReader(deps),
    ),
    loginAttemptStore: port<LoginAttemptStore>("LoginAttemptStore", () =>
      createD1LoginAttemptStore(deps),
    ),
    oauthStateStore: port<OAuthStateStore>("OAuthStateStore", () =>
      createD1OAuthStateStore(deps),
    ),
  };
}
