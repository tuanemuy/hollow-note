import { isBusinessRuleError } from "@repo/core/domain/error";
import { describe, expect, it } from "vitest";
import { IdentityErrorCode } from "../errorCode";
import { Identity } from "../identity";
import { AccountDeletionRetryPolicy } from "../services/accountDeletionRetryPolicy";
import { AccountLinkingPolicy } from "../services/accountLinkingPolicy";
import { IdentityPolicy } from "../services/identityPolicy";
import { User } from "../user";
import { PasswordHash, UserId } from "../valueObject";

const T0 = new Date(0);
const userId = UserId.create("u1");

const passwordIdentity = (id: string) =>
  Identity.createPassword(
    { id, userId, passwordHash: PasswordHash.create("h") },
    T0,
  ).entity;

const oauthIdentity = (id: string, accountId: string) =>
  Identity.createOAuth(
    {
      id,
      userId,
      provider: "google",
      providerAccountId: accountId,
      providerEmail: "a@example.com",
    },
    T0,
  ).entity;

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

describe("IdentityPolicy", () => {
  it("ensureRemovable rejects removing the last identity", () => {
    const only = passwordIdentity("i1");
    expect(codeOf(() => IdentityPolicy.ensureRemovable([only], only.id))).toBe(
      IdentityErrorCode.LastIdentityCannotBeRemoved,
    );
  });

  it("ensureRemovable passes when another identity remains", () => {
    const a = passwordIdentity("i1");
    const b = oauthIdentity("i2", "g-1");
    expect(() => IdentityPolicy.ensureRemovable([a, b], a.id)).not.toThrow();
  });

  it("ensureAddable rejects at the limit of 8", () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      oauthIdentity(`i${i}`, `g-${i}`),
    );
    expect(() => IdentityPolicy.ensureAddable(seven)).not.toThrow();
    const eight = [...seven, passwordIdentity("i7")];
    expect(codeOf(() => IdentityPolicy.ensureAddable(eight))).toBe(
      IdentityErrorCode.IdentityLimitExceeded,
    );
  });

  it("ensurePasswordAddable rejects a second password identity", () => {
    expect(
      codeOf(() =>
        IdentityPolicy.ensurePasswordAddable([passwordIdentity("i1")]),
      ),
    ).toBe(IdentityErrorCode.PasswordIdentityAlreadyExists);
    expect(() =>
      IdentityPolicy.ensurePasswordAddable([oauthIdentity("i1", "g-1")]),
    ).not.toThrow();
  });

  it("findPassword extracts the password identity or null", () => {
    const pw = passwordIdentity("i1");
    const oauth = oauthIdentity("i2", "g-1");
    expect(IdentityPolicy.findPassword([oauth, pw])).toBe(pw);
    expect(IdentityPolicy.findPassword([oauth])).toBeNull();
  });
});

describe("AccountLinkingPolicy.decide", () => {
  const pending = User.create(
    { id: "u1", email: "a@example.com", displayName: "A" },
    T0,
  ).entity;
  const active = User.verifyEmail(pending, T0).entity;
  const deleting = User.beginDeletion(active, "op-1", T0);
  const deleted = User.finalizeDeletion(deleting, "op-1", T0).entity;

  it("refuses whenever the provider email is unverified", () => {
    for (const user of [null, pending, active, deleting, deleted]) {
      expect(AccountLinkingPolicy.decide(user, false)).toEqual({
        kind: "refuse",
        reason: "providerEmailUnverified",
      });
    }
  });

  it("creates a new user when nobody matches", () => {
    expect(AccountLinkingPolicy.decide(null, true)).toEqual({
      kind: "createNew",
    });
  });

  it("links to a verified active user", () => {
    expect(AccountLinkingPolicy.decide(active, true)).toEqual({
      kind: "linkToExisting",
      userId: active.id,
    });
  });

  it("refuses an unverified existing user", () => {
    expect(AccountLinkingPolicy.decide(pending, true)).toEqual({
      kind: "refuse",
      reason: "existingUserUnverified",
    });
  });

  it("refuses deleting / deleted users", () => {
    expect(AccountLinkingPolicy.decide(deleting, true)).toEqual({
      kind: "refuse",
      reason: "existingUserUnavailable",
    });
    expect(AccountLinkingPolicy.decide(deleted, true)).toEqual({
      kind: "refuse",
      reason: "existingUserUnavailable",
    });
  });
});

describe("AccountDeletionRetryPolicy", () => {
  it("TC-identity-052: admits the ninth attempt only while fewer than 8 terminal rows are retained", () => {
    expect(
      codeOf(() => AccountDeletionRetryPolicy.ensureRetryable(7)),
    ).toBeNull();
    expect(codeOf(() => AccountDeletionRetryPolicy.ensureRetryable(8))).toBe(
      IdentityErrorCode.AccountDeletionRetryLimitExceeded,
    );
    expect(codeOf(() => AccountDeletionRetryPolicy.ensureRetryable(9))).toBe(
      IdentityErrorCode.AccountDeletionRetryLimitExceeded,
    );
  });

  it("counts over a 120-day window", () => {
    const now = new Date("2026-05-01T00:00:00.000Z");
    expect(AccountDeletionRetryPolicy.windowStart(now).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});
