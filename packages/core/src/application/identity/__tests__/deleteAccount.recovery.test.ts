import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { NoteId } from "@repo/core/domain/note/valueObject";
import { StoredFile } from "@repo/core/domain/storage/storedFile";
import {
  Checksum,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "@repo/core/domain/storage/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { dispatchAccountDeletionCleanup } from "../deleteAccount/cleanupDispatch";
import { continueAccountDeletionManifestBuild } from "../deleteAccount/manifestBuild";
import { signUpVerified } from "./authFlowHelpers";
import { runUntilSettled } from "./deletionDriver";
import { acceptDeletion, DELETION_REQUEST_ID } from "./deletionHarness";

/**
 * Convergence, as opposed to the per-phase tests next to this file: each
 * case injects one of the faults at-least-once delivery actually produces
 * — a lost response, a redelivered command, a re-sent request — and then
 * hands the operation to the driver to see whether it still reaches
 * `completed` exactly once.
 *
 * The phase-level assertions live with the phase (build: TC-identity-096
 * / 101, cleanup: 087 / 089, admission: 050); what is checked here is
 * that the chain as a whole does not fork or stall around them.
 */

const EMAIL = "user@example.com";

const scopeOf = (userId: string) => ScopeKey.user(UserId.create(userId));

const seedFiles = (h: TestHarness, userId: string, count: number) => {
  const owner = StorageOwner.user(UserId.create(userId));
  return h.container.scopeUnitOfWorkProvider.run(
    scopeOf(userId),
    async (ctx) => {
      for (let i = 0; i < count; i += 1) {
        const id = `seed-file-${String(i).padStart(3, "0")}`;
        const fileId = StoredFileId.create(id);
        const registered = StoredFile.register(
          {
            id,
            owner,
            objectKey: ObjectKey.build(owner, "media", fileId, "png"),
            fileName: `${id}.png`,
            mimeType: "image/png",
            size: 10,
            checksum: Checksum.sha256("d".repeat(64)),
            purpose: "media",
            noteId: NoteId.create(`note-of-${id}`),
            uploadedBy: UserId.create(userId),
          },
          h.clock.now(),
        );
        await ctx.storedFileRepository.insert(registered.entity);
      }
    },
  );
};

const seedAuthorRoutes = (h: TestHarness, userId: string, count: number) => {
  for (let i = 0; i < count; i += 1) {
    const noteId = `note-${String(i).padStart(3, "0")}`;
    h.backend.noteRoutes.set(noteId, {
      noteId,
      scope: scopeOf(userId),
      createdBy: UserId.create(userId),
      routeVersion: 1,
      state: "active",
      target: null,
      migrationId: null,
      lastMigrationId: null,
      operationId: null,
      expiresAt: null,
    });
  }
};

const tombstoneEvents = (h: TestHarness) =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.user.deleted");

const itemsOf = (h: TestHarness, operationId: string) =>
  h.backend.manifestItems
    .values()
    .filter((item) => item.operationId === operationId);

describe("deleteAccount recovery", () => {
  it("carries the deletion to completion after a build turn is delivered twice", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    seedAuthorRoutes(h, userId, 120);
    await seedFiles(h, userId, 150);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });

    // The first membership turn commits, its response is lost, and the
    // relay hands the very same turn over again.
    const replayed = {
      type: "identity.accountDeletionManifestBuildContinued",
      operationId,
      phase: "memberships",
      cursor: null,
    } as const;
    await continueAccountDeletionManifestBuild(h.workerContainer, replayed);
    await continueAccountDeletionManifestBuild(h.workerContainer, replayed);

    expect(await runUntilSettled(h, operationId)).toBe("completed");
    expect(h.backend.manifestHeaders.get(operationId)?.status).toBe(
      "completed",
    );
    // Compaction is what empties the manifest, and only the turn that
    // finds it empty terminates the header — so a fixed target the replay
    // had duplicated would have kept the header out of `completed`.
    expect(itemsOf(h, operationId)).toHaveLength(0);
    expect(tombstoneEvents(h)).toHaveLength(1);
    expect(h.backend.users.get(userId)?.status).toBe("deleted");
    expect(h.backend.scope(scopeOf(userId)).storedFiles.values()).toHaveLength(
      0,
    );
  });

  it("carries the deletion to completion after a cleanup command is redelivered", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedFiles(h, userId, 150);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });

    // One relay round takes the manifest to `built` and dispatches the
    // first cleanup command; the same command then arrives a second time.
    await runDispatchAfterBuild(h, operationId);

    expect(await runUntilSettled(h, operationId)).toBe("completed");
    expect(h.backend.scope(scopeOf(userId)).storedFiles.values()).toHaveLength(
      0,
    );
    expect(
      h.backend.manifestHeaders.get(operationId)?.receipts ?? [],
    ).toContain("personalCleanup");
    expect(tombstoneEvents(h)).toHaveLength(1);
  });

  it("does not fork the chain when the request is re-sent while it runs", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedFiles(h, userId, 150);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });

    // The browser never saw the 202 and posts the same request again;
    // the second call must join the operation rather than open one.
    const resent = await acceptDeletion(h, {
      userId,
      email: EMAIL,
      requestId: DELETION_REQUEST_ID,
    });

    expect(resent).toBe(operationId);
    expect(await runUntilSettled(h, operationId)).toBe("completed");
    expect(h.backend.distributedOperations.values()).toHaveLength(1);
    expect(h.backend.manifestHeaders.values()).toHaveLength(1);
    expect(tombstoneEvents(h)).toHaveLength(1);
  });
});

/**
 * Plays the build by hand and then delivers the first cleanup command
 * twice — the shape a queue takes when the ack of a dispatched command is
 * lost on the way back.
 */
async function runDispatchAfterBuild(
  h: TestHarness,
  operationId: string,
): Promise<void> {
  for (const phase of ["memberships", "authorRoutes"] as const) {
    await continueAccountDeletionManifestBuild(h.workerContainer, {
      type: "identity.accountDeletionManifestBuildContinued",
      operationId,
      phase,
      cursor: null,
    });
  }
  for (let delivery = 0; delivery < 2; delivery += 1) {
    await dispatchAccountDeletionCleanup(h.workerContainer, {
      type: "identity.accountDeletionDispatchContinued",
      operationId,
      phase: "cleanup",
      cursor: null,
    });
  }
}
