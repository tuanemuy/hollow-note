import type { Clock } from "../../application/ports/clock";

/**
 * Controllable `Clock` shared by every conformance backend, so suites
 * can cross TTL / lease / retention boundaries deterministically.
 */
export type TestClock = Clock & {
  set(instant: Date): void;
  advance(ms: number): void;
};

export function createTestClock(
  initial: Date = new Date("2026-01-01T00:00:00.000Z"),
): TestClock {
  let current = new Date(initial.getTime());
  return {
    now(): Date {
      return new Date(current.getTime());
    },
    set(instant: Date): void {
      current = new Date(instant.getTime());
    },
    advance(ms: number): void {
      current = new Date(current.getTime() + ms);
    },
  };
}
