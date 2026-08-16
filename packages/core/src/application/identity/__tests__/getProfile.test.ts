import {
  isNotFoundError,
  isValidationError,
} from "@repo/core/application/errors";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { getProfile } from "../getProfile";
import { updateProfile } from "../updateProfile";
import {
  markDeleted,
  markDeleting,
  signUpPending,
  signUpVerified,
} from "./authFlowHelpers";

const read = (h: TestHarness, userId: string) =>
  getProfile({ container: h.container, input: { userId } });

const expectValidation = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => isValidationError(error) && error.code === code,
  );

const expectNotFound = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(isNotFoundError);

describe("getProfile", () => {
  it("projects every field P-21 edits, including the bio nothing else carries", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await updateProfile({
      container: h.container,
      input: {
        userId,
        displayName: "山田 一郎",
        bio: "設計と読書メモ",
        avatarUrl: "/storage/avatar.png",
        handle: "ichiro",
      },
    });

    await expect(read(h, userId)).resolves.toEqual({
      userId,
      displayName: "山田 一郎",
      bio: "設計と読書メモ",
      avatarUrl: "/storage/avatar.png",
      handle: "ichiro",
    });
  });

  it("answers a profile that was never edited with the sign-up defaults", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expect(read(h, userId)).resolves.toMatchObject({
      userId,
      displayName: "Alice",
      bio: "",
      avatarUrl: null,
      handle: null,
    });
  });

  it("refuses an unverified account, which has no settings screen yet", async () => {
    const h = createTestHarness();
    const { userId } = await signUpPending(h);

    await expectValidation(read(h, userId), "EMAIL_NOT_VERIFIED");
  });

  it("refuses an account whose deletion has started", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    markDeleting(h, userId);

    await expectValidation(read(h, userId), "ACCOUNT_UNAVAILABLE");
  });

  it("reports a tombstone as not found, so the PII-free row leaks nothing", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    markDeleted(h, userId);

    await expectNotFound(read(h, userId));
  });

  it("reports an unknown user as not found", async () => {
    const h = createTestHarness();

    await expectNotFound(read(h, "user-that-never-existed"));
  });
});
