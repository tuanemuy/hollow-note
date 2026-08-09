import { describe, expect, it } from "vitest";
import { LoginThrottlePolicy } from "../services/loginThrottlePolicy";

const at = (ms: number) => new Date(ms);
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const attempt = (failureCount: number, lastFailedAtMs: number | null) => ({
  key: "signIn:a@example.com:203.0.113.9",
  failureCount,
  lastFailedAt: lastFailedAtMs === null ? null : at(lastFailedAtMs),
});

describe("LoginThrottlePolicy.initial", () => {
  it("has zero failures and no last-failure time", () => {
    expect(LoginThrottlePolicy.initial("k")).toEqual({
      key: "k",
      failureCount: 0,
      lastFailedAt: null,
    });
  });
});

describe("LoginThrottlePolicy.evaluate — delays", () => {
  it("allows with 0 or 1 failures", () => {
    expect(LoginThrottlePolicy.evaluate(attempt(0, null), at(0)).kind).toBe(
      "allow",
    );
    expect(LoginThrottlePolicy.evaluate(attempt(1, 0), at(0)).kind).toBe(
      "allow",
    );
  });

  it("delays the 3rd attempt by 1 second after 2 failures", () => {
    const decision = LoginThrottlePolicy.evaluate(attempt(2, 0), at(0));
    expect(decision).toEqual({ kind: "delay", waitMs: SECOND });
  });

  it("returns the remaining wait, not the full wait", () => {
    // 4 failures → base wait 2^(4-2) = 4s; 1s already elapsed.
    const decision = LoginThrottlePolicy.evaluate(attempt(4, 0), at(SECOND));
    expect(decision).toEqual({ kind: "delay", waitMs: 3 * SECOND });
  });

  it("allows once the wait has fully elapsed", () => {
    expect(
      LoginThrottlePolicy.evaluate(attempt(4, 0), at(4 * SECOND)).kind,
    ).toBe("allow");
  });

  it("caps the wait at 60 seconds", () => {
    // 9 failures → 2^7 = 128s uncapped.
    const decision = LoginThrottlePolicy.evaluate(attempt(9, 0), at(0));
    expect(decision).toEqual({ kind: "delay", waitMs: 60 * SECOND });
  });
});

describe("LoginThrottlePolicy.evaluate — lock", () => {
  it("locks at 10 failures within 15 minutes, until lastFailedAt + 15min", () => {
    const decision = LoginThrottlePolicy.evaluate(attempt(10, 0), at(0));
    expect(decision).toEqual({ kind: "locked", until: at(15 * MINUTE) });
  });

  it("stays locked just before the unlock instant", () => {
    expect(
      LoginThrottlePolicy.evaluate(attempt(10, 0), at(15 * MINUTE - 1)).kind,
    ).toBe("locked");
  });

  it("unlocks at exactly lastFailedAt + 15 minutes and allows (60s wait long past)", () => {
    const decision = LoginThrottlePolicy.evaluate(
      attempt(10, 0),
      at(15 * MINUTE),
    );
    expect(decision.kind).toBe("allow");
  });

  it("re-locks when a post-unlock failure refreshes lastFailedAt", () => {
    const relocked = LoginThrottlePolicy.evaluate(
      attempt(11, 16 * MINUTE),
      at(16 * MINUTE + 1),
    );
    expect(relocked).toEqual({
      kind: "locked",
      until: at(16 * MINUTE + 15 * MINUTE),
    });
  });

  it("keeps the lock rule above the delay rule (no delay while locked)", () => {
    const decision = LoginThrottlePolicy.evaluate(
      attempt(12, 0),
      at(30 * SECOND),
    );
    expect(decision.kind).toBe("locked");
  });
});

describe("LoginThrottlePolicy constants", () => {
  it("exposes the canonical values", () => {
    expect(LoginThrottlePolicy.lockThreshold).toBe(10);
    expect(LoginThrottlePolicy.lockDurationMs).toBe(15 * MINUTE);
    expect(LoginThrottlePolicy.maxDelayMs).toBe(60 * SECOND);
    expect(LoginThrottlePolicy.attemptTtlMs).toBe(24 * 60 * MINUTE);
  });
});
