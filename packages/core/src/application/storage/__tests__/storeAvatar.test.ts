import { isNotFoundError } from "@repo/core/application/errors";
import { ScopeKey } from "@repo/core/application/scope";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { StorageErrorCode } from "@repo/core/domain/storage/errorCode";
import type { FileDeletedEvent } from "@repo/core/domain/storage/events";
import { ObjectKey } from "@repo/core/domain/storage/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { Membership } from "@repo/core/domain/workspace/membership";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { type StoreAvatarInput, storeAvatar } from "../storeAvatar";

const USER_ID = "user-1";
const WORKSPACE_ID = "workspace-1";
const MB = 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const png = (bytes: number): Uint8Array => {
  const body = new Uint8Array(Math.max(bytes, PNG_SIGNATURE.length));
  body.set(PNG_SIGNATURE, 0);
  return body;
};

const webp = (bytes: number): Uint8Array => {
  const body = new Uint8Array(Math.max(bytes, 12));
  body.set([0x52, 0x49, 0x46, 0x46], 0);
  body.set([0x57, 0x45, 0x42, 0x50], 8);
  return body;
};

const upload = (h: TestHarness, overrides: Partial<StoreAvatarInput> = {}) =>
  storeAvatar({
    container: h.container,
    input: {
      userId: USER_ID,
      subjectType: "user",
      subjectId: USER_ID,
      fileName: "avatar.png",
      body: png(16),
      ...overrides,
    },
  });

const storedFiles = (h: TestHarness) =>
  h.backend.scope(ScopeKey.user(UserId.create(USER_ID))).storedFiles.values();

const workspaceFiles = (h: TestHarness) =>
  h.backend
    .scope(ScopeKey.workspace(WorkspaceId.create(WORKSPACE_ID)))
    .storedFiles.values();

/** Seeds a workspace holding one membership, without its saga. */
async function seedWorkspaceMember(
  h: TestHarness,
  role: "owner" | "editor" | "viewer" | null,
): Promise<void> {
  const workspaceId = WorkspaceId.create(WORKSPACE_ID);
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(workspaceId),
    async (ctx) => {
      await ctx.workspaceRepository.insert(
        Workspace.create(
          {
            id: WORKSPACE_ID,
            ownerId: UserId.create("founder-1"),
            name: "Workspace",
            description: "",
            slug: null,
          },
          now,
        ).entity,
      );
      if (role !== null) {
        await ctx.membershipRepository.insert(
          Membership.create(
            {
              id: "membership-1",
              workspaceId,
              userId: UserId.create(USER_ID),
              role,
            },
            now,
          ).entity,
        );
      }
    },
  );
}

const deletedEvents = (
  h: TestHarness,
): readonly FileDeletedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "storage.fileDeleted")
    .map((row) => row.payload as FileDeletedEvent["payload"]);

const expectBusinessRule = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => isBusinessRuleError(error) && error.code === code,
  );

describe("storeAvatar", () => {
  it("TC-storage-167: stores the owner's icon and answers with its URL", async () => {
    const h = createTestHarness();

    const view = await upload(h);

    expect(view.fileId).not.toBe("");
    const files = storedFiles(h);
    expect(files).toHaveLength(1);
    const file = files[0];
    if (file === undefined) {
      throw new Error("no stored file row");
    }
    expect(file.purpose).toBe("avatar");
    expect(view.url).toBe(`/storage/${file.objectKey}`);
    expect(
      await h.container.objectStorage.get(ObjectKey.create(file.objectKey)),
    ).not.toBeNull();
  });

  it("TC-storage-170: another user's id is refused", async () => {
    const h = createTestHarness();

    await expectBusinessRule(
      upload(h, { subjectId: "user-2" }),
      WorkspaceErrorCode.InsufficientRole,
    );
    expect(storedFiles(h)).toHaveLength(0);
  });

  it("TC-storage-168: a workspace owner stores the workspace icon in its own scope", async () => {
    const h = createTestHarness();
    await seedWorkspaceMember(h, "owner");

    const view = await upload(h, {
      subjectType: "workspace",
      subjectId: WORKSPACE_ID,
    });

    const files = workspaceFiles(h);
    expect(files).toHaveLength(1);
    expect(files[0]?.purpose).toBe("avatar");
    expect(files[0]?.objectKey).toBe(
      `workspaces/${WORKSPACE_ID}/avatar/${view.fileId}.png`,
    );
    expect(storedFiles(h)).toHaveLength(0);
  });

  it("TC-storage-169: a workspace editor is refused", async () => {
    const h = createTestHarness();
    await seedWorkspaceMember(h, "editor");

    await expectBusinessRule(
      upload(h, { subjectType: "workspace", subjectId: WORKSPACE_ID }),
      WorkspaceErrorCode.InsufficientRole,
    );
    expect(workspaceFiles(h)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });

  it("TC-storage-247: a non-member is refused a workspace icon", async () => {
    const h = createTestHarness();
    await seedWorkspaceMember(h, null);

    await expectBusinessRule(
      upload(h, { subjectType: "workspace", subjectId: WORKSPACE_ID }),
      WorkspaceErrorCode.InsufficientRole,
    );
    expect(workspaceFiles(h)).toHaveLength(0);
  });

  it("TC-storage-248: an unknown workspace id resolves to WORKSPACE_NOT_FOUND", async () => {
    const h = createTestHarness();

    await expect(
      upload(h, { subjectType: "workspace", subjectId: "no-such-workspace" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isNotFoundError(error) && error.code === "WORKSPACE_NOT_FOUND",
    );
  });

  it("TC-storage-171: a 6 MB image is refused", async () => {
    const h = createTestHarness();

    await expectBusinessRule(
      upload(h, { body: png(6 * MB) }),
      StorageErrorCode.FileTooLarge,
    );
    expect(storedFiles(h)).toHaveLength(0);
  });

  it("TC-storage-172: a 5 MB image is accepted (boundary)", async () => {
    const h = createTestHarness();

    await upload(h, { body: png(5 * MB) });

    expect(storedFiles(h)).toHaveLength(1);
  });

  it("TC-storage-173: a GIF is refused", async () => {
    const h = createTestHarness();
    const gif = new Uint8Array(16);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);

    await expectBusinessRule(
      upload(h, { body: gif, fileName: "avatar.gif" }),
      StorageErrorCode.UnsupportedMimeType,
    );
    expect(storedFiles(h)).toHaveLength(0);
  });

  it("records the type the bytes carry, not the one the file name suggests", async () => {
    const h = createTestHarness();

    const view = await upload(h, { body: webp(32), fileName: "avatar.png" });

    const file = storedFiles(h)[0];
    expect(file?.mimeType).toBe("image/webp");
    expect(file?.objectKey).toBe(`users/${USER_ID}/avatar/${view.fileId}.webp`);
  });

  it("refuses bytes that are not one of the accepted image formats", async () => {
    const h = createTestHarness();

    await expectBusinessRule(
      upload(h, { body: new TextEncoder().encode("<html>hi</html>") }),
      StorageErrorCode.UnsupportedMimeType,
    );
    expect(storedFiles(h)).toHaveLength(0);
  });

  it("TC-storage-174: replacing an icon deletes the previous one in the same unit of work", async () => {
    const h = createTestHarness();
    const first = await upload(h);

    const second = await upload(h, { body: webp(16) });

    const files = storedFiles(h);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(second.fileId);
    const deleted = deletedEvents(h);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.fileId).toBe(first.fileId);
    expect(deleted[0]?.deletionOperationId).toBeNull();
  });

  it("TC-identity-045: a write after the deletion barrier is refused", async () => {
    const h = createTestHarness();
    const userId = UserId.create(USER_ID);
    await h.container.scopeUnitOfWorkProvider.run(
      ScopeKey.user(userId),
      (ctx) =>
        ctx.cleanupAdmission.beginPersonalAccountDeletion("deletion-1", userId),
    );

    await expect(upload(h)).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ACCOUNT_DELETING",
    );
    expect(storedFiles(h)).toHaveLength(0);
    // Bytes without a metadata row would be reachable by no cleanup at
    // all — not even the account deletion this barrier belongs to.
    expect(h.backend.objects.size).toBe(0);
  });

  it("rolls the stored object back when the transaction fails", async () => {
    const failure = new Error("transaction rolled back");
    const h = createTestHarness({
      requestOverrides: {
        scopeUnitOfWorkProvider: { run: () => Promise.reject(failure) },
      },
    });

    await expect(upload(h)).rejects.toBe(failure);

    expect(storedFiles(h)).toHaveLength(0);
    expect(h.backend.objects.size).toBe(0);
  });
});
