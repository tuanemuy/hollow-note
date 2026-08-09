import { isBusinessRuleError } from "@repo/core/domain/error";
import { describe, expect, it } from "vitest";
import { IdentityErrorCode } from "../errorCode";
import {
  AuthTokenPurpose,
  Bio,
  DisplayName,
  Email,
  Handle,
  LoginAttemptKey,
  OAuthProvider,
  PlainPassword,
  TokenHash,
  UserId,
} from "../valueObject";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

describe("UserId", () => {
  it("trims and accepts a non-empty id", () => {
    expect(UserId.create(" u1 ")).toBe("u1");
  });

  it("rejects whitespace-only input", () => {
    expect(codeOf(() => UserId.create("  "))).toBe(IdentityErrorCode.InvalidId);
  });
});

describe("Email", () => {
  it("trims and lowercases", () => {
    expect(Email.create("  User@Example.COM ")).toBe("user@example.com");
  });

  it("accepts exactly 254 characters", () => {
    const local = "a".repeat(254 - "@example.com".length);
    const value = `${local}@example.com`;
    expect(value).toHaveLength(254);
    expect(Email.create(value)).toBe(value);
  });

  it("rejects 255 characters", () => {
    const local = "a".repeat(255 - "@example.com".length);
    const value = `${local}@example.com`;
    expect(value).toHaveLength(255);
    expect(codeOf(() => Email.create(value))).toBe(
      IdentityErrorCode.InvalidEmail,
    );
  });

  it.each(["", "no-at-mark", "a@", "@b", "a b@c.d"])(
    "rejects malformed address %j",
    (raw) => {
      expect(codeOf(() => Email.create(raw))).toBe(
        IdentityErrorCode.InvalidEmail,
      );
    },
  );
});

describe("Handle", () => {
  it("accepts 3-30 chars of [a-z0-9_-] with alphanumeric endpoints", () => {
    expect(Handle.create("ab-1_c")).toBe("ab-1_c");
    expect(Handle.create("abc")).toBe("abc");
    expect(Handle.create("a".repeat(30))).toBe("a".repeat(30));
  });

  it("normalizes to lowercase for comparison", () => {
    expect(Handle.create("MyHandle")).toBe("myhandle");
  });

  it.each(["ab", "a".repeat(31), "-abc", "abc-", "a b c", "abc!"])(
    "rejects invalid handle %j",
    (raw) => {
      expect(codeOf(() => Handle.create(raw))).toBe(
        IdentityErrorCode.InvalidHandle,
      );
    },
  );

  it.each(["settings", "notes", "sitemap.xml", "robots.txt", "n"])(
    "rejects reserved word %j",
    (raw) => {
      expect(codeOf(() => Handle.create(raw))).toBe(
        IdentityErrorCode.HandleReserved,
      );
    },
  );
});

describe("DisplayName", () => {
  it("trims and accepts 1-50 chars", () => {
    expect(DisplayName.create(" Alice ")).toBe("Alice");
    expect(DisplayName.create("a".repeat(50))).toBe("a".repeat(50));
  });

  it.each(["", "   ", "a".repeat(51)])("rejects %j", (raw) => {
    expect(codeOf(() => DisplayName.create(raw))).toBe(
      IdentityErrorCode.InvalidDisplayName,
    );
  });
});

describe("Bio", () => {
  it("allows the empty string and up to 500 chars", () => {
    expect(Bio.create("")).toBe("");
    expect(Bio.create("あ".repeat(500))).toBe("あ".repeat(500));
  });

  it("rejects 501 chars", () => {
    expect(codeOf(() => Bio.create("a".repeat(501)))).toBe(
      IdentityErrorCode.InvalidBio,
    );
  });
});

describe("PlainPassword", () => {
  it("accepts 8 and 128 chars containing letters and digits", () => {
    expect(PlainPassword.create("abcdefg1")).toBe("abcdefg1");
    expect(PlainPassword.create(`a1${"x".repeat(126)}`)).toHaveLength(128);
  });

  it("rejects 7 chars", () => {
    expect(codeOf(() => PlainPassword.create("abcdef1"))).toBe(
      IdentityErrorCode.WeakPassword,
    );
  });

  it("rejects 129 chars", () => {
    expect(codeOf(() => PlainPassword.create(`a1${"x".repeat(127)}`))).toBe(
      IdentityErrorCode.WeakPassword,
    );
  });

  it("rejects digits-only and letters-only", () => {
    expect(codeOf(() => PlainPassword.create("12345678"))).toBe(
      IdentityErrorCode.WeakPassword,
    );
    expect(codeOf(() => PlainPassword.create("abcdefgh"))).toBe(
      IdentityErrorCode.WeakPassword,
    );
  });
});

describe("OAuthProvider", () => {
  it("accepts google and rejects unknown providers", () => {
    expect(OAuthProvider.create("google")).toBe("google");
    expect(codeOf(() => OAuthProvider.create("github"))).toBe(
      IdentityErrorCode.InvalidProviderAccount,
    );
  });
});

describe("AuthTokenPurpose", () => {
  it("derives 24h TTL for email_verification and 1h for password_reset", () => {
    expect(AuthTokenPurpose.ttlMs("email_verification")).toBe(
      24 * 60 * 60 * 1000,
    );
    expect(AuthTokenPurpose.ttlMs("password_reset")).toBe(60 * 60 * 1000);
  });
});

describe("LoginAttemptKey", () => {
  it("builds namespaced keys for sign-in and share-password", () => {
    const email = Email.create("User@Example.com");
    expect(LoginAttemptKey.forSignIn(email, "203.0.113.9")).toBe(
      "signIn:user@example.com:203.0.113.9",
    );
    const hash = TokenHash.create("deadbeef");
    expect(LoginAttemptKey.forSharePassword(hash, "203.0.113.9")).toBe(
      "share:deadbeef:203.0.113.9",
    );
  });
});
