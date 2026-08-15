import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PlainPassword,
} from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { passwordFieldError, passwordStrength } from "../passwordStrength";

const accepted = (raw: string): boolean => {
  try {
    PlainPassword.create(raw);
    return true;
  } catch {
    return false;
  }
};

describe("passwordStrength", () => {
  it("gates on nothing but the domain rule", () => {
    const samples = [
      "",
      "short1",
      "a".repeat(PASSWORD_MIN_LENGTH),
      "1".repeat(PASSWORD_MIN_LENGTH),
      "password",
      "password1",
      "Password123",
      "p1".repeat(PASSWORD_MAX_LENGTH / 2),
      `${"p1".repeat(PASSWORD_MAX_LENGTH / 2)}x`,
      "a1!".repeat(70),
    ];
    for (const sample of samples) {
      expect([sample, passwordStrength(sample).score > 0]).toStrictEqual([
        sample,
        accepted(sample),
      ]);
      expect([sample, passwordFieldError(sample) === null]).toStrictEqual([
        sample,
        accepted(sample),
      ]);
    }
  });

  it("scores the length and character-class headroom above the rule", () => {
    expect(passwordStrength("passwrd1")).toStrictEqual({
      score: 1,
      label: "弱い",
    });
    expect(passwordStrength("Password123")).toStrictEqual({
      score: 2,
      label: "ふつう",
    });
    expect(passwordStrength("password1234")).toStrictEqual({
      score: 2,
      label: "ふつう",
    });
    expect(passwordStrength("Password1234")).toStrictEqual({
      score: 3,
      label: "十分",
    });
    expect(passwordStrength("Password1234567!")).toStrictEqual({
      score: 4,
      label: "とても強い",
    });
  });

  it("rejects the length bounds the transport boundary also rejects", () => {
    const atLimit = `${"a".repeat(PASSWORD_MAX_LENGTH - 1)}1`;
    const overLimit = `${"a".repeat(PASSWORD_MAX_LENGTH)}1`;
    expect(passwordStrength(atLimit).score).toBeGreaterThan(0);
    expect(passwordStrength(overLimit)).toStrictEqual({
      score: 0,
      label: "条件を満たしていません",
    });
    expect(passwordFieldError(overLimit)).toBe(
      `パスワードは ${PASSWORD_MAX_LENGTH} 文字までです`,
    );
  });
});
