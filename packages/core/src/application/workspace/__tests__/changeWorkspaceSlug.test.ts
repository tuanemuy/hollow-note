import type { ScopeKey } from "@repo/core/application/scope";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import { isConflictError } from "../../errors";
import type { ScopeUnitOfWorkContext } from "../../execution/unitOfWork";
import { changeWorkspaceSlug } from "../changeWorkspaceSlug";
import { getPublicWorkspace } from "../getPublicWorkspace";
import {
  createWorkspaceHarness,
  directoryRow,
  expectBusinessRule,
  expectConflict,
  expectNotFound,
  outboxPayloads,
  outboxTypes,
  removeWorkspaceRow,
  seedWorkspace,
  slugReservations,
  storedWorkspace,
  type TestHarness,
} from "./harness";

/** spec/testcases/workspace/changeWorkspaceSlug.md (TC-workspace-046〜054). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

type SlugChangedPayload = Readonly<{
  workspaceId: string;
  previousSlug: string | null;
  currentSlug: string | null;
}>;

const change = (
  h: TestHarness,
  slug: string | null,
  userId = OWNER,
  container: RequestContainer = h.container,
) =>
  changeWorkspaceSlug({
    container,
    input: { workspaceId: WORKSPACE, userId, slug },
  });

const seed = (
  h: TestHarness,
  overrides: Parameters<typeof seedWorkspace>[1] = {},
) =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name: "Team Alpha",
    slug: "old-slug",
    members: [
      { userId: OWNER, role: "owner" },
      { userId: "editor-1", role: "editor" },
    ],
    ...overrides,
  });

const withFailingScopeCommit = (
  h: TestHarness,
  error: Error,
): RequestContainer => ({
  ...h.container,
  scopeUnitOfWorkProvider: {
    run: <T>(
      _scope: ScopeKey,
      _fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
    ): Promise<T> => Promise.reject(error),
  },
});

describe("changeWorkspaceSlug", () => {
  it("TC-workspace-046: an owner moves a private workspace to an unused slug and the old key is freed atomically", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const view = await change(h, "team-alpha");

    expect(view).toEqual({
      workspaceId: WORKSPACE,
      slug: "team-alpha",
      previousSlug: "old-slug",
    });
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      slug: "team-alpha",
      version: 1,
    });
    expect(outboxTypes(h)).toEqual(["workspace.slugChanged"]);
    expect(
      outboxPayloads<SlugChangedPayload>(h, "workspace.slugChanged"),
    ).toEqual([
      {
        workspaceId: WORKSPACE,
        previousSlug: "old-slug",
        currentSlug: "team-alpha",
      },
    ]);
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "team-alpha",
        workspaceId: WORKSPACE,
        state: "active",
        expiresAt: null,
      }),
    ]);
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      slug: "team-alpha",
      sourceVersion: 1,
    });
  });

  it("TC-workspace-047: a published workspace cannot drop its slug, and its reservation survives the refusal", async () => {
    const h = createWorkspaceHarness();
    const seeded = await seed(h, { publication: "published" });

    await expectBusinessRule(
      change(h, null),
      "WORKSPACE_PUBLISHED_REQUIRES_SLUG",
    );

    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      slug: "old-slug",
      publication: "published",
      version: seeded.workspace.version,
    });
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({ slug: "old-slug", state: "active" }),
    ]);
  });

  it("TC-workspace-048: a private workspace clears its slug and the global key is released", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const view = await change(h, null);

    expect(view).toEqual({
      workspaceId: WORKSPACE,
      slug: null,
      previousSlug: "old-slug",
    });
    expect(storedWorkspace(h, WORKSPACE)?.slug).toBeNull();
    expect(slugReservations(h)).toEqual([]);
    expect(directoryRow(h, WORKSPACE)?.slug).toBeNull();
    expect(
      outboxPayloads<SlugChangedPayload>(h, "workspace.slugChanged"),
    ).toEqual([
      { workspaceId: WORKSPACE, previousSlug: "old-slug", currentSlug: null },
    ]);
  });

  it("TC-workspace-049: a slug another workspace holds is SLUG_ALREADY_USED and nothing local moves", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await seedWorkspace(h, {
      workspaceId: "workspace-2",
      slug: "team-alpha",
      members: [{ userId: "other-owner", role: "owner" }],
    });

    await expectConflict(change(h, "team-alpha"), "SLUG_ALREADY_USED");

    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      slug: "old-slug",
      version: 0,
    });
    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([
      ["old-slug", WORKSPACE, "active"],
      ["team-alpha", "workspace-2", "active"],
    ]);
  });

  it("TC-workspace-050: re-sending the slug already held changes nothing and emits nothing", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const before = slugReservations(h);

    const view = await change(h, "old-slug");

    expect(view).toEqual({
      workspaceId: WORKSPACE,
      slug: "old-slug",
      previousSlug: "old-slug",
    });
    expect(storedWorkspace(h, WORKSPACE)?.version).toBe(0);
    expect(outboxTypes(h)).toEqual([]);
    expect(slugReservations(h)).toEqual(before);
    expect(directoryRow(h, WORKSPACE)?.sourceVersion).toBe(0);
  });

  it("TC-workspace-050: a differently-cased spelling of the same slug is also a no-op", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(change(h, "OLD-SLUG")).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: "old-slug",
      previousSlug: "old-slug",
    });
    expect(storedWorkspace(h, WORKSPACE)?.version).toBe(0);
    expect(outboxTypes(h)).toEqual([]);
  });

  it("TC-workspace-051: an editor is InsufficientRole and reserves nothing", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      change(h, "team-alpha", "editor-1"),
      INSUFFICIENT_ROLE,
    );

    expect(slugReservations(h)).toEqual([
      expect.objectContaining({ slug: "old-slug", state: "active" }),
    ]);
    expect(storedWorkspace(h, WORKSPACE)?.version).toBe(0);
  });

  it("TC-workspace-051: a non-member is InsufficientRole too", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expectBusinessRule(
      change(h, "team-alpha", "outsider-1"),
      INSUFFICIENT_ROLE,
    );
  });

  it("TC-workspace-052: after a published workspace is renamed the old public URL stops resolving", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { publication: "published" });

    await expect(
      getPublicWorkspace({
        container: h.container,
        input: { slug: "old-slug" },
      }),
    ).resolves.toMatchObject({ workspaceId: WORKSPACE });

    await change(h, "team-alpha");

    await expectNotFound(
      getPublicWorkspace({
        container: h.container,
        input: { slug: "old-slug" },
      }),
    );
    await expect(
      getPublicWorkspace({
        container: h.container,
        input: { slug: "team-alpha" },
      }),
    ).resolves.toMatchObject({ workspaceId: WORKSPACE, slug: "team-alpha" });
  });

  it("TC-workspace-053: a local update that never lands abandons the new reservation and keeps the old slug", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    const commitFailure = new Error("scope commit lost");

    await expect(
      change(h, "team-alpha", OWNER, withFailingScopeCommit(h, commitFailure)),
    ).rejects.toBe(commitFailure);

    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "old-slug",
        workspaceId: WORKSPACE,
        state: "active",
      }),
    ]);
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      slug: "old-slug",
      version: 0,
    });
    // The abandoned key is free again, so the retry succeeds.
    await expect(change(h, "team-alpha")).resolves.toMatchObject({
      slug: "team-alpha",
    });
  });

  it("TC-workspace-054: a lost activate response is replayed under the same operation id, releasing the old slug once", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const calls: {
      slug: string;
      operationId: string;
      releasing: string | null;
    }[] = [];
    const inner = h.container.workspaceSlugReservationStore;
    const container: RequestContainer = {
      ...h.container,
      workspaceSlugReservationStore: {
        ...inner,
        activate: async (input) => {
          calls.push({
            slug: input.slug,
            operationId: input.operationId,
            releasing: input.releasing,
          });
          if (calls.length === 1) {
            throw new Error("activate response lost");
          }
          await inner.activate(input);
        },
      },
    };

    await expect(change(h, "team-alpha", OWNER, container)).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: "team-alpha",
      previousSlug: "old-slug",
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[0]).toMatchObject({
      slug: "team-alpha",
      releasing: "old-slug",
    });
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "team-alpha",
        workspaceId: WORKSPACE,
        state: "active",
      }),
    ]);
    expect(directoryRow(h, WORKSPACE)).toMatchObject({ slug: "team-alpha" });
  });

  it("TC-workspace-054: the replayed reservation is the workspace's own row, so a re-issued change is not self-blocking", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    // First attempt reserves and commits nothing beyond the reservation.
    const commitFailure = new Error("scope commit lost");
    await expect(
      change(h, "team-alpha", OWNER, {
        ...h.container,
        scopeUnitOfWorkProvider: {
          run: <T>(): Promise<T> => Promise.reject(commitFailure),
        },
      }),
    ).rejects.toBe(commitFailure);

    // The derived operation id is stable, so re-issuing the same change
    // lands on the same row rather than colliding with it.
    await expect(change(h, "team-alpha")).resolves.toMatchObject({
      slug: "team-alpha",
      previousSlug: "old-slug",
    });
    expect(slugReservations(h)).toHaveLength(1);
  });

  /**
   * Two attempts at the same rename share one reservation row, because
   * the operation id is derived from `(workspaceId, slug)`. The loser
   * must therefore not compensate: dropping the row the winner is about
   * to activate would leave the scope holding a slug the global plane has
   * no reservation for — and re-sending the slug the workspace already
   * holds returns early, so nothing repairs it from the API.
   */
  it("TC-workspace-053: of two concurrent changes to the same slug, the loser abandons nothing", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const inner = h.container.workspaceSlugReservationStore;
    const innerUnitOfWork = h.container.scopeUnitOfWorkProvider;

    // The losing attempt observes the workspace and takes the shared
    // reservation, then holds at its commit.
    let openGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let announceReserved = (): void => {};
    const reserved = new Promise<void>((resolve) => {
      announceReserved = resolve;
    });
    const loserContainer: RequestContainer = {
      ...h.container,
      workspaceSlugReservationStore: {
        ...inner,
        reserve: async (input) => {
          await inner.reserve(input);
          announceReserved();
        },
      },
      scopeUnitOfWorkProvider: {
        run: async <T>(
          scope: ScopeKey,
          fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
        ): Promise<T> => {
          await gate;
          return innerUnitOfWork.run(scope, fn);
        },
      },
    };
    const loser = change(h, "team-alpha", OWNER, loserContainer).catch(
      (error: unknown) => error,
    );
    await reserved;

    // The winner commits, and the loser is let go while the shared row is
    // still `reserved` — the moment its `abandon` could take it.
    let raced = false;
    const winnerContainer: RequestContainer = {
      ...h.container,
      workspaceSlugReservationStore: {
        ...inner,
        activate: async (input) => {
          if (!raced) {
            raced = true;
            openGate();
            await loser;
          }
          await inner.activate(input);
        },
      },
    };

    await expect(
      change(h, "team-alpha", OWNER, winnerContainer),
    ).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: "team-alpha",
      previousSlug: "old-slug",
    });

    expect(raced).toBe(true);
    expect(await loser).toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE",
    );
    // The winner's key survived the loser's failure path, and the scope
    // and the reservation agree on it.
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      slug: "team-alpha",
      version: 1,
    });
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "team-alpha",
        workspaceId: WORKSPACE,
        state: "active",
      }),
    ]);
    expect(directoryRow(h, WORKSPACE)).toMatchObject({ slug: "team-alpha" });
  });

  it("a workspace whose row the deletion saga removed is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(change(h, "team-alpha"));
  });
});
