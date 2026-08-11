import {
  isConflictError,
  isNotFoundError,
  isValidationError,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import type { PasswordIdentity } from "@repo/core/domain/identity/identity";
import { Identity } from "@repo/core/domain/identity/identity";
import { Session } from "@repo/core/domain/identity/session";
import {
  type PasswordHash,
  TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { authenticateSession } from "../authenticateSession";
import { authResidueCleanup } from "../authResidueCleanup";
import { changePassword } from "../changePassword";
import type { UserAuthResidueCleanupContinuedEvent } from "../continuations";
import { signInWithPassword } from "../signInWithPassword";
import {
  DEFAULT_PASSWORD,
  signUpVerified,
  signUpWithGoogle,
} from "./authFlowHelpers";

const NEW_PASSWORD = "changedpassword1";

const change = (
  h: TestHarness,
  input: Readonly<{
    userId: string;
    currentSessionToken: string;
    currentPassword?: string;
    newPassword?: string;
  }>,
) =>
  changePassword({
    container: h.container,
    input: {
      userId: input.userId,
      currentPassword: input.currentPassword ?? DEFAULT_PASSWORD,
      newPassword: input.newPassword ?? NEW_PASSWORD,
      currentSessionToken: input.currentSessionToken,
    },
  });

const passwordIdentityOf = (
  h: TestHarness,
  userId: string,
): PasswordIdentity => {
  const identity = h.backend.identities
    .values()
    .find(
      (row): row is PasswordIdentity =>
        row.userId === userId && row.kind === "password",
    );
  if (identity === undefined) {
    throw new Error(`no password identity for ${userId}`);
  }
  return identity;
};

const hashOf = (h: TestHarness, userId: string): PasswordHash =>
  passwordIdentityOf(h, userId).passwordHash;

const continuations = (
  h: TestHarness,
): readonly UserAuthResidueCleanupContinuedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.userAuthResidueCleanupContinued")
    .map(
      (row) => row.payload as UserAuthResidueCleanupContinuedEvent["payload"],
    );

const expectUnauthenticated = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error) => isValidationError(error) && error.code === "UNAUTHENTICATED",
  );

/** Adds `count` extra sessions for the user, all on the current epoch. */
function plantSessions(
  h: TestHarness,
  userId: string,
  count: number,
  authEpoch = 0,
): void {
  for (let index = 0; index < count; index += 1) {
    const id = `bulk-session-${String(index).padStart(5, "0")}`;
    h.backend.sessions.set(
      id,
      Session.create(
        {
          id,
          userId: UserId.create(userId),
          tokenHash: TokenHash.create(`hash-${id}`),
          authEpoch,
        },
        h.clock.now(),
      ),
    );
  }
}

describe("changePassword", () => {
  it("TC-identity-017: replaces the hash, bumps the epoch and keeps only the current session valid", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const other = await signInWithPassword({
      container: h.container,
      input: {
        email: "user@example.com",
        password: DEFAULT_PASSWORD,
        clientKey: "other-device",
      },
    });
    const before = hashOf(h, userId);

    await expect(
      change(h, { userId, currentSessionToken: sessionToken }),
    ).resolves.toEqual({});

    expect(hashOf(h, userId)).not.toBe(before);
    expect(h.backend.users.get(userId)?.authEpoch).toBe(1);
    await expect(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    ).resolves.toMatchObject({ userId });
    await expectUnauthenticated(
      authenticateSession({
        container: h.container,
        input: { sessionToken: other.sessionToken },
      }),
    );
    expect(continuations(h)).toEqual([
      { userId, authEpoch: 1, table: "sessions", deletionOperationId: null },
    ]);
  });

  it("TC-identity-018: revokes 10,000 sessions in one write and reclaims rows 100 at a time", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    plantSessions(h, userId, 10_000);

    await change(h, { userId, currentSessionToken: sessionToken });

    // The change itself touches exactly one session row (the current one).
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
    await expect(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    ).resolves.toMatchObject({ userId });
  });

  it("TC-identity-019: rejects a wrong current password and leaves the hash alone", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const before = hashOf(h, userId);

    await expect(
      change(h, {
        userId,
        currentSessionToken: sessionToken,
        currentPassword: "wrongpassword1",
      }),
    ).rejects.toSatisfy(
      (error) =>
        isValidationError(error) && error.code === "INVALID_CREDENTIALS",
    );

    expect(hashOf(h, userId)).toBe(before);
    expect(h.backend.users.get(userId)?.authEpoch).toBe(0);
  });

  it("TC-identity-020: rejects a user without a password identity", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpWithGoogle(h);

    await expect(
      change(h, { userId, currentSessionToken: sessionToken }),
    ).rejects.toSatisfy(
      (error) =>
        isNotFoundError(error) && error.code === "PASSWORD_IDENTITY_NOT_FOUND",
    );
  });

  it("TC-identity-021: rejects a new password that fails the strength rules", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const before = hashOf(h, userId);

    await expect(
      change(h, {
        userId,
        currentSessionToken: sessionToken,
        newPassword: "short",
      }),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.WeakPassword,
    );

    expect(hashOf(h, userId)).toBe(before);
  });

  it("TC-identity-022: the previous password no longer signs the user in", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    await change(h, { userId, currentSessionToken: sessionToken });

    await expect(
      signInWithPassword({
        container: h.container,
        input: {
          email: "user@example.com",
          password: DEFAULT_PASSWORD,
          clientKey: "client-1",
        },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isValidationError(error) && error.code === "INVALID_CREDENTIALS",
    );
    await expect(
      signInWithPassword({
        container: h.container,
        input: {
          email: "user@example.com",
          password: NEW_PASSWORD,
          clientKey: "client-1",
        },
      }),
    ).resolves.toMatchObject({ userId });
  });

  it("TC-identity-023: a rival update of the same identity makes the change conflict", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const identity = passwordIdentityOf(h, userId);
    const inner = h.container.globalUnitOfWorkProvider;
    const container = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: <T>(fn: Parameters<typeof inner.run<T>>[0]): Promise<T> => {
          // The rival commits its own password change between the verify
          // and this transaction, moving the identity's version.
          const rival = Identity.changePassword(
            identity,
            hashOf(h, userId),
            h.clock.now(),
          );
          h.backend.identities.set(identity.id, rival.entity);
          return inner.run(fn);
        },
      },
    };

    await expect(
      changePassword({
        container,
        input: {
          userId,
          currentPassword: DEFAULT_PASSWORD,
          newPassword: NEW_PASSWORD,
          currentSessionToken: sessionToken,
        },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(h.backend.users.get(userId)?.authEpoch).toBe(0);
  });

  it("rejects an expired current session without touching the password", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const before = hashOf(h, userId);
    h.clock.advance(Session.ttlMs);

    await expectUnauthenticated(
      change(h, { userId, currentSessionToken: sessionToken }),
    );

    expect(hashOf(h, userId)).toBe(before);
  });
});
