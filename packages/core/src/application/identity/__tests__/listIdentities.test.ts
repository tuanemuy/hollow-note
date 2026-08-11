import { Identity } from "@repo/core/domain/identity/identity";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { addPasswordIdentity } from "../addPasswordIdentity";
import { listIdentities } from "../listIdentities";
import { signUpVerified, signUpWithGoogle } from "./authFlowHelpers";

const list = (h: TestHarness, userId: string) =>
  listIdentities({ container: h.container, input: { userId } });

/** Plants OAuth identities directly — the usecases cap the set at 8. */
function plantOAuthIdentities(
  h: TestHarness,
  userId: string,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const id = `planted-oauth-${index}`;
    const { entity } = Identity.createOAuth(
      {
        id,
        userId: UserId.create(userId),
        provider: "google",
        providerAccountId: `planted-account-${index}`,
        providerEmail: `planted-${index}@example.com`,
      },
      h.clock.now(),
    );
    h.backend.identities.set(id, entity);
  }
}

describe("listIdentities", () => {
  it("TC-identity-128: returns both methods and marks them removable", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h, {
      email: "user@example.com",
    });
    await addPasswordIdentity({
      container: h.container,
      input: { userId, newPassword: "password1234" },
    });

    const view = await list(h, userId);

    expect(view.identities.map((item) => item.kind).sort()).toEqual([
      "oauth",
      "password",
    ]);
    expect(view.removable).toBe(true);
  });

  it("TC-identity-129: a single method is not removable", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const view = await list(h, userId);

    expect(view.identities).toHaveLength(1);
    expect(view.removable).toBe(false);
  });

  it("TC-identity-130: the projection carries no password hash or token", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const view = await list(h, userId);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("tokenHash");
    for (const item of view.identities) {
      expect(Object.keys(item).sort()).toEqual([
        "accountLabel",
        "createdAt",
        "id",
        "kind",
        "provider",
      ]);
    }
  });

  it("TC-identity-131: an OAuth method carries its provider and account label", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h, {
      email: "linked@example.com",
    });

    const [item] = (await list(h, userId)).identities;

    expect(item).toMatchObject({
      kind: "oauth",
      provider: "google",
      accountLabel: "linked@example.com",
    });
  });

  it("TC-identity-132: a password method has no provider", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const [item] = (await list(h, userId)).identities;

    expect(item).toMatchObject({
      kind: "password",
      provider: null,
      accountLabel: null,
    });
  });

  it("TC-identity-133: returns the 8 methods the invariant allows at most", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    plantOAuthIdentities(h, userId, 7);

    const view = await list(h, userId);

    expect(view.identities).toHaveLength(8);
    expect(view.removable).toBe(true);
  });
});
