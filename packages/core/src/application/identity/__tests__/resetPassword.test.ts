import { encodeDevAuthorizationCode } from "@repo/core/adapters/oauth/devSignInOAuthClient";
import {
  isNotFoundError,
  isValidationError,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { AuthToken } from "@repo/core/domain/identity/authToken";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import type { PasswordIdentity } from "@repo/core/domain/identity/identity";
import { Session } from "@repo/core/domain/identity/session";
import {
  type PasswordHash,
  PlainPassword,
  TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import type { RequestContainer } from "../../di/types";
import { authenticateSession } from "../authenticateSession";
import { authResidueCleanup } from "../authResidueCleanup";
import { completeOAuthSignIn } from "../completeOAuthSignIn";
import type { UserAuthResidueCleanupContinuedEvent } from "../continuations";
import { requestPasswordReset } from "../requestPasswordReset";
import { resetPassword } from "../resetPassword";
import { signInWithPassword } from "../signInWithPassword";
import { startOAuthFlow } from "../startOAuthFlow";
import {
  latestPasswordResetToken,
  markDeleting,
  overwriteUser,
  signUpVerified,
} from "./authFlowHelpers";

const MINUTE_MS = 60 * 1000;
const NEW_PASSWORD = "brandnewpw123";

const expectTokenNotFound = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error) => isNotFoundError(error) && error.code === "AUTH_TOKEN_NOT_FOUND",
  );

const reset = (h: TestHarness, token: string, newPassword = NEW_PASSWORD) =>
  resetPassword({ container: h.container, input: { token, newPassword } });

const passwordHashOf = (h: TestHarness, userId: string): PasswordHash => {
  const identity = h.backend.identities
    .values()
    .find(
      (row): row is PasswordIdentity =>
        row.userId === userId && row.kind === "password",
    );
  if (identity === undefined) {
    throw new Error(`no password identity for ${userId}`);
  }
  return identity.passwordHash;
};

const storesPassword = (
  h: TestHarness,
  userId: string,
  password: string,
): Promise<boolean> =>
  h.container.passwordHasher.verify(
    PlainPassword.create(password),
    passwordHashOf(h, userId),
  );

const continuations = (
  h: TestHarness,
): readonly UserAuthResidueCleanupContinuedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.userAuthResidueCleanupContinued")
    .map(
      (row) => row.payload as UserAuthResidueCleanupContinuedEvent["payload"],
    );

/** Signs up, verifies, and requests a reset — the happy-path preamble. */
async function withResetToken(
  h: TestHarness,
): Promise<Readonly<{ userId: string; token: string; sessionToken: string }>> {
  const { userId, sessionToken } = await signUpVerified(h);
  await requestPasswordReset({
    container: h.container,
    input: { email: "user@example.com" },
  });
  return { userId, token: latestPasswordResetToken(h), sessionToken };
}

/** Marks the live reset token consumed behind the usecase's back. */
function consumeStoredResetToken(h: TestHarness): void {
  const pending = h.backend.authTokens
    .values()
    .find(
      (row) => row.purpose === "password_reset" && row.status === "pending",
    );
  if (pending === undefined || pending.status !== "pending") {
    throw new Error("no pending reset token to consume");
  }
  h.backend.authTokens.set(
    pending.id,
    AuthToken.consume(pending, h.clock.now()),
  );
}

/** Plants a reset token for a user no `requestPasswordReset` would mail. */
async function plantResetToken(
  h: TestHarness,
  userId: string,
  authEpoch: number,
): Promise<string> {
  const issued = h.container.secureTokenGenerator.issueForUser(
    UserId.create(userId),
  );
  h.backend.authTokens.set(
    "planted-reset-token",
    AuthToken.issue(
      {
        id: "planted-reset-token",
        userId: UserId.create(userId),
        purpose: "password_reset",
        tokenHash: issued.hash,
        authEpoch,
      },
      h.clock.now(),
    ),
  );
  return issued.token;
}

describe("resetPassword", () => {
  it("TC-identity-200: replaces the hash, bumps the epoch, consumes the token and revokes every session", async () => {
    const h = createTestHarness();
    const { userId, token, sessionToken } = await withResetToken(h);
    const before = passwordHashOf(h, userId);

    await expect(reset(h, token)).resolves.toEqual({ userId });

    expect(passwordHashOf(h, userId)).not.toBe(before);
    expect(h.backend.users.get(userId)?.authEpoch).toBe(1);
    expect(
      h.backend.authTokens
        .values()
        .filter((row) => row.purpose === "password_reset")
        .map((row) => row.status),
    ).toEqual(["consumed"]);
    // Revocation is the epoch alone — the physical row still exists.
    expect(h.backend.sessions.size).toBe(1);
    await expect(
      authenticateSession({
        container: h.container,
        input: { sessionToken },
      }),
    ).rejects.toSatisfy(
      (error) => isValidationError(error) && error.code === "UNAUTHENTICATED",
    );
    expect(continuations(h)).toEqual([
      {
        userId,
        authEpoch: 1,
        table: "sessions",
        deletionOperationId: null,
      },
    ]);
  });

  it("TC-identity-201: succeeds 59 minutes after the token was issued", async () => {
    const h = createTestHarness();
    const { userId, token } = await withResetToken(h);
    h.clock.advance(59 * MINUTE_MS);

    await expect(reset(h, token)).resolves.toEqual({ userId });
  });

  it("TC-identity-202: rejects a token that is exactly 1 hour old with TokenExpired", async () => {
    const h = createTestHarness();
    const { userId, token } = await withResetToken(h);
    const before = passwordHashOf(h, userId);
    h.clock.advance(60 * MINUTE_MS);

    await expect(reset(h, token)).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.TokenExpired,
    );
    expect(passwordHashOf(h, userId)).toBe(before);
  });

  it("TC-identity-203: rejects an already consumed token", async () => {
    const h = createTestHarness();
    const { token } = await withResetToken(h);
    await reset(h, token);

    await expectTokenNotFound(reset(h, token, "anotherpassword1"));
  });

  it("TC-identity-204: rejects a token whose epoch was overtaken and leaves the password alone", async () => {
    const h = createTestHarness();
    const { userId, token } = await withResetToken(h);
    const before = passwordHashOf(h, userId);
    overwriteUser(h, userId, (user) => ({
      ...user,
      authEpoch: user.authEpoch + 1,
    }));

    await expectTokenNotFound(reset(h, token));

    expect(passwordHashOf(h, userId)).toBe(before);
  });

  it("TC-identity-205: rejects a token whose user moved to deleting and keeps it deleting", async () => {
    const h = createTestHarness();
    const { userId, token } = await withResetToken(h);
    markDeleting(h, userId);

    await expectTokenNotFound(reset(h, token));

    expect(h.backend.users.get(userId)?.status).toBe("deleting");
  });

  it("TC-identity-206: rejects an email-verification token", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const issued = h.container.secureTokenGenerator.issueForUser(
      UserId.create(userId),
    );
    h.backend.authTokens.set(
      "verification-token",
      AuthToken.issue(
        {
          id: "verification-token",
          userId: UserId.create(userId),
          purpose: "email_verification",
          tokenHash: issued.hash,
          authEpoch: 0,
        },
        h.clock.now(),
      ),
    );

    await expectTokenNotFound(reset(h, issued.token));
  });

  it("TC-identity-207: creates a password identity when the account has none", async () => {
    const h = createTestHarness();
    const { authorizationUrl } = await startOAuthFlow({
      container: h.container,
      input: { provider: "google", intent: "signIn", redirectTo: null },
    });
    const params = new URL(authorizationUrl).searchParams;
    const state = params.get("state") ?? "";
    const view = await completeOAuthSignIn({
      container: h.container,
      input: {
        state,
        code: encodeDevAuthorizationCode({
          providerAccountId: "google-account-1",
          email: "google-user@example.com",
          emailVerified: true,
          displayName: "Google User",
          codeChallenge: params.get("code_challenge") ?? "",
        }),
      },
    });
    const token = await plantResetToken(h, view.userId, 0);

    await expect(reset(h, token)).resolves.toEqual({ userId: view.userId });

    expect(await storesPassword(h, view.userId, NEW_PASSWORD)).toBe(true);
  });

  it("TC-identity-208: rejects a weak password and leaves the token pending", async () => {
    const h = createTestHarness();
    const { userId, token } = await withResetToken(h);
    const before = passwordHashOf(h, userId);

    await expect(reset(h, token, "short")).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.WeakPassword,
    );

    expect(passwordHashOf(h, userId)).toBe(before);
    expect(
      h.backend.authTokens
        .values()
        .filter((row) => row.purpose === "password_reset")
        .map((row) => row.status),
    ).toEqual(["pending"]);
  });

  it("TC-identity-209: invalidates a session opened on another device", async () => {
    const h = createTestHarness();
    const { token } = await withResetToken(h);
    const other = await signInWithPassword({
      container: h.container,
      input: {
        email: "user@example.com",
        password: "password1234",
        clientKey: "other-device",
      },
    });

    await reset(h, token);

    await expect(
      authenticateSession({
        container: h.container,
        input: { sessionToken: other.sessionToken },
      }),
    ).rejects.toSatisfy(
      (error) => isValidationError(error) && error.code === "UNAUTHENTICATED",
    );
  });

  it("TC-identity-210: revokes 10,000 sessions in one write and reclaims the rows 100 at a time", async () => {
    const h = createTestHarness();
    const { userId, token } = await withResetToken(h);
    for (let i = 0; i < 10_000; i += 1) {
      const id = `bulk-session-${String(i).padStart(5, "0")}`;
      h.backend.sessions.set(
        id,
        Session.create(
          {
            id,
            userId: UserId.create(userId),
            tokenHash: TokenHash.create(`hash-${id}`),
            authEpoch: 0,
          },
          h.clock.now(),
        ),
      );
    }

    await reset(h, token);

    // The reset itself touches no session row: revocation is the epoch.
    expect(h.backend.sessions.size).toBe(10_001);
    const [continuation] = continuations(h);
    if (continuation === undefined) {
      throw new Error("no cleanup continuation was enqueued");
    }
    await authResidueCleanup(
      {
        id: "event-1",
        type: "identity.userAuthResidueCleanupContinued",
        payload: continuation,
        occurredAt: h.clock.now(),
        aggregateId: userId,
      } as UserAuthResidueCleanupContinuedEvent,
      h.workerContainer,
    );
    expect(h.backend.sessions.size).toBe(9_901);
  });

  it("TC-identity-211: a token consumed between the read and the commit rolls the password back", async () => {
    const h = createTestHarness();
    const { userId, token } = await withResetToken(h);
    const before = passwordHashOf(h, userId);
    const inner = h.container.globalUnitOfWorkProvider;
    const container: RequestContainer = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: (fn) => {
          // The rival commits its consume — but not its epoch bump —
          // between the pending read and this transaction, so the
          // conflict lands on the token save rather than the epoch check.
          consumeStoredResetToken(h);
          return inner.run(fn);
        },
      },
    };

    await expectTokenNotFound(
      resetPassword({ container, input: { token, newPassword: NEW_PASSWORD } }),
    );

    expect(passwordHashOf(h, userId)).toBe(before);
    expect(h.backend.users.get(userId)?.authEpoch).toBe(0);
  });

  it("TC-identity-211 / TC-identity-212: one concurrent consumer wins and the loser's password is never stored", async () => {
    const h = createTestHarness();
    const { userId, token } = await withResetToken(h);
    const passwords = ["winnerpassword1", "loserpassword1"];

    const results = await Promise.allSettled(
      passwords.map((password) => reset(h, token, password)),
    );

    const winners = passwords.filter(
      (_, index) => results[index]?.status === "fulfilled",
    );
    const losers = results.filter((result) => result.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(
      losers.every(
        (result) =>
          isNotFoundError(result.reason) &&
          result.reason.code === "AUTH_TOKEN_NOT_FOUND",
      ),
    ).toBe(true);

    const winnerPassword = winners[0];
    if (winnerPassword === undefined) {
      throw new Error("no request succeeded");
    }
    expect(await storesPassword(h, userId, winnerPassword)).toBe(true);
    expect(h.backend.users.get(userId)?.authEpoch).toBe(1);
  });
});
