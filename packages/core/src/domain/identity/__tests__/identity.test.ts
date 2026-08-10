import { isBusinessRuleError } from "@repo/core/domain/error";
import { describe, expect, it } from "vitest";
import { AuthToken } from "../authToken";
import { IdentityErrorCode } from "../errorCode";
import { Identity } from "../identity";
import { Session } from "../session";
import { PasswordHash, TokenHash, UserId } from "../valueObject";

const T0 = new Date(0);
const at = (ms: number) => new Date(ms);
const userId = UserId.create("u1");
const hash = PasswordHash.create("hashed");
const tokenHash = TokenHash.create("th");

describe("Identity.createPassword", () => {
  it("creates a password identity and emits identity.added(kind: password)", () => {
    const { entity, eventDrafts } = Identity.createPassword(
      { id: "i1", userId, passwordHash: hash },
      T0,
    );
    expect(entity.kind).toBe("password");
    expect(entity.version).toBe(0);
    expect(eventDrafts[0]?.type).toBe("identity.identity.added");
    expect(eventDrafts[0]?.payload).toMatchObject({ kind: "password" });
  });
});

describe("Identity.createOAuth", () => {
  it("creates an oauth identity with normalized provider email", () => {
    const { entity } = Identity.createOAuth(
      {
        id: "i2",
        userId,
        provider: "google",
        providerAccountId: "g-123",
        providerEmail: "User@Example.com",
      },
      T0,
    );
    expect(entity.kind).toBe("oauth");
    if (entity.kind === "oauth") {
      expect(entity.providerEmail).toBe("user@example.com");
    }
  });

  it("rejects an empty providerAccountId", () => {
    try {
      Identity.createOAuth(
        {
          id: "i2",
          userId,
          provider: "google",
          providerAccountId: "  ",
          providerEmail: "a@example.com",
        },
        T0,
      );
      expect.unreachable();
    } catch (error) {
      expect(isBusinessRuleError(error)).toBe(true);
      if (isBusinessRuleError(error)) {
        expect(error.code).toBe(IdentityErrorCode.InvalidProviderAccount);
      }
    }
  });
});

describe("Identity.changePassword", () => {
  it("swaps the hash, bumps the version, and emits passwordChanged", () => {
    const { entity } = Identity.createPassword(
      { id: "i1", userId, passwordHash: hash },
      T0,
    );
    const next = Identity.changePassword(
      entity,
      PasswordHash.create("hashed2"),
      at(1),
    );
    expect(next.entity.passwordHash).toBe("hashed2");
    expect(next.entity.version).toBe(1);
    expect(next.eventDrafts[0]?.type).toBe("identity.identity.passwordChanged");
  });
});

describe("Session", () => {
  it("creates with a 30-day absolute expiry and no events", () => {
    const session = Session.create(
      { id: "s1", userId, tokenHash, authEpoch: 1 },
      T0,
    );
    expect(session.expiresAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(session.authEpoch).toBe(1);
  });

  it("isExpired is inclusive at the boundary", () => {
    const session = Session.create(
      { id: "s1", userId, tokenHash, authEpoch: 0 },
      T0,
    );
    expect(Session.isExpired(session, at(Session.ttlMs - 1))).toBe(false);
    expect(Session.isExpired(session, at(Session.ttlMs))).toBe(true);
  });
});

describe("AuthToken", () => {
  it("derives the expiry from the purpose TTL", () => {
    const verification = AuthToken.issue(
      {
        id: "t1",
        userId,
        purpose: "email_verification",
        tokenHash,
        authEpoch: 0,
      },
      T0,
    );
    expect(verification.expiresAt.getTime()).toBe(24 * 60 * 60 * 1000);
    const reset = AuthToken.issue(
      { id: "t2", userId, purpose: "password_reset", tokenHash, authEpoch: 0 },
      T0,
    );
    expect(reset.expiresAt.getTime()).toBe(60 * 60 * 1000);
  });

  it("consume marks the token consumed at `now`", () => {
    const token = AuthToken.issue(
      {
        id: "t1",
        userId,
        purpose: "email_verification",
        tokenHash,
        authEpoch: 0,
      },
      T0,
    );
    const consumed = AuthToken.consume(token, at(1000));
    expect(consumed.status).toBe("consumed");
    expect(consumed.consumedAt).toEqual(at(1000));
  });

  it("consume throws TokenExpired at and after the expiry instant", () => {
    const token = AuthToken.issue(
      {
        id: "t1",
        userId,
        purpose: "password_reset",
        tokenHash,
        authEpoch: 0,
      },
      T0,
    );
    try {
      AuthToken.consume(token, at(60 * 60 * 1000));
      expect.unreachable();
    } catch (error) {
      expect(isBusinessRuleError(error)).toBe(true);
      if (isBusinessRuleError(error)) {
        expect(error.code).toBe(IdentityErrorCode.TokenExpired);
      }
    }
  });
});
