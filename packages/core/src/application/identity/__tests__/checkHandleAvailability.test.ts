import { isConflictError } from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { checkHandleAvailability } from "../checkHandleAvailability";
import { updateProfile } from "../updateProfile";
import { signUpVerified } from "./authFlowHelpers";

/**
 * The profile form's advisory handle read (ADR-047). It has no spec TC
 * of its own; what is pinned is the three verdicts the form renders and
 * the fact that "free" is a hint rather than a claim.
 */

const check = (h: TestHarness, userId: string, handle: string) =>
  checkHandleAvailability({
    container: h.container,
    input: { userId, handle },
  });

const claim = (h: TestHarness, userId: string, handle: string) =>
  updateProfile({ container: h.container, input: { userId, handle } });

const expectBusinessRule = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => isBusinessRuleError(error) && error.code === code,
  );

describe("checkHandleAvailability", () => {
  it("reports an unclaimed handle as free and not yet one's own", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expect(check(h, userId, "ichiro")).resolves.toEqual({
      handle: "ichiro",
      available: true,
      ownedBySelf: false,
    });
  });

  it("reports a handle another user holds as taken", async () => {
    const h = createTestHarness();
    const owner = await signUpVerified(h, "owner@example.com");
    const asker = await signUpVerified(h, "asker@example.com");
    await claim(h, owner.userId, "ichiro");

    await expect(check(h, asker.userId, "ichiro")).resolves.toEqual({
      handle: "ichiro",
      available: false,
      ownedBySelf: false,
    });
  });

  it("separates one's own handle from a free one, normalizing the input first", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await claim(h, userId, "ichiro");

    await expect(check(h, userId, "  Ichiro  ")).resolves.toEqual({
      handle: "ichiro",
      available: true,
      ownedBySelf: true,
    });
  });

  it("answers free for a claim being torn down, which the save may still refuse", async () => {
    const h = createTestHarness();
    const owner = await signUpVerified(h, "owner@example.com");
    const asker = await signUpVerified(h, "asker@example.com");
    await claim(h, owner.userId, "ichiro");
    await h.container.identityUniqueDirectory.beginRelease({
      kind: "handle",
      normalizedKey: "ichiro",
      expectedUserId: UserId.create(owner.userId),
      operationId: "release-1",
    });

    await expect(check(h, asker.userId, "ichiro")).resolves.toMatchObject({
      available: true,
      ownedBySelf: false,
    });
    // The advice and the reservation are deliberately asymmetric: only
    // the save decides, and a `releasing` row still blocks it.
    await expect(claim(h, asker.userId, "ichiro")).rejects.toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "HANDLE_ALREADY_USED",
    );
  });

  it("rejects a handle the value object refuses before it reaches the directory", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expectBusinessRule(
      check(h, userId, "ab"),
      IdentityErrorCode.InvalidHandle,
    );
    await expectBusinessRule(
      check(h, userId, "settings"),
      IdentityErrorCode.HandleReserved,
    );
    expect(
      h.backend.uniqueDirectory.values().filter((row) => row.kind === "handle"),
    ).toEqual([]);
  });
});
