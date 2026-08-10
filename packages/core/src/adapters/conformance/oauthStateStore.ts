import { beforeEach, describe, expect, it } from "vitest";
import type { OAuthFlowState } from "../../application/ports/oauthStateStore";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { userId } from "./fixtures";

const TTL_MS = 10 * 60 * 1000;

const signInState: OAuthFlowState = {
  provider: "google",
  codeVerifier: "verifier-1",
  redirectTo: "/notes",
  intent: "signIn",
  userId: null,
  userAuthEpoch: null,
};

/**
 * Shared conformance suite for `OAuthStateStore` (ADP-common-036..038).
 * `take` must be an atomic get + delete; expired rows for every intent
 * are swept by the same `deleteExpired`.
 */
export function describeOAuthStateStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`OAuthStateStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    it("ADP-common-036/037: put then take returns the state exactly once", async () => {
      await backend.oauthStateStore.put("state-1", signInState, TTL_MS);
      expect(await backend.oauthStateStore.take("state-1")).toEqual(
        signInState,
      );
      expect(await backend.oauthStateStore.take("state-1")).toBeNull();
    });

    it("ADP-common-037: concurrent takes yield exactly one non-null result", async () => {
      await backend.oauthStateStore.put("state-1", signInState, TTL_MS);
      const results = await Promise.all([
        backend.oauthStateStore.take("state-1"),
        backend.oauthStateStore.take("state-1"),
      ]);
      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });

    it("ADP-common-037: an expired state is not returned", async () => {
      await backend.oauthStateStore.put("state-1", signInState, TTL_MS);
      backend.clock.advance(TTL_MS);
      expect(await backend.oauthStateStore.take("state-1")).toBeNull();
    });

    it("ADP-common-038: deleteExpired sweeps both sign-in and integration intents in pages", async () => {
      const integrationState: OAuthFlowState = {
        provider: "googleDrive",
        codeVerifier: "verifier-2",
        redirectTo: null,
        intent: "integration",
        userId: userId(1),
        userAuthEpoch: 4,
      };
      await backend.oauthStateStore.put("state-a", signInState, TTL_MS);
      await backend.oauthStateStore.put("state-b", integrationState, TTL_MS);
      await backend.oauthStateStore.put("state-later", signInState, TTL_MS * 3);
      const boundary = new Date(backend.clock.now().getTime() + TTL_MS);

      const first = await backend.oauthStateStore.deleteExpired(
        boundary,
        null,
        1,
      );
      expect(first.deleted).toBe(1);
      expect(first.nextCursor).not.toBeNull();

      const second = await backend.oauthStateStore.deleteExpired(
        boundary,
        first.nextCursor,
        10,
      );
      expect(second.deleted).toBe(1);
      expect(second.nextCursor).toBeNull();
    });
  });
}
