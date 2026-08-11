import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import type { NoteProjectionEntry } from "@repo/core/domain/note/ports/localNoteProjectionWriter";
import { WITHDRAWN_AUTHOR_DISPLAY_NAME } from "@repo/core/domain/note/ports/localNoteProjectionWriter";
import { NoteId, NoteOwner } from "@repo/core/domain/note/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { dispatchAccountDeletionRedaction } from "../deleteAccount/authorRedaction";
import { finalizeAccountDeletion } from "../deleteAccount/finalize";
import { signUpVerified } from "./authFlowHelpers";
import {
  acceptDeletion,
  buildDeletionManifest,
  drainDeletion,
} from "./deletionHarness";

const EMAIL = "user@example.com";
const AUTHOR_VERSION_BEFORE_DELETION = 1;

const noteKey = (i: number): string => `note-${String(i).padStart(4, "0")}`;

const scopeOf = (userId: string) => ScopeKey.user(UserId.create(userId));

const seedAuthorRoutes = (
  h: TestHarness,
  userId: string,
  count: number,
): void => {
  for (let i = 0; i < count; i += 1) {
    const noteId = noteKey(i);
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

const projectionEntry = (
  h: TestHarness,
  userId: string,
  noteId: string,
): NoteProjectionEntry => ({
  noteId: NoteId.create(noteId),
  owner: NoteOwner.user(UserId.create(userId)),
  createdBy: UserId.create(userId),
  author: {
    displayName: "Alice",
    handle: "alice",
    version: AUTHOR_VERSION_BEFORE_DELETION,
  },
  workspace: null,
  title: "Note",
  text: "Body",
  excerpt: "Body",
  visibility: "public",
  contentStatus: "ready",
  styleMode: "default",
  hasSourceFile: false,
  lifecycle: "active",
  createdAt: h.clock.now(),
  updatedAt: h.clock.now(),
  trashedAt: null,
  purgeAfter: null,
});

/** Publishes a note on both planes as `projectNoteChanges` would. */
const seedProjection = async (
  h: TestHarness,
  userId: string,
  noteId: string,
): Promise<NoteProjectionEntry> => {
  const entry = projectionEntry(h, userId, noteId);
  const version = {
    projectionRevision: 1,
    authorVersion: AUTHOR_VERSION_BEFORE_DELETION,
    workspaceVersion: 0,
  };
  await h.container.scopeUnitOfWorkProvider.run(scopeOf(userId), (ctx) =>
    ctx.localNoteProjectionWriter.replaceSnapshotIfNewer(entry, [], version),
  );
  await h.workerContainer.publicNoteProjectionWriter.replaceSnapshotIfNewer(
    entry,
    [],
    { ...version, routeVersion: 1 },
  );
  return entry;
};

const authorRouteItems = (h: TestHarness, operationId: string) =>
  h.backend.manifestItems
    .values()
    .filter(
      (item) => item.operationId === operationId && item.kind === "authorRoute",
    );

const localAuthor = (h: TestHarness, userId: string, noteId: string) =>
  h.backend.scope(scopeOf(userId)).localProjection.get(noteId)?.entry.author;

const publicAuthor = (h: TestHarness, noteId: string) =>
  h.backend.publicProjection.get(noteId)?.entry.author;

const redactionTurn = (
  h: TestHarness,
  operationId: string,
  cursor: string | null,
) =>
  dispatchAccountDeletionRedaction(h.workerContainer, {
    type: "identity.accountDeletionDispatchContinued",
    operationId,
    phase: "redaction",
    cursor,
  });

const ackedCount = (h: TestHarness, operationId: string): number =>
  authorRouteItems(h, operationId).filter(
    (item) =>
      item.kind === "authorRoute" &&
      item.localRedactionAckedAt !== null &&
      item.publicRedactionAckedAt !== null,
  ).length;

/** The successor a redaction turn stored, as the relay would deliver it. */
const lastDispatch = (h: TestHarness) =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.accountDeletionDispatchContinued")
    .at(-1)?.payload as
    | Readonly<{ phase: string; cursor: string | null }>
    | undefined;

describe("deleteAccount author redaction", () => {
  it("TC-identity-081: 250 fixed routes are redacted 100 at a time, and finalize waits for the last plane ack", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    seedAuthorRoutes(h, userId, 250);
    await seedProjection(h, userId, noteKey(0));
    await seedProjection(h, userId, noteKey(249));
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    await buildDeletionManifest(h, operationId);
    expect(authorRouteItems(h, operationId)).toHaveLength(250);

    await redactionTurn(h, operationId, null);
    expect(ackedCount(h, operationId)).toBe(100);
    expect(lastDispatch(h)).toMatchObject({ phase: "redaction", cursor: "1" });
    // Nothing may finalize while a plane is still unacknowledged.
    await finalizeAccountDeletion(h.workerContainer, {
      type: "identity.accountDeletionDispatchContinued",
      operationId,
      phase: "finalize",
      cursor: null,
    });
    expect(h.backend.users.get(userId)?.status).toBe("deleting");

    await redactionTurn(h, operationId, "1");
    expect(ackedCount(h, operationId)).toBe(200);
    await redactionTurn(h, operationId, "2");

    expect(ackedCount(h, operationId)).toBe(250);
    expect(lastDispatch(h)).toMatchObject({ phase: "finalize" });
    expect(localAuthor(h, userId, noteKey(0))).toEqual({
      displayName: WITHDRAWN_AUTHOR_DISPLAY_NAME,
      handle: null,
      version: expect.any(Number),
    });
    expect(publicAuthor(h, noteKey(249))?.displayName).toBe(
      WITHDRAWN_AUTHOR_DISPLAY_NAME,
    );
  });

  it("TC-identity-082: a note event from before the deletion cannot restore the old author", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    seedAuthorRoutes(h, userId, 1);
    const entry = await seedProjection(h, userId, noteKey(0));
    await acceptDeletion(h, { userId, email: EMAIL });
    await drainDeletion(h);

    // The delayed projection of a pre-deletion note event, carrying the
    // author version it observed back then.
    const staleVersion = {
      projectionRevision: 2,
      authorVersion: AUTHOR_VERSION_BEFORE_DELETION,
      workspaceVersion: 0,
    };
    const local = await h.container.scopeUnitOfWorkProvider.run(
      scopeOf(userId),
      (ctx) =>
        ctx.localNoteProjectionWriter.replaceSnapshotIfNewer(
          entry,
          [],
          staleVersion,
        ),
    );
    const published =
      await h.workerContainer.publicNoteProjectionWriter.replaceSnapshotIfNewer(
        entry,
        [],
        { ...staleVersion, routeVersion: 1 },
      );

    expect(local).not.toBe("written");
    expect(published).not.toBe("written");
    expect(localAuthor(h, userId, noteKey(0))?.displayName).toBe(
      WITHDRAWN_AUTHOR_DISPLAY_NAME,
    );
    expect(localAuthor(h, userId, noteKey(0))?.handle).toBeNull();
    expect(publicAuthor(h, noteKey(0))?.displayName).toBe(
      WITHDRAWN_AUTHOR_DISPLAY_NAME,
    );
  });

  it("acknowledges both planes of a note whose route is already gone", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    seedAuthorRoutes(h, userId, 1);
    const operationId = await acceptDeletion(h, { userId, email: EMAIL });
    await buildDeletionManifest(h, operationId);
    h.backend.noteRoutes.delete(noteKey(0));

    await redactionTurn(h, operationId, null);

    expect(ackedCount(h, operationId)).toBe(1);
  });
});
