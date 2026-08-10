import { BusinessRuleError } from "@repo/core/domain/error";
import type { PasswordIdentity } from "@repo/core/domain/identity/identity";
import type { PasswordHasher } from "@repo/core/domain/identity/ports/passwordHasher";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import {
  type LoginAttempt,
  LoginThrottlePolicy,
  type ThrottleDecision,
} from "@repo/core/domain/identity/services/loginThrottlePolicy";
import { Session } from "@repo/core/domain/identity/session";
import type { User } from "@repo/core/domain/identity/user";
import {
  Email,
  LoginAttemptKey,
  type PasswordHash,
  PlainPassword,
} from "@repo/core/domain/identity/valueObject";
import type { RequestContainer } from "../di/types";
import { ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import type { SignInView } from "./view";

export type SignInWithPasswordInput = Readonly<{
  email: string;
  password: string;
  /** Client origin material for the throttle key (IP-derived). */
  clientKey: string;
}>;

const invalidCredentials = (): ValidationError =>
  new ValidationError("INVALID_CREDENTIALS", "Invalid email or password");

const throttled = (waitMs: number): ValidationError =>
  new ValidationError(
    "THROTTLED",
    "Too many failed attempts; wait before retrying",
    { waitSeconds: [String(Math.ceil(waitMs / 1000))] },
  );

const locked = (until: Date): ValidationError =>
  new ValidationError("LOCKED", "Too many failed attempts; sign-in is locked", {
    unlockAt: [until.toISOString()],
  });

// Timing equalization against user enumeration: every failure path
// that skips the real hash verification (unknown email, deleted user,
// no password identity, weak input password) performs one verify
// against a dummy hash so the response time does not reveal whether
// the email is registered — mirroring signUpWithPassword's uniform
// response. The dummy hash is derived lazily once per hasher instance;
// its verify outcome is discarded.
const DUMMY_PASSWORD = "timing-equalizer-0nly";

// Memoized per hasher instance rather than per module: the entry is
// reachable only through the hasher it was derived with, so a container
// (or a test) that swaps the port cannot inherit another one's hash.
const dummyHashes = new WeakMap<PasswordHasher, Promise<PasswordHash>>();

/**
 * Burns one verification against a throw-away hash and always resolves
 * to `false`.
 *
 * Never throws: equalization is a best-effort defence and must not be
 * able to convert a credential rejection into a system error. If it
 * could, the paths that call it (unknown email, no password identity,
 * weak input) would answer 500 while the known-email path answers 422 —
 * exactly the enumeration oracle this exists to close. A failed
 * derivation also clears the memo so one transient scrypt error cannot
 * pin a rejected promise for the hasher's lifetime.
 */
const verifyAgainstDummy = async (hasher: PasswordHasher): Promise<false> => {
  try {
    const plain = PlainPassword.create(DUMMY_PASSWORD);
    const pending = dummyHashes.get(hasher) ?? hasher.hash(plain);
    dummyHashes.set(hasher, pending);
    await hasher.verify(plain, await pending);
  } catch {
    dummyHashes.delete(hasher);
  }
  return false;
};

type VerificationOutcome =
  | Readonly<{ verified: false }>
  | Readonly<{ verified: true; user: User; identity: PasswordIdentity }>;

const NOT_VERIFIED: VerificationOutcome = { verified: false };

const rejectionFor = (decision: ThrottleDecision): ValidationError | null => {
  switch (decision.kind) {
    case "delay":
      return throttled(decision.waitMs);
    case "locked":
      return locked(decision.until);
    case "allow":
      return null;
  }
};

/**
 * Authenticates by email + password and issues a session
 * (UC-identity-004, spec/usecases/identity.md#signinwithpassword).
 *
 * Throttle choreography: `get` → `evaluate` (delay / locked reject
 * before any credential check) → on failure the atomic `recordFailure`
 * whose post-increment record is re-evaluated to upgrade the response
 * to THROTTLED / LOCKED. `login_attempts` writes never join a unit of
 * work, and a failed write is logged without changing the auth verdict.
 * The wait seconds / unlock time ride on the `fieldErrors` payload
 * (`waitSeconds` / `unlockAt`) of the thrown `ValidationError`.
 */
export async function signInWithPassword({
  container,
  input,
}: ServiceArgs<SignInWithPasswordInput>): Promise<SignInView> {
  const {
    clock,
    idGenerator,
    loginAttemptStore,
    identityUniqueDirectory,
    userReader,
    identityReader,
    passwordHasher,
    secureTokenGenerator,
    globalUnitOfWorkProvider,
  } = container;

  const email = Email.create(input.email);
  const key = LoginAttemptKey.forSignIn(email, input.clientKey);
  const now = clock.now();

  const attempt =
    (await loginAttemptStore.get(key)) ?? LoginThrottlePolicy.initial(key);
  const gate = rejectionFor(LoginThrottlePolicy.evaluate(attempt, now));
  if (gate !== null) {
    throw gate;
  }

  const userId = await identityUniqueDirectory.resolve("email", email);
  const versioned = userId !== null ? await userReader.findById(userId) : null;
  const candidate = versioned?.entity ?? null;

  // The outcome carries the user and the identity it was verified
  // against, so "verified" and "we know which credentials matched" are
  // one value instead of a boolean plus two nullable bindings.
  const outcome = await (async (): Promise<VerificationOutcome> => {
    if (candidate === null || candidate.status === "deleted") {
      return verifyAgainstDummy(passwordHasher).then(() => NOT_VERIFIED);
    }
    const identities = await identityReader.listByUserId(candidate.id);
    const passwordIdentity = IdentityPolicy.findPassword(identities);
    if (passwordIdentity === null) {
      return verifyAgainstDummy(passwordHasher).then(() => NOT_VERIFIED);
    }
    // Sign-in must not surface WeakPassword: an input that fails the
    // password rules can never match a stored hash, so it collapses to
    // the common INVALID_CREDENTIALS path (and is counted as a failure).
    let plain: PlainPassword;
    try {
      plain = PlainPassword.create(input.password);
    } catch (error) {
      if (error instanceof BusinessRuleError) {
        return verifyAgainstDummy(passwordHasher).then(() => NOT_VERIFIED);
      }
      throw error;
    }
    const matches = await passwordHasher.verify(
      plain,
      passwordIdentity.passwordHash,
    );
    return matches
      ? { verified: true, user: candidate, identity: passwordIdentity }
      : NOT_VERIFIED;
  })();

  if (!outcome.verified) {
    throw await recordAndClassifyFailure(container, key, now);
  }
  const { user, identity: matched } = outcome;
  if (user.status === "pending") {
    // Not recorded: the credentials are correct and a resend fixes it.
    throw new ValidationError("EMAIL_NOT_VERIFIED", "Email is not verified");
  }
  if (user.status === "deleting") {
    throw new ValidationError("ACCOUNT_DELETING", "Account is being deleted");
  }

  try {
    await loginAttemptStore.clear(key);
  } catch (cause) {
    container.logger.error("[signInWithPassword] clear failed", { cause });
  }

  const session = secureTokenGenerator.issueForUser(user.id);
  await globalUnitOfWorkProvider.run(async (ctx) => {
    // Credential issuance is serialized against deletion start: re-read
    // status + epoch inside the final UoW and only insert for an
    // ActiveUser under the current epoch (spec/usecases/identity.md
    // 認証資格発行と削除開始の直列化).
    const fresh = await ctx.userRepository.findById(user.id);
    if (fresh === null || fresh.entity.status !== "active") {
      throw fresh !== null && fresh.entity.status === "deleting"
        ? new ValidationError("ACCOUNT_DELETING", "Account is being deleted")
        : invalidCredentials();
    }
    // The PasswordIdentity used for verification is re-read too: if a
    // password change committed between the hash check and this UoW,
    // the identity's version moved and the old password must not mint
    // a session (spec/usecases/identity.md 認証資格発行と削除開始の直列化).
    const freshIdentities = await ctx.identityRepository.listByUserId(user.id);
    const freshPassword = IdentityPolicy.findPassword(freshIdentities);
    if (
      freshPassword === null ||
      freshPassword.id !== matched.id ||
      freshPassword.version !== matched.version
    ) {
      throw invalidCredentials();
    }
    await ctx.sessionRepository.insert(
      Session.create(
        {
          id: idGenerator.next(),
          userId: fresh.entity.id,
          tokenHash: session.hash,
          authEpoch: fresh.entity.authEpoch,
        },
        now,
      ),
    );
  });

  return { userId: user.id, sessionToken: session.token };
}

async function recordAndClassifyFailure(
  container: RequestContainer,
  key: LoginAttemptKey,
  now: Date,
): Promise<ValidationError> {
  let recorded: LoginAttempt | null = null;
  try {
    recorded = await container.loginAttemptStore.recordFailure(
      key,
      now,
      LoginThrottlePolicy.attemptTtlMs,
    );
  } catch (cause) {
    container.logger.error("[signInWithPassword] recordFailure failed", {
      cause,
    });
  }
  if (recorded !== null) {
    const next = rejectionFor(LoginThrottlePolicy.evaluate(recorded, now));
    if (next !== null) {
      return next;
    }
  }
  return invalidCredentials();
}
