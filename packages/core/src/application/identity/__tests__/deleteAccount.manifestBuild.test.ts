import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { deleteAccount } from "../deleteAccount";
import type { AccountDeletionBuildPhase } from "../deleteAccount/input";
import { continueAccountDeletionManifestBuild } from "../deleteAccount/manifestBuild";
import { signUpVerified } from "./authFlowHelpers";

const EMAIL = "user@example.com";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

type BuildTurn = Readonly<{
  phase: AccountDeletionBuildPhase;
  cursor: string | null;
}>;

const accept = async (
  h: TestHarness,
): Promise<Readonly<{ userId: string; operationId: string }>> => {
  const { userId } = await signUpVerified(h, EMAIL);
  const view = await deleteAccount({
    container: h.container,
    input: {
      type: "userRequest",
      userId,
      confirmationEmail: EMAIL,
      requestId: REQUEST_ID,
    },
  });
  return { userId, operationId: view.operationId };
};

const seedMembershipEdges = (
  h: TestHarness,
  userId: string,
  count: number,
): void => {
  for (let i = 0; i < count; i += 1) {
    const edgeKey = `edge-${String(i).padStart(3, "0")}`;
    h.backend.membershipEdges.set(`${userId} ${edgeKey}`, {
      userId: UserId.create(userId),
      edgeKey,
      workspaceId: WorkspaceId.create(`ws-${i}`),
      edgeState: "active",
      membershipId: `membership-${i}`,
    });
  }
};

const seedAuthorRoutes = (
  h: TestHarness,
  userId: string,
  count: number,
): void => {
  for (let i = 0; i < count; i += 1) {
    const noteId = `note-${String(i).padStart(3, "0")}`;
    h.backend.noteRoutes.set(noteId, {
      noteId,
      scope: ScopeKey.user(UserId.create(userId)),
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

const continuations = (h: TestHarness) =>
  h.backend.outbox
    .values()
    .filter(
      (row) => row.type === "identity.accountDeletionManifestBuildContinued",
    );

/** The turn the chain is waiting on, as the relay would deliver it. */
const pending = (h: TestHarness): BuildTurn => {
  const payload = continuations(h).at(-1)?.payload;
  if (payload === undefined) {
    throw new Error("no build continuation was emitted");
  }
  return payload as BuildTurn;
};

const play = (h: TestHarness, operationId: string, turn: BuildTurn) =>
  continueAccountDeletionManifestBuild(h.workerContainer, {
    type: "identity.accountDeletionManifestBuildContinued",
    operationId,
    phase: turn.phase,
    cursor: turn.cursor,
  });

const itemsOf = (h: TestHarness, operationId: string, kind: string) =>
  h.backend.manifestItems
    .values()
    .filter((item) => item.operationId === operationId && item.kind === kind);

const header = (h: TestHarness, operationId: string) =>
  h.backend.manifestHeaders.get(operationId);

const dispatchContinuations = (h: TestHarness) =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.accountDeletionDispatchContinued");

describe("deleteAccount manifest build", () => {
  it("opens the manifest and asks for the first membership page as part of accepting", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await accept(h);

    expect(header(h, operationId)).toMatchObject({
      userId,
      status: "building",
      membershipCursor: null,
      authorRouteCursor: null,
    });
    expect(continuations(h)).toHaveLength(1);
    expect(pending(h)).toMatchObject({ phase: "memberships", cursor: null });
  });

  it("TC-identity-095: 250 membership edges are fixed as 100 + 100 + 50, each page storing its cursor", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await accept(h);
    seedMembershipEdges(h, userId, 250);

    await play(h, operationId, pending(h));
    expect(itemsOf(h, operationId, "membership")).toHaveLength(100);
    expect(header(h, operationId)?.membershipCursor).toBe("edge-099");
    expect(pending(h)).toMatchObject({
      phase: "memberships",
      cursor: "edge-099",
    });

    await play(h, operationId, pending(h));
    expect(itemsOf(h, operationId, "membership")).toHaveLength(200);
    expect(header(h, operationId)?.membershipCursor).toBe("edge-199");

    await play(h, operationId, pending(h));
    expect(itemsOf(h, operationId, "membership")).toHaveLength(250);
    expect(header(h, operationId)?.membershipCursor).toBeNull();
    // The wave is over, so the chain moves on to the author routes.
    expect(pending(h)).toMatchObject({ phase: "authorRoutes", cursor: null });
  });

  it("TC-identity-096: replaying a membership turn neither duplicates edges nor rewinds the page", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await accept(h);
    seedMembershipEdges(h, userId, 150);

    await play(h, operationId, pending(h));
    const lastPage = pending(h);
    await play(h, operationId, lastPage);
    // The commit landed but its response was lost, so the very same
    // continuation is delivered again.
    await play(h, operationId, lastPage);

    expect(itemsOf(h, operationId, "membership")).toHaveLength(150);
    expect(header(h, operationId)?.membershipCursor).toBeNull();
    expect(pending(h)).toMatchObject({ phase: "authorRoutes", cursor: null });
  });

  it("TC-identity-100: 250 author routes are fixed as 100 + 100 + 50 and then the manifest is built", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await accept(h);
    seedAuthorRoutes(h, userId, 250);

    await play(h, operationId, pending(h));
    expect(pending(h).phase).toBe("authorRoutes");

    await play(h, operationId, pending(h));
    expect(itemsOf(h, operationId, "authorRoute")).toHaveLength(100);
    expect(header(h, operationId)?.authorRouteCursor).not.toBeNull();

    await play(h, operationId, pending(h));
    expect(itemsOf(h, operationId, "authorRoute")).toHaveLength(200);

    await play(h, operationId, pending(h));
    expect(itemsOf(h, operationId, "authorRoute")).toHaveLength(250);
    expect(header(h, operationId)?.status).toBe("built");
    expect(dispatchContinuations(h).at(-1)?.payload).toMatchObject({
      operationId,
      phase: "cleanup",
    });
  });

  it("TC-identity-101: replaying an author-route turn resumes from the stored cursor without duplicates", async () => {
    const h = createTestHarness();
    const { userId, operationId } = await accept(h);
    seedAuthorRoutes(h, userId, 120);

    await play(h, operationId, pending(h));
    const firstRoutePage = pending(h);
    await play(h, operationId, firstRoutePage);
    // A redelivery of the page already fixed re-fixes the same targets.
    await play(h, operationId, firstRoutePage);
    const lastRoutePage = pending(h);
    await play(h, operationId, lastRoutePage);
    // And a turn delivered after `markBuilt` is a no-op.
    await play(h, operationId, lastRoutePage);

    expect(itemsOf(h, operationId, "authorRoute")).toHaveLength(120);
    expect(header(h, operationId)?.status).toBe("built");
    expect(dispatchContinuations(h)).toHaveLength(1);
  });

  it("builds an empty manifest when the user owns neither memberships nor routes", async () => {
    const h = createTestHarness();
    const { operationId } = await accept(h);

    await play(h, operationId, pending(h));
    await play(h, operationId, pending(h));

    expect(h.backend.manifestItems.values()).toHaveLength(0);
    expect(header(h, operationId)?.status).toBe("built");
  });
});
