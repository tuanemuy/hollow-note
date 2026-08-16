import type { RequestContainer } from "@repo/core/application/di/types";
import {
  isConflictError,
  isValidationError,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import type {
  UserHandleChangedEvent,
  UserProfileUpdatedEvent,
} from "@repo/core/domain/identity/events";
import type { IdentityUniqueDirectory } from "@repo/core/domain/identity/ports/identityUniqueDirectory";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { type UpdateProfileInput, updateProfile } from "../updateProfile";
import { signUpPending, signUpVerified } from "./authFlowHelpers";

const update = (h: TestHarness, input: UpdateProfileInput) =>
  updateProfile({ container: h.container, input });

const profileEvents = (
  h: TestHarness,
): readonly UserProfileUpdatedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.user.profileUpdated")
    .map((row) => row.payload as UserProfileUpdatedEvent["payload"]);

const handleEvents = (
  h: TestHarness,
): readonly UserHandleChangedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.user.handleChanged")
    .map((row) => row.payload as UserHandleChangedEvent["payload"]);

const handleRow = (h: TestHarness, normalizedKey: string) =>
  h.backend.uniqueDirectory
    .values()
    .find(
      (row) => row.kind === "handle" && row.normalizedKey === normalizedKey,
    );

const storedUser = (h: TestHarness, userId: string) => {
  const user = h.backend.users.get(userId);
  if (user === undefined || user.status === "deleted") {
    throw new Error(`no live user row for ${userId}`);
  }
  return user;
};

const deferred = (): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve: () => resolve() };
};

const expectBusinessRule = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => isBusinessRuleError(error) && error.code === code,
  );

describe("updateProfile", () => {
  it("TC-identity-272: stores the new display name and bio", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const view = await update(h, {
      userId,
      displayName: "山田 一郎",
      bio: "設計と読書メモ",
    });

    expect(view).toMatchObject({
      userId,
      displayName: "山田 一郎",
      bio: "設計と読書メモ",
    });
    const stored = storedUser(h, userId);
    expect(stored.displayName).toBe("山田 一郎");
    expect(stored.bio).toBe("設計と読書メモ");
  });

  it("TC-identity-273: emits profileUpdated when the display name changes", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await update(h, { userId, displayName: "Renamed" });

    expect(profileEvents(h)).toEqual([{ userId, displayName: "Renamed" }]);
  });

  it("TC-identity-274: a bio-only update emits no profileUpdated", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await update(h, { userId, bio: "自己紹介だけ" });

    expect(profileEvents(h)).toEqual([]);
    expect(storedUser(h, userId).bio).toBe("自己紹介だけ");
  });

  it("TC-identity-275: the first handle assignment emits handleChanged with previousHandle null", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const view = await update(h, { userId, handle: "ichiro" });

    expect(view.handle).toBe("ichiro");
    expect(handleEvents(h)).toEqual([
      { userId, previousHandle: null, currentHandle: "ichiro" },
    ]);
    expect(handleRow(h, "ichiro")).toMatchObject({
      state: "active",
      userId,
    });
  });

  it("TC-identity-278: changing the handle reports the previous one and frees its claim", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await update(h, { userId, handle: "ichiro" });

    await update(h, { userId, handle: "ichiro-y" });

    expect(handleEvents(h)[1]).toEqual({
      userId,
      previousHandle: "ichiro",
      currentHandle: "ichiro-y",
    });
    expect(handleRow(h, "ichiro-y")).toMatchObject({ state: "active", userId });
    // The old key is fully released, so anybody may take it again.
    expect(handleRow(h, "ichiro")).toBeUndefined();
  });

  it("TC-identity-279: a handle another user holds is refused", async () => {
    const h = createTestHarness();
    const owner = await signUpVerified(h, "owner@example.com");
    const other = await signUpVerified(h, "other@example.com");
    await update(h, { userId: owner.userId, handle: "ichiro" });

    await expect(
      update(h, { userId: other.userId, handle: "ichiro" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "HANDLE_ALREADY_USED",
    );
    expect(storedUser(h, other.userId).handle).toBeNull();
  });

  it("TC-identity-280: a retry after a failed shard write reuses the same reservation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const inner = h.container.globalUnitOfWorkProvider;
    let failNext = true;
    const directory = h.container.identityUniqueDirectory;
    const container: RequestContainer = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: (fn) => {
          if (failNext) {
            failNext = false;
            return Promise.reject(new Error("shard write lost"));
          }
          return inner.run(fn);
        },
      },
      // The compensating release is lost too, so the reservation survives
      // the failed attempt — which is exactly what the retry must reuse.
      identityUniqueDirectory: {
        ...directory,
        release: async () => {},
      } satisfies IdentityUniqueDirectory,
    };

    await expect(
      updateProfile({ container, input: { userId, handle: "ichiro" } }),
    ).rejects.toThrow("shard write lost");
    expect(handleRow(h, "ichiro")).toMatchObject({ state: "reserved" });

    await updateProfile({ container, input: { userId, handle: "ichiro" } });

    expect(storedUser(h, userId).handle).toBe("ichiro");
    expect(handleRow(h, "ichiro")).toMatchObject({ state: "active", userId });
  });

  it("TC-identity-281: a lost activate response reconciles against the committed user", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await update(h, { userId, handle: "ichiro" });

    const directory = h.container.identityUniqueDirectory;
    let dropNextActivate = true;
    const container: RequestContainer = {
      ...h.container,
      identityUniqueDirectory: {
        ...directory,
        activate: async (operationId, expectedUserVersion) => {
          if (dropNextActivate) {
            dropNextActivate = false;
            await directory.activate(operationId, expectedUserVersion);
            throw new Error("activate response lost");
          }
          await directory.activate(operationId, expectedUserVersion);
        },
      } satisfies IdentityUniqueDirectory,
    };

    await updateProfile({ container, input: { userId, handle: "ichiro-y" } });

    expect(handleRow(h, "ichiro-y")).toMatchObject({ state: "active", userId });
    expect(handleRow(h, "ichiro")).toBeUndefined();
  });

  it("keeps the handle out of the log when the activate response is lost", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const directory = h.container.identityUniqueDirectory;
    let dropNextActivate = true;
    const container: RequestContainer = {
      ...h.container,
      identityUniqueDirectory: {
        ...directory,
        activate: async (operationId, expectedUserVersion) => {
          if (dropNextActivate) {
            dropNextActivate = false;
            await directory.activate(operationId, expectedUserVersion);
            throw new Error("activate response lost");
          }
          await directory.activate(operationId, expectedUserVersion);
        },
      } satisfies IdentityUniqueDirectory,
    };

    await updateProfile({ container, input: { userId, handle: "ichiro" } });

    const errors = h.logger.byLevel("error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      meta: { parentOperationId: expect.any(String), kind: "handle" },
    });
    expect(JSON.stringify(errors)).not.toContain("ichiro");
  });

  it("re-sending the handle repairs a claim lost between the commit and the activation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const other = await signUpVerified(h, "other@example.com");
    await update(h, { userId, handle: "ichiro" });

    const inner = h.container.globalUnitOfWorkProvider;
    // The shard write commits and the process stops before `activate`,
    // so the reservation is gone and only the user row remembers the
    // new handle.
    const crashed: RequestContainer = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: async (fn) => {
          await inner.run(fn);
          throw new Error("process stopped after the commit");
        },
      },
    };

    await expect(
      updateProfile({
        container: crashed,
        input: { userId, handle: "ichiro-y" },
      }),
    ).rejects.toThrow("process stopped after the commit");
    expect(storedUser(h, userId).handle).toBe("ichiro-y");
    expect(handleRow(h, "ichiro-y")).toBeUndefined();

    await update(h, { userId, handle: "ichiro-y" });

    expect(handleRow(h, "ichiro-y")).toMatchObject({ state: "active", userId });
    // Only the claim is re-published; the user row already named the
    // handle, so the repair restates nothing.
    expect(handleEvents(h)).toHaveLength(2);
    await expect(
      update(h, { userId: other.userId, handle: "ichiro-y" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "HANDLE_ALREADY_USED",
    );
  });

  it("TC-identity-282: a two-character handle is refused", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expectBusinessRule(
      update(h, { userId, handle: "ab" }),
      IdentityErrorCode.InvalidHandle,
    );
  });

  it("TC-identity-283 / TC-identity-284: three and thirty characters are accepted", async () => {
    const h = createTestHarness();
    const short = await signUpVerified(h, "short@example.com");
    const long = await signUpVerified(h, "long@example.com");

    const shortView = await update(h, { userId: short.userId, handle: "abc" });
    const longView = await update(h, {
      userId: long.userId,
      handle: "a".repeat(30),
    });

    expect(shortView.handle).toBe("abc");
    expect(longView.handle).toBe("a".repeat(30));
  });

  it("TC-identity-285: a thirty-one character handle is refused", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expectBusinessRule(
      update(h, { userId, handle: "a".repeat(31) }),
      IdentityErrorCode.InvalidHandle,
    );
  });

  it("TC-identity-286: a reserved word is refused", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expectBusinessRule(
      update(h, { userId, handle: "settings" }),
      IdentityErrorCode.HandleReserved,
    );
  });

  it("TC-identity-287: a handle with capitals is normalized to lowercase", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const view = await update(h, { userId, handle: "Ichiro-Y" });

    expect(view.handle).toBe("ichiro-y");
    expect(handleRow(h, "ichiro-y")).toMatchObject({ state: "active" });
  });

  it("TC-identity-288: the empty string clears the handle and emits handleChanged", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await update(h, { userId, handle: "ichiro" });

    const view = await update(h, { userId, handle: "" });

    expect(view.handle).toBeNull();
    expect(handleEvents(h)[1]).toEqual({
      userId,
      previousHandle: "ichiro",
      currentHandle: null,
    });
    expect(handleRow(h, "ichiro")).toBeUndefined();
  });

  it("TC-identity-290: a pending user is refused with EMAIL_NOT_VERIFIED", async () => {
    const h = createTestHarness();
    const { userId } = await signUpPending(h);

    await expect(update(h, { userId, displayName: "Nope" })).rejects.toSatisfy(
      (error: unknown) =>
        isValidationError(error) && error.code === "EMAIL_NOT_VERIFIED",
    );
  });

  it("TC-identity-291: a 51-character display name is refused", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expectBusinessRule(
      update(h, { userId, displayName: "あ".repeat(51) }),
      IdentityErrorCode.InvalidDisplayName,
    );
    expect(storedUser(h, userId).displayName).toBe("Alice");
  });

  it("TC-identity-292: a 501-character bio is refused", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expectBusinessRule(
      update(h, { userId, bio: "あ".repeat(501) }),
      IdentityErrorCode.InvalidBio,
    );
  });

  it("TC-identity-293: an update that lost the race reports OPTIMISTIC_LOCK_FAILURE", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const inner = h.container.globalUnitOfWorkProvider;
    let rivalPending = true;
    const container: RequestContainer = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: async (fn) => {
          if (rivalPending) {
            rivalPending = false;
            await update(h, { userId, displayName: "Rival" });
          }
          return inner.run(fn);
        },
      },
    };

    await expect(
      updateProfile({ container, input: { userId, displayName: "Loser" } }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    expect(storedUser(h, userId).displayName).toBe("Rival");
  });

  it("TC-identity-293: the loser of a same-handle race leaves the winner's claim standing", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const other = await signUpVerified(h, "other@example.com");
    const inner = h.container.globalUnitOfWorkProvider;
    const directory = h.container.identityUniqueDirectory;

    const committed = deferred();
    const compensated = deferred();
    const atUnitOfWork = deferred();

    // The loser reserves and reaches its unit of work first, then waits
    // for the winner to commit — so it observes the stale user version.
    const loserContainer: RequestContainer = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: async (fn) => {
          atUnitOfWork.resolve();
          await committed.promise;
          return inner.run(fn);
        },
      },
    };
    // The winner is held between its commit and the activation, which is
    // exactly the window in which the loser compensates.
    const winnerContainer: RequestContainer = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: async (fn) => {
          const result = await inner.run(fn);
          committed.resolve();
          return result;
        },
      },
      identityUniqueDirectory: {
        ...directory,
        activate: async (operationId, expectedUserVersion) => {
          await compensated.promise;
          await directory.activate(operationId, expectedUserVersion);
        },
      } satisfies IdentityUniqueDirectory,
    };

    const loser = updateProfile({
      container: loserContainer,
      input: { userId, handle: "shared" },
    }).catch((error: unknown) => error);
    await atUnitOfWork.promise;
    const winner = updateProfile({
      container: winnerContainer,
      input: { userId, handle: "shared" },
    });

    expect(await loser).toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    compensated.resolve();
    const view = await winner;

    expect(view.handle).toBe("shared");
    expect(storedUser(h, userId).handle).toBe("shared");
    expect(handleRow(h, "shared")).toMatchObject({ state: "active", userId });
    await expect(
      update(h, { userId: other.userId, handle: "shared" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "HANDLE_ALREADY_USED",
    );
  });
});

describe("updateProfile avatar URL", () => {
  it("TC-identity-332: accepts the app-relative path the object storage hands out", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const view = await update(h, {
      userId,
      avatarUrl: "/storage/users/u/avatar/f.png",
    });

    expect(view.avatarUrl).toBe("/storage/users/u/avatar/f.png");
  });

  it("TC-identity-333 / TC-identity-334: refuses a cross-origin URL and a protocol-relative one", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    await expectBusinessRule(
      update(h, { userId, avatarUrl: "https://evil.example/a.png" }),
      IdentityErrorCode.InvalidAvatarUrl,
    );
    await expectBusinessRule(
      update(h, { userId, avatarUrl: "//evil.example/a.png" }),
      IdentityErrorCode.InvalidAvatarUrl,
    );
  });

  it("TC-identity-335: clears the icon when null is passed", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await update(h, { userId, avatarUrl: "/storage/a.png" });

    const view = await update(h, { userId, avatarUrl: null });

    expect(view.avatarUrl).toBeNull();
  });
});
