import { beforeEach, describe, expect, it } from "vitest";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";

const TTL_MS = 24 * 60 * 60 * 1000;
const KEY = "signIn:a@example.com:client-1";

/**
 * Shared conformance suite for `LoginAttemptStore`
 * (ADP-identity-035..038). The parallel-increment case backs
 * TC-identity-227: `recordFailure` must be one atomic operation, so ten
 * concurrent failures count exactly ten.
 */
export function describeLoginAttemptStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`LoginAttemptStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-identity-035: get returns null for an unknown key", async () => {
      expect(await backend.loginAttemptStore.get(KEY)).toBeNull();
    });

    it("ADP-identity-036: recordFailure creates at 1 and returns the post-increment state", async () => {
      const now = backend.clock.now();
      const first = await backend.loginAttemptStore.recordFailure(
        KEY,
        now,
        TTL_MS,
      );
      expect(first).toEqual({ key: KEY, failureCount: 1, lastFailedAt: now });

      const second = await backend.loginAttemptStore.recordFailure(
        KEY,
        now,
        TTL_MS,
      );
      expect(second.failureCount).toBe(2);
      expect(await backend.loginAttemptStore.get(KEY)).toEqual(second);
    });

    it("ADP-identity-036: ten parallel failures count exactly ten (TC-identity-227)", async () => {
      const now = backend.clock.now();
      await Promise.all(
        Array.from({ length: 10 }, () =>
          backend.loginAttemptStore.recordFailure(KEY, now, TTL_MS),
        ),
      );
      expect((await backend.loginAttemptStore.get(KEY))?.failureCount).toBe(10);
    });

    it("ADP-identity-037: clear removes the record", async () => {
      const now = backend.clock.now();
      await backend.loginAttemptStore.recordFailure(KEY, now, TTL_MS);
      await backend.loginAttemptStore.clear(KEY);
      expect(await backend.loginAttemptStore.get(KEY)).toBeNull();
    });

    it("ADP-identity-036/038: an expired record reads as absent and restarts at 1", async () => {
      const now = backend.clock.now();
      await backend.loginAttemptStore.recordFailure(KEY, now, TTL_MS);
      backend.clock.advance(TTL_MS);

      expect(await backend.loginAttemptStore.get(KEY)).toBeNull();
      const restarted = await backend.loginAttemptStore.recordFailure(
        KEY,
        backend.clock.now(),
        TTL_MS,
      );
      expect(restarted.failureCount).toBe(1);
    });

    it("ADP-identity-038: deleteExpired sweeps only expired rows in bounded pages", async () => {
      const now = backend.clock.now();
      await backend.loginAttemptStore.recordFailure("key-a", now, TTL_MS);
      await backend.loginAttemptStore.recordFailure("key-b", now, TTL_MS);
      await backend.loginAttemptStore.recordFailure(
        "key-later",
        now,
        TTL_MS * 2,
      );
      const boundary = new Date(now.getTime() + TTL_MS);

      const first = await backend.loginAttemptStore.deleteExpired(
        boundary,
        null,
        1,
      );
      expect(first.deleted).toBe(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await backend.loginAttemptStore.deleteExpired(
        boundary,
        first.nextCursor,
        10,
      );
      expect(second.deleted).toBe(1);
      expect(second.nextCursor).toBeNull();

      backend.clock.set(boundary);
      expect(await backend.loginAttemptStore.get("key-later")).not.toBeNull();
    });
  });
}
