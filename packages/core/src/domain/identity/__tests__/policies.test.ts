import { isBusinessRuleError } from "@repo/core/domain/error";
import { describe, expect, it } from "vitest";
import { IdentityErrorCode } from "../errorCode";
import { Identity } from "../identity";
import { AccountDeletionRetryPolicy } from "../services/accountDeletionRetryPolicy";
import { AccountLinkingPolicy } from "../services/accountLinkingPolicy";
import { IdentityPolicy } from "../services/identityPolicy";
import { SameOriginPolicy } from "../services/sameOriginPolicy";
import { User } from "../user";
import { AvatarUrl, PasswordHash, UserId } from "../valueObject";

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

/**
 * `null` means the call was admitted. Anything other than a
 * `BusinessRuleError` is rethrown so the admitted side of a boundary
 * cannot pass by failing in some unrelated way.
 */
const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    if (!isBusinessRuleError(error)) {
      throw error;
    }
    return error.code;
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

  it("isRemovable opens removal exactly where ensureRemovable admits it", () => {
    const a = passwordIdentity("i1");
    const b = oauthIdentity("i2", "g-1");
    expect(IdentityPolicy.isRemovable([])).toBe(false);
    expect(IdentityPolicy.isRemovable([a])).toBe(false);
    expect(IdentityPolicy.isRemovable([a, b])).toBe(true);
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

const APP_URL = "https://app.test";

/**
 * Paths that keep a leading slash yet resolve to another origin. The
 * assertion on `new URL` is part of the test: it pins the parser behaviour
 * the predicate exists to defend against.
 */
const CROSS_ORIGIN_PATHS = [
  "//evil.test/x.png",
  "/\\evil.test/x.png",
  "/\n/evil.test/x.png",
  "/\r/evil.test/x.png",
  "/\t/evil.test/x.png",
];

describe("SameOriginPolicy.isSameOriginPath", () => {
  it("accepts app-relative paths", () => {
    for (const value of [
      "/",
      "/storage/users/u1/avatar/f1.png",
      "/notes?tag=a#b",
    ]) {
      expect(SameOriginPolicy.isSameOriginPath(value)).toBe(true);
      expect(new URL(value, APP_URL).origin).toBe(APP_URL);
    }
  });

  it("rejects the paths a leading slash does not make same-origin", () => {
    for (const value of CROSS_ORIGIN_PATHS) {
      expect(new URL(value, APP_URL).origin).toBe("https://evil.test");
      expect(SameOriginPolicy.isSameOriginPath(value)).toBe(false);
    }
  });

  it("rejects anything that is not a path", () => {
    for (const value of [
      "",
      "storage/x.png",
      "https://evil.test/x.png",
      "javascript:alert(1)",
    ]) {
      expect(SameOriginPolicy.isSameOriginPath(value)).toBe(false);
    }
  });
});

describe("AvatarUrl", () => {
  it("accepts a relative path and an absolute URL on the app origin", () => {
    expect(AvatarUrl.create("/storage/u1/avatar.png", APP_URL)).toBe(
      "/storage/u1/avatar.png",
    );
    expect(AvatarUrl.create(`${APP_URL}/storage/u1/avatar.png`, APP_URL)).toBe(
      `${APP_URL}/storage/u1/avatar.png`,
    );
  });

  it("rejects paths that resolve cross-origin", () => {
    for (const raw of CROSS_ORIGIN_PATHS) {
      expect(codeOf(() => AvatarUrl.create(raw, APP_URL))).toBe(
        IdentityErrorCode.InvalidAvatarUrl,
      );
    }
  });

  it("rejects other origins and opaque schemes", () => {
    for (const raw of [
      "https://evil.test/x.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "not a url",
      "",
    ]) {
      expect(codeOf(() => AvatarUrl.create(raw, APP_URL))).toBe(
        IdentityErrorCode.InvalidAvatarUrl,
      );
    }
  });
});

describe("AccountDeletionRetryPolicy", () => {
  // The threshold's own boundary only. Verifying it as a checklist row
  // (TC-identity-052) needs the `rejected` path, which lives in #3.
  it("admits the ninth attempt only while fewer than 8 terminal rows are retained", () => {
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
