import { isNotFoundError } from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import type { DeletedUser } from "@repo/core/domain/identity/user";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import { authenticateSession } from "../authenticateSession";
import { verifyEmail } from "../verifyEmail";
import { overwriteUser, signUpPending } from "./authFlowHelpers";

const HOUR_MS = 60 * 60 * 1000;

// verifyEmail is glue for AC-01 (ADR-005), so coverage focuses on the
// end-to-end-critical paths of spec/testcases/identity/verifyEmail.md.
describe("verifyEmail", () => {
  it("TC-identity-294: activates the user, consumes the token, and issues a usable session", async () => {
    const h = createTestHarness();
    const { userId, verificationToken } = await signUpPending(h);

    const view = await verifyEmail({
      container: h.container,
      input: { token: verificationToken },
    });

    expect(view.userId).toBe(userId);
    expect(view.alreadyVerified).toBe(false);
    expect(view.sessionToken).not.toBeNull();
    expect(h.backend.users.get(userId)?.status).toBe("active");
    expect(h.backend.authTokens.values().map((token) => token.status)).toEqual([
      "consumed",
    ]);

    const authenticated = await authenticateSession({
      container: h.container,
      input: { sessionToken: view.sessionToken ?? "" },
    });
    expect(authenticated.userId).toBe(userId);
  });

  it("TC-identity-295: succeeds at 23h59m (expiry boundary)", async () => {
    const h = createTestHarness();
    const { verificationToken } = await signUpPending(h);
    h.clock.advance(24 * HOUR_MS - 60 * 1000);
    const view = await verifyEmail({
      container: h.container,
      input: { token: verificationToken },
    });
    expect(view.alreadyVerified).toBe(false);
  });

  it("TC-identity-296: rejects at 24h with TokenExpired and keeps the user pending", async () => {
    const h = createTestHarness();
    const { userId, verificationToken } = await signUpPending(h);
    h.clock.advance(24 * HOUR_MS);
    await expect(
      verifyEmail({
        container: h.container,
        input: { token: verificationToken },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.TokenExpired,
    );
    expect(h.backend.users.get(userId)?.status).toBe("pending");
    expect(h.backend.sessions.size).toBe(0);
  });

  it("TC-identity-297: returns alreadyVerified without a session for a consumed token", async () => {
    const h = createTestHarness();
    const { userId, verificationToken } = await signUpPending(h);
    await verifyEmail({
      container: h.container,
      input: { token: verificationToken },
    });
    const sessionsAfterFirst = h.backend.sessions.size;

    const replay = await verifyEmail({
      container: h.container,
      input: { token: verificationToken },
    });
    expect(replay).toEqual({
      userId,
      sessionToken: null,
      alreadyVerified: true,
    });
    expect(h.backend.sessions.size).toBe(sessionsAfterFirst);
  });

  it("TC-identity-298: rejects an unknown token", async () => {
    const h = createTestHarness();
    await signUpPending(h);
    const forged = `${Buffer.from("nobody", "utf8").toString("base64url")}.secret123`;
    await expect(
      verifyEmail({ container: h.container, input: { token: forged } }),
    ).rejects.toSatisfy(
      (error) =>
        isNotFoundError(error) && error.code === "AUTH_TOKEN_NOT_FOUND",
    );
  });

  it("TC-identity-299: rejects a token whose purpose is password_reset", async () => {
    const h = createTestHarness();
    const { verificationToken } = await signUpPending(h);
    const stored = h.backend.authTokens.values()[0];
    if (stored === undefined) {
      throw new Error("missing token row");
    }
    h.backend.authTokens.set(stored.id, {
      ...stored,
      purpose: "password_reset",
    });
    await expect(
      verifyEmail({
        container: h.container,
        input: { token: verificationToken },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isNotFoundError(error) && error.code === "AUTH_TOKEN_NOT_FOUND",
    );
  });

  it("TC-identity-300: rejects when the user has been deleted", async () => {
    const h = createTestHarness();
    const { userId, verificationToken } = await signUpPending(h);
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
    await expect(
      verifyEmail({
        container: h.container,
        input: { token: verificationToken },
      }),
    ).rejects.toSatisfy(
      (error) => isNotFoundError(error) && error.code === "USER_NOT_FOUND",
    );
  });

  it("TC-identity-301: rejects a stale-epoch token even though its physical row remains", async () => {
    const h = createTestHarness();
    const { userId, verificationToken } = await signUpPending(h);
    overwriteUser(h, userId, (user) => ({
      ...user,
      authEpoch: user.authEpoch + 1,
    }));
    await expect(
      verifyEmail({
        container: h.container,
        input: { token: verificationToken },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isNotFoundError(error) && error.code === "AUTH_TOKEN_NOT_FOUND",
    );
    expect(h.backend.sessions.size).toBe(0);
  });

  it("TC-identity-302 / TC-identity-303 / TC-identity-304: resolves a concurrent double-consume to one winner and one alreadyVerified", async () => {
    const h = createTestHarness();
    const { userId, verificationToken } = await signUpPending(h);

    const [a, b] = await Promise.all([
      verifyEmail({
        container: h.container,
        input: { token: verificationToken },
      }),
      verifyEmail({
        container: h.container,
        input: { token: verificationToken },
      }),
    ]);

    const winners = [a, b].filter((view) => !view.alreadyVerified);
    const losers = [a, b].filter((view) => view.alreadyVerified);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]?.sessionToken).not.toBeNull();
    expect(losers[0]?.sessionToken).toBeNull();

    // Exactly one session; the token is consumed once; user is active.
    expect(h.backend.sessions.size).toBe(1);
    expect(
      h.backend.authTokens.values().filter((t) => t.status === "consumed"),
    ).toHaveLength(1);
    expect(h.backend.users.get(userId)?.status).toBe("active");
  });
});
