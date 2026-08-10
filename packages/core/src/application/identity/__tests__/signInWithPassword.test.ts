import {
  isValidationError,
  type ValidationError,
} from "@repo/core/application/errors";
import { Version } from "@repo/core/domain/common/version";
import { Identity } from "@repo/core/domain/identity/identity";
import { LoginThrottlePolicy } from "@repo/core/domain/identity/services/loginThrottlePolicy";
import type { DeletingUser } from "@repo/core/domain/identity/user";
import { User } from "@repo/core/domain/identity/user";
import {
  Email,
  LoginAttemptKey,
  TokenHash,
} from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { authenticateSession } from "../authenticateSession";
import { signInWithPassword } from "../signInWithPassword";
import {
  DEFAULT_PASSWORD,
  overwriteUser,
  signUpPending,
  signUpVerified,
} from "./authFlowHelpers";

const EMAIL = "user@example.com";
const CLIENT = "client-a";
const MINUTE_MS = 60 * 1000;

const signIn = (h: TestHarness, password: string, clientKey = CLIENT) =>
  signInWithPassword({
    container: h.container,
    input: { email: EMAIL, password, clientKey },
  });

const keyFor = (clientKey = CLIENT) =>
  LoginAttemptKey.forSignIn(Email.create(EMAIL), clientKey);

const captureValidation = async (
  promise: Promise<unknown>,
): Promise<ValidationError> => {
  try {
    await promise;
  } catch (error) {
    if (isValidationError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a ValidationError");
};

/** Container whose hasher counts `verify` calls but behaves normally. */
function countingVerify(h: TestHarness) {
  let calls = 0;
  return {
    container: {
      ...h.container,
      passwordHasher: {
        hash: h.container.passwordHasher.hash,
        verify: async (
          ...args: Parameters<typeof h.container.passwordHasher.verify>
        ) => {
          calls += 1;
          return h.container.passwordHasher.verify(...args);
        },
      },
    },
    verifyCalls: () => calls,
  };
}

async function recordFailures(
  h: TestHarness,
  count: number,
  clientKey = CLIENT,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await h.container.loginAttemptStore.recordFailure(
      keyFor(clientKey),
      h.clock.now(),
      LoginThrottlePolicy.attemptTtlMs,
    );
  }
}

describe("signInWithPassword", () => {
  it("TC-identity-213 / TC-identity-232: correct credentials issue a session and clear the failure record", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await signIn(h, "wrong-password1").catch(() => undefined);
    expect(
      (await h.container.loginAttemptStore.get(keyFor()))?.failureCount,
    ).toBe(1);

    const view = await signIn(h, DEFAULT_PASSWORD);
    expect(view.userId).toBe(userId);
    const authenticated = await authenticateSession({
      container: h.container,
      input: { sessionToken: view.sessionToken },
    });
    expect(authenticated.userId).toBe(userId);
    // TC-identity-232: clear removes the record without waiting for TTL.
    expect(await h.container.loginAttemptStore.get(keyFor())).toBeNull();
  });

  it("TC-identity-214: a wrong password fails as INVALID_CREDENTIALS and the failure is counted", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    const error = await captureValidation(signIn(h, "wrong-password1"));
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(
      (await h.container.loginAttemptStore.get(keyFor()))?.failureCount,
    ).toBe(1);
  });

  it("TC-identity-229: a stale get that loosens the verdict still has its failure counted, so the lock catches up", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    // The store is actually at the lock threshold...
    await recordFailures(h, 10);

    // ...but step 2's get returns a stale pre-lock snapshot.
    const staleGet = {
      ...h.container,
      loginAttemptStore: {
        ...h.container.loginAttemptStore,
        async get() {
          return { key: keyFor(), failureCount: 0, lastFailedAt: null };
        },
      },
    };
    const error = await captureValidation(
      signInWithPassword({
        container: staleGet,
        input: { email: EMAIL, password: "wrong-password1", clientKey: CLIENT },
      }),
    );
    // The stale get let the attempt through the gate, but step 4's
    // atomic recordFailure counted it against the authoritative store
    // and its post-increment re-evaluation locks in the same attempt.
    expect(error.code).toBe("LOCKED");
    const attempt = await h.container.loginAttemptStore.get(keyFor());
    expect(attempt?.failureCount).toBe(11);
    const followUp = await captureValidation(signIn(h, DEFAULT_PASSWORD));
    expect(followUp.code).toBe("LOCKED");
  });

  it("TC-identity-215: an unregistered email is indistinguishable from a wrong password", async () => {
    const h = createTestHarness();
    const error = await captureValidation(signIn(h, DEFAULT_PASSWORD));
    expect(error.code).toBe("INVALID_CREDENTIALS");
  });

  it("timing equalization: the unregistered and registered failure paths run the same number of hash verifications", async () => {
    const h = createTestHarness();
    await signUpVerified(h);

    // Equalization is a comparison, not an absolute: asserting only the
    // unregistered side would stay green if the registered side started
    // verifying twice, which is exactly how the oracle reopens.
    const registered = countingVerify(h);
    const registeredError = await captureValidation(
      signInWithPassword({
        container: registered.container,
        input: { email: EMAIL, password: "wrong-password1", clientKey: CLIENT },
      }),
    );
    const unknown = countingVerify(h);
    const unknownError = await captureValidation(
      signInWithPassword({
        container: unknown.container,
        input: {
          email: "nobody@example.com",
          password: "wrong-password1",
          clientKey: CLIENT,
        },
      }),
    );

    expect(registeredError.code).toBe("INVALID_CREDENTIALS");
    expect(unknownError.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.verifyCalls()).toBe(registered.verifyCalls());
    expect(unknown.verifyCalls()).toBe(1);
  });

  it("a failing dummy hash still answers INVALID_CREDENTIALS and is not memoized", async () => {
    const h = createTestHarness();
    let hashCalls = 0;
    const flaky = {
      ...h.container,
      passwordHasher: {
        hash: async (
          ...args: Parameters<typeof h.container.passwordHasher.hash>
        ) => {
          hashCalls += 1;
          if (hashCalls === 1) {
            throw new Error("scrypt could not allocate memory");
          }
          return h.container.passwordHasher.hash(...args);
        },
        verify: h.container.passwordHasher.verify,
      },
    };

    // A rejected derivation must not escape: if it did, the unregistered
    // paths would answer 500 while known emails answer 422 — the
    // enumeration oracle the equalization exists to close, pinned for
    // the hasher's lifetime by the memo.
    const first = await captureValidation(
      signInWithPassword({
        container: flaky,
        input: { email: EMAIL, password: DEFAULT_PASSWORD, clientKey: CLIENT },
      }),
    );
    expect(first.code).toBe("INVALID_CREDENTIALS");

    const second = await captureValidation(
      signInWithPassword({
        container: flaky,
        input: {
          email: EMAIL,
          password: DEFAULT_PASSWORD,
          clientKey: "client-b",
        },
      }),
    );
    expect(second.code).toBe("INVALID_CREDENTIALS");
    // The failure freed the memo slot, so the second attempt re-derived.
    expect(hashCalls).toBe(2);

    const third = await captureValidation(
      signInWithPassword({
        container: flaky,
        input: {
          email: EMAIL,
          password: DEFAULT_PASSWORD,
          clientKey: "client-c",
        },
      }),
    );
    expect(third.code).toBe("INVALID_CREDENTIALS");
    // ...and the successful derivation is memoized from then on.
    expect(hashCalls).toBe(2);
  });

  it("a password change committing between verification and the final UoW is denied by the version re-check", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const sessionsBefore = h.backend.sessions.size;
    const racing = {
      ...h.container,
      passwordHasher: {
        hash: h.container.passwordHasher.hash,
        verify: async (
          ...args: Parameters<typeof h.container.passwordHasher.verify>
        ) => {
          const result = await h.container.passwordHasher.verify(...args);
          // Simulate a concurrent changePassword committing after the
          // hash check but before the final UoW: the stored identity's
          // version moves on.
          for (const [id, identity] of h.backend.identities.entries()) {
            if (identity.userId === userId && identity.kind === "password") {
              h.backend.identities.set(id, {
                ...identity,
                version: Version.next(identity.version),
              });
            }
          }
          return result;
        },
      },
    };
    const error = await captureValidation(
      signInWithPassword({
        container: racing,
        input: { email: EMAIL, password: DEFAULT_PASSWORD, clientKey: CLIENT },
      }),
    );
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(h.backend.sessions.size).toBe(sessionsBefore);
  });

  it("TC-identity-216: a Google-only user cannot password sign-in", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    const created = User.createVerified(
      { id: "google-user", email: EMAIL, displayName: "G" },
      now,
    );
    h.backend.users.set(created.entity.id, created.entity);
    const oauth = Identity.createOAuth(
      {
        id: "google-identity",
        userId: created.entity.id,
        provider: "google",
        providerAccountId: "acct-1",
        providerEmail: EMAIL,
      },
      now,
    );
    h.backend.identities.set(oauth.entity.id, oauth.entity);
    await h.container.identityUniqueDirectory.reserve({
      kind: "email",
      normalizedKey: EMAIL,
      userId: created.entity.id,
      operationId: "seed-op",
      expiresAt: new Date(now.getTime() + MINUTE_MS),
    });
    await h.container.identityUniqueDirectory.activate("seed-op", 0);

    const error = await captureValidation(signIn(h, DEFAULT_PASSWORD));
    expect(error.code).toBe("INVALID_CREDENTIALS");
  });

  it("TC-identity-217 / TC-identity-233: a pending user with the correct password gets EMAIL_NOT_VERIFIED and no failure record", async () => {
    const h = createTestHarness();
    await signUpPending(h);
    const error = await captureValidation(signIn(h, DEFAULT_PASSWORD));
    expect(error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(h.backend.sessions.size).toBe(0);
    expect(await h.container.loginAttemptStore.get(keyFor())).toBeNull();
  });

  it("TC-identity-218 / TC-identity-228: the 3rd failure is THROTTLED with the wait seconds from the post-increment decision", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    await recordFailures(h, 2);
    h.clock.advance(2000); // past the 1s wait of failureCount=2

    const error = await captureValidation(signIn(h, "wrong-password1"));
    expect(error.code).toBe("THROTTLED");
    // Post-increment count 3 → 2^(3-2) = 2 seconds.
    expect(error.fieldErrors?.waitSeconds).toEqual(["2"]);
    expect(
      (await h.container.loginAttemptStore.get(keyFor()))?.failureCount,
    ).toBe(3);
  });

  it("TC-identity-219: the 10th failure is LOCKED with the unlock time", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    await recordFailures(h, 9);
    h.clock.advance(61 * 1000); // past the capped 60s wait

    const error = await captureValidation(signIn(h, "wrong-password1"));
    expect(error.code).toBe("LOCKED");
    const unlockAt = error.fieldErrors?.unlockAt?.[0];
    expect(unlockAt).toBe(
      new Date(
        h.clock.now().getTime() + LoginThrottlePolicy.lockDurationMs,
      ).toISOString(),
    );
  });

  it("TC-identity-220 / TC-identity-235: while locked even the correct password is rejected without any verification", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    await recordFailures(h, 10);

    let verifyCalls = 0;
    const spying = {
      ...h.container,
      passwordHasher: {
        hash: h.container.passwordHasher.hash,
        verify: async (
          ...args: Parameters<typeof h.container.passwordHasher.verify>
        ) => {
          verifyCalls += 1;
          return h.container.passwordHasher.verify(...args);
        },
      },
    };
    const error = await captureValidation(
      signInWithPassword({
        container: spying,
        input: { email: EMAIL, password: DEFAULT_PASSWORD, clientKey: CLIENT },
      }),
    );
    expect(error.code).toBe("LOCKED");
    expect(verifyCalls).toBe(0);
  });

  it("TC-identity-221: sign-in succeeds once the 15-minute lock has lapsed", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await recordFailures(h, 10);
    h.clock.advance(LoginThrottlePolicy.lockDurationMs);
    const view = await signIn(h, DEFAULT_PASSWORD);
    expect(view.userId).toBe(userId);
  });

  it("TC-identity-222: a failure right after the lock lapsed re-locks (failureCount kept at 10+)", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    await recordFailures(h, 10);
    h.clock.advance(LoginThrottlePolicy.lockDurationMs);

    const error = await captureValidation(signIn(h, "wrong-password1"));
    expect(error.code).toBe("LOCKED");
    const attempt = await h.container.loginAttemptStore.get(keyFor());
    expect(attempt?.failureCount).toBe(11);
    expect(attempt?.lastFailedAt?.getTime()).toBe(h.clock.now().getTime());
  });

  it("TC-identity-223: the throttle key is signIn:{normalized email}:{clientKey}", () => {
    const key = LoginAttemptKey.forSignIn(
      Email.create(" User@Example.COM "),
      "203.0.113.7",
    );
    expect(key).toBe("signIn:user@example.com:203.0.113.7");
  });

  it("TC-identity-224: failures from another clientKey use another row and do not lock this one", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await recordFailures(h, 10, "client-b");
    const view = await signIn(h, DEFAULT_PASSWORD, CLIENT);
    expect(view.userId).toBe(userId);
  });

  it("TC-identity-225: the share-password namespace never collides with sign-in", () => {
    const email = Email.create(EMAIL);
    const shareKey = LoginAttemptKey.forSharePassword(
      TokenHash.create("deadbeef"),
      CLIENT,
    );
    const signInKey = LoginAttemptKey.forSignIn(email, CLIENT);
    expect(shareKey.startsWith("share:")).toBe(true);
    expect(signInKey.startsWith("signIn:")).toBe(true);
    expect(shareKey).not.toBe(signInKey);
  });

  it("TC-identity-226: recordFailure runs with the 24h TTL and returns the post-increment record", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    await signIn(h, "wrong-password1").catch(() => undefined);
    const row = h.backend.loginAttempts
      .values()
      .find((candidate) => candidate.key === keyFor());
    expect(row?.failureCount).toBe(1);
    expect(row?.expiresAt.getTime()).toBe(
      h.clock.now().getTime() + LoginThrottlePolicy.attemptTtlMs,
    );
  });

  it("TC-identity-227: ten parallel failures on the same key all count (atomic increment)", async () => {
    const h = createTestHarness();
    const key = keyFor();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        h.container.loginAttemptStore.recordFailure(
          key,
          h.clock.now(),
          LoginThrottlePolicy.attemptTtlMs,
        ),
      ),
    );
    expect((await h.container.loginAttemptStore.get(key))?.failureCount).toBe(
      10,
    );
  });

  it("TC-identity-230: the record holds key / failureCount / lastFailedAt and derives the lock instead of storing it", async () => {
    const h = createTestHarness();
    await recordFailures(h, 1);
    const attempt = await h.container.loginAttemptStore.get(keyFor());
    expect(attempt).toEqual({
      key: keyFor(),
      failureCount: 1,
      lastFailedAt: h.clock.now(),
    });
    expect(attempt).not.toHaveProperty("lockedUntil");
  });

  it("TC-identity-231: the 24h record TTL outlives the 15-minute lock", () => {
    expect(LoginThrottlePolicy.attemptTtlMs).toBeGreaterThan(
      LoginThrottlePolicy.lockDurationMs,
    );
    expect(LoginThrottlePolicy.attemptTtlMs).toBe(24 * 60 * MINUTE_MS);
  });

  it("TC-identity-234: a deleting user with the correct password gets ACCOUNT_DELETING and no session", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const sessionsBefore = h.backend.sessions.size;
    overwriteUser(h, userId, (user) => {
      if (user.status !== "active") {
        throw new Error("expected an active user");
      }
      const deleting: DeletingUser = {
        ...user,
        status: "deleting",
        deletionOperationId: "op-1",
      };
      return deleting;
    });
    const error = await captureValidation(signIn(h, DEFAULT_PASSWORD));
    expect(error.code).toBe("ACCOUNT_DELETING");
    expect(h.backend.sessions.size).toBe(sessionsBefore);
  });

  it("TC-identity-236: login_attempts writes stay outside the unit of work", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    let uowRuns = 0;
    const counting = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: <T>(
          fn: Parameters<typeof h.container.globalUnitOfWorkProvider.run<T>>[0],
        ) => {
          uowRuns += 1;
          return h.container.globalUnitOfWorkProvider.run(fn);
        },
      },
    };
    await signInWithPassword({
      container: counting,
      input: { email: EMAIL, password: "wrong-password1", clientKey: CLIENT },
    }).catch(() => undefined);
    // The failure was recorded even though no transaction ever opened.
    expect(uowRuns).toBe(0);
    expect(
      (await h.container.loginAttemptStore.get(keyFor()))?.failureCount,
    ).toBe(1);
  });

  it("TC-identity-237: recordFailure / clear write failures are logged and do not change the verdict", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const failingStore = {
      ...h.container,
      loginAttemptStore: {
        ...h.container.loginAttemptStore,
        async recordFailure(): Promise<never> {
          throw new Error("store down");
        },
        async clear(): Promise<never> {
          throw new Error("store down");
        },
      },
    };
    const error = await captureValidation(
      signInWithPassword({
        container: failingStore,
        input: { email: EMAIL, password: "wrong-password1", clientKey: CLIENT },
      }),
    );
    expect(error.code).toBe("INVALID_CREDENTIALS");

    const view = await signInWithPassword({
      container: failingStore,
      input: { email: EMAIL, password: DEFAULT_PASSWORD, clientKey: CLIENT },
    });
    expect(view.userId).toBe(userId);
    expect(h.logger.byLevel("error").length).toBeGreaterThanOrEqual(2);
  });

  it("TC-identity-221 boundary detail: the post-lock wait is capped at 60 seconds", async () => {
    const h = createTestHarness();
    await signUpVerified(h);
    await recordFailures(h, 10);
    h.clock.advance(LoginThrottlePolicy.lockDurationMs);
    // Lock lapsed, but the capped 60s delay window has also passed
    // (15min >> 60s), so evaluation allows the attempt.
    const decision = LoginThrottlePolicy.evaluate(
      (await h.container.loginAttemptStore.get(keyFor())) ?? {
        key: keyFor(),
        failureCount: 0,
        lastFailedAt: null,
      },
      h.clock.now(),
    );
    expect(decision.kind).toBe("allow");
  });
});
