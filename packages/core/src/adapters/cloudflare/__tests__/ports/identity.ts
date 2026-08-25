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
import type { GlobalPortDeps } from "./deps";

/**
 * The D1 Identity bundle.
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
    userRepository: createD1UserRepository(deps),
    identityRepository: createD1IdentityRepository(deps),
    sessionRepository: createD1SessionRepository(deps),
    authTokenRepository: createD1AuthTokenRepository(deps),
    identityRemovalReceiptStore: createD1IdentityRemovalReceiptStore(deps),
    userBatchReader: createD1UserBatchReader(deps),
    loginAttemptStore: createD1LoginAttemptStore(deps),
    oauthStateStore: createD1OAuthStateStore(deps),
  };
}
