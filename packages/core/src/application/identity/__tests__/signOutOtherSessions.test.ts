import { isValidationError } from "@repo/core/application/errors";
import { Session } from "@repo/core/domain/identity/session";
import { TokenHash, UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { authenticateSession } from "../authenticateSession";
import { authResidueCleanup } from "../authResidueCleanup";
import type { UserAuthResidueCleanupContinuedEvent } from "../continuations";
import { signInWithPassword } from "../signInWithPassword";
import { signOutOtherSessions } from "../signOutOtherSessions";
import { DEFAULT_PASSWORD, signUpVerified } from "./authFlowHelpers";

const revoke = (h: TestHarness, userId: string, currentSessionToken: string) =>
  signOutOtherSessions({
    container: h.container,
    input: { userId, currentSessionToken },
  });

const expectUnauthenticated = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error) => isValidationError(error) && error.code === "UNAUTHENTICATED",
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

const signInAgain = (h: TestHarness, clientKey: string) =>
  signInWithPassword({
    container: h.container,
    input: {
      email: "user@example.com",
      password: DEFAULT_PASSWORD,
      clientKey,
    },
  });

function plantSessions(h: TestHarness, userId: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const id = `bulk-session-${String(index).padStart(5, "0")}`;
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
}

describe("signOutOtherSessions", () => {
  it("TC-identity-242: bumps the epoch, keeps this device and invalidates the other two", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const second = await signInAgain(h, "device-2");
    const third = await signInAgain(h, "device-3");

    await expect(revoke(h, userId, sessionToken)).resolves.toEqual({
      revocationAccepted: true,
    });

    expect(h.backend.users.get(userId)?.authEpoch).toBe(1);
    // Revocation is the epoch alone — the rows are all still there.
    expect(h.backend.sessions.size).toBe(3);
    await expect(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    ).resolves.toMatchObject({ userId });
    for (const revoked of [second, third]) {
      await expectUnauthenticated(
        authenticateSession({
          container: h.container,
          input: { sessionToken: revoked.sessionToken },
        }),
      );
    }
    expect(continuations(h)).toEqual([
      { userId, authEpoch: 1, table: "sessions", deletionOperationId: null },
    ]);
  });

  it("TC-identity-243: a lone session still advances the generation and is accepted", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);

    await expect(revoke(h, userId, sessionToken)).resolves.toEqual({
      revocationAccepted: true,
    });

    expect(h.backend.users.get(userId)?.authEpoch).toBe(1);
    await expect(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    ).resolves.toMatchObject({ userId });
  });

  it("TC-identity-244: an expired current session is rejected and nothing is revoked", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    h.clock.advance(Session.ttlMs);

    await expectUnauthenticated(revoke(h, userId, sessionToken));

    expect(h.backend.users.get(userId)?.authEpoch).toBe(0);
    expect(h.backend.sessions.size).toBe(1);
  });

  it("TC-identity-245: another user's sessions are untouched", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const stranger = await signUpVerified(h, "stranger@example.com");

    await revoke(h, userId, sessionToken);

    expect(h.backend.users.get(stranger.userId)?.authEpoch).toBe(0);
    await expect(
      authenticateSession({
        container: h.container,
        input: { sessionToken: stranger.sessionToken },
      }),
    ).resolves.toMatchObject({ userId: stranger.userId });
  });

  it("TC-identity-246: 10,000 sessions are revoked by two row writes and reclaimed 100 at a time", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    plantSessions(h, userId, 10_000);

    await revoke(h, userId, sessionToken);

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

  it("rejects a token that names a different user", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const stranger = await signUpVerified(h, "stranger@example.com");

    await expectUnauthenticated(revoke(h, userId, stranger.sessionToken));

    expect(h.backend.users.get(userId)?.authEpoch).toBe(0);
  });
});
