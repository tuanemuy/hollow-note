import { isValidationError } from "@repo/core/application/errors";
import type { DeletedUser } from "@repo/core/domain/identity/user";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import { authenticateSession } from "../authenticateSession";
import { overwriteUser, signUpVerified } from "./authFlowHelpers";

const DAY_MS = 24 * 60 * 60 * 1000;

const expectUnauthenticated = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error) => isValidationError(error) && error.code === "UNAUTHENTICATED",
  );

describe("authenticateSession", () => {
  it("TC-identity-008: resolves a valid session to the user projection", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const view = await authenticateSession({
      container: h.container,
      input: { sessionToken },
    });
    expect(view).toEqual({
      userId,
      displayName: "Alice",
      handle: null,
      avatarUrl: null,
    });
  });

  it("TC-identity-009: never writes the session row (pure read)", async () => {
    const h = createTestHarness();
    const { sessionToken } = await signUpVerified(h);
    const before = structuredClone(h.backend.sessions.entries());
    await authenticateSession({
      container: h.container,
      input: { sessionToken },
    });
    expect(structuredClone(h.backend.sessions.entries())).toEqual(before);
  });

  it("TC-identity-010: a 29-day-old session authenticates without extending its expiry", async () => {
    const h = createTestHarness();
    const { sessionToken } = await signUpVerified(h);
    const expiresBefore = h.backend.sessions.values()[0]?.expiresAt.getTime();
    h.clock.advance(29 * DAY_MS);
    await authenticateSession({
      container: h.container,
      input: { sessionToken },
    });
    expect(h.backend.sessions.values()[0]?.expiresAt.getTime()).toBe(
      expiresBefore,
    );
  });

  it("TC-identity-011: past 30 days the session is rejected and deleted (expiresAt <= now)", async () => {
    const h = createTestHarness();
    const { sessionToken } = await signUpVerified(h);
    h.clock.advance(30 * DAY_MS);
    await expectUnauthenticated(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    );
    expect(h.backend.sessions.size).toBe(0);
  });

  it("TC-identity-012: an expired session is rejected and deleted", async () => {
    const h = createTestHarness();
    const { sessionToken } = await signUpVerified(h);
    h.clock.advance(45 * DAY_MS);
    await expectUnauthenticated(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    );
    expect(h.backend.sessions.size).toBe(0);
  });

  it("TC-identity-013: an unknown token is rejected", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const forged = `${Buffer.from(userId, "utf8").toString("base64url")}.wrongsecret`;
    await expectUnauthenticated(
      authenticateSession({
        container: h.container,
        input: { sessionToken: forged },
      }),
    );
  });

  it("TC-identity-014: a session for a deleted user is rejected", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    overwriteUser(h, userId, (user) => {
      const tombstone: DeletedUser = {
        id: user.id,
        status: "deleted",
        authEpoch: user.authEpoch,
        version: user.version,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        deletedAt: h.clock.now(),
      };
      return tombstone;
    });
    await expectUnauthenticated(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    );
  });

  it("TC-identity-015: a stale-epoch session stays rejected even if its deletion fails", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    overwriteUser(h, userId, (user) => ({
      ...user,
      authEpoch: user.authEpoch + 1,
    }));

    const failingDelete = {
      ...h.container,
      sessionReader: {
        findByTokenHash: h.container.sessionReader.findByTokenHash,
        async deleteById() {
          throw new Error("delete failed");
        },
      },
    };
    await expectUnauthenticated(
      authenticateSession({
        container: failingDelete,
        input: { sessionToken },
      }),
    );
    // The physical row remains, and authentication is still rejected.
    expect(h.backend.sessions.size).toBe(1);
    await expectUnauthenticated(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    );
  });

  it("TC-identity-016: authenticates 1ms before the expiry boundary", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const expiresAt = h.backend.sessions.values()[0]?.expiresAt;
    if (expiresAt === undefined) {
      throw new Error("missing session row");
    }
    h.clock.set(new Date(expiresAt.getTime() - 1));
    const view = await authenticateSession({
      container: h.container,
      input: { sessionToken },
    });
    expect(view.userId).toBe(userId);
  });
});
