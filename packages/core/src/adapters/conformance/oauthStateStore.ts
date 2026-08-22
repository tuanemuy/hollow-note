import { beforeEach, describe, expect, it } from "vitest";
import type { OAuthFlowState } from "../../application/ports/oauthStateStore";
import { TokenHash } from "../../domain/identity/valueObject";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { userId } from "./fixtures";

const TTL_MS = 10 * 60 * 1000;

const BINDING_HASH = TokenHash.create("binding-hash-1");
const OTHER_BINDING_HASH = TokenHash.create("binding-hash-2");

const signInState: OAuthFlowState = {
  provider: "google",
  codeVerifier: "verifier-1",
  redirectTo: "/notes",
  intent: "signIn",
  userId: null,
  userAuthEpoch: null,
  stateBindingHash: BINDING_HASH,
};

const integrationState: OAuthFlowState = {
  provider: "googleDrive",
  codeVerifier: "verifier-2",
  redirectTo: null,
  intent: "integration",
  userId: userId(1),
  userAuthEpoch: 4,
  stateBindingHash: OTHER_BINDING_HASH,
};

/**
 * Shared conformance suite for `OAuthStateStore` (ADP-common-036..038).
 * `take` must be an atomic get + delete that removes the row only when
 * the binding matches — even if the row has expired; expired rows for
 * every intent are swept by the same `deleteExpired`.
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

    it("ADP-common-036/037: put then take with the matching binding returns the state exactly once", async () => {
      await backend.oauthStateStore.put("state-1", signInState, TTL_MS);
      expect(
        await backend.oauthStateStore.take("state-1", BINDING_HASH),
      ).toEqual(signInState);
      expect(
        await backend.oauthStateStore.take("state-1", BINDING_HASH),
      ).toBeNull();
    });

    it("ADP-common-036/037: a take is keyed by state as well as binding, so it never consumes another row", async () => {
      await backend.oauthStateStore.put("state-a", signInState, TTL_MS);
      await backend.oauthStateStore.put("state-b", integrationState, TTL_MS);

      expect(
        await backend.oauthStateStore.take("state-a", OTHER_BINDING_HASH),
      ).toBeNull();
      expect(
        await backend.oauthStateStore.take("state-unstored", BINDING_HASH),
      ).toBeNull();

      expect(
        await backend.oauthStateStore.take("state-a", BINDING_HASH),
      ).toEqual(signInState);
      expect(
        await backend.oauthStateStore.take("state-b", OTHER_BINDING_HASH),
      ).toEqual(integrationState);
    });

    it("ADP-common-037: a take whose binding does not match returns null and leaves the row", async () => {
      await backend.oauthStateStore.put("state-1", signInState, TTL_MS);
      expect(
        await backend.oauthStateStore.take("state-1", OTHER_BINDING_HASH),
      ).toBeNull();
      expect(
        await backend.oauthStateStore.take("state-1", BINDING_HASH),
      ).toEqual(signInState);
    });

    it("ADP-common-037: concurrent takes yield exactly one non-null result", async () => {
      await backend.oauthStateStore.put("state-1", signInState, TTL_MS);
      const results = await Promise.all([
        backend.oauthStateStore.take("state-1", BINDING_HASH),
        backend.oauthStateStore.take("state-1", BINDING_HASH),
      ]);
      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });

    it("ADP-common-037/038: an expired take with the matching binding returns null and removes the row", async () => {
      await backend.oauthStateStore.put("state-1", signInState, TTL_MS);
      backend.clock.advance(TTL_MS);
      expect(
        await backend.oauthStateStore.take("state-1", BINDING_HASH),
      ).toBeNull();

      const swept = await backend.oauthStateStore.deleteExpired(
        new Date(backend.clock.now().getTime() + TTL_MS),
        null,
        10,
      );
      expect(swept.deleted).toBe(0);
    });

    it("ADP-common-037/038: an expired take whose binding does not match returns null and leaves the row", async () => {
      await backend.oauthStateStore.put("state-1", signInState, TTL_MS);
      backend.clock.advance(TTL_MS);
      expect(
        await backend.oauthStateStore.take("state-1", OTHER_BINDING_HASH),
      ).toBeNull();

      const swept = await backend.oauthStateStore.deleteExpired(
        new Date(backend.clock.now().getTime() + TTL_MS),
        null,
        10,
      );
      expect(swept.deleted).toBe(1);
    });

    it("ADP-common-038: deleteExpired sweeps both sign-in and integration intents in pages", async () => {
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
