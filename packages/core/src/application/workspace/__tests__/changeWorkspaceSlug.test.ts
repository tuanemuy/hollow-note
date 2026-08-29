import type { ScopeKey } from "@repo/core/application/scope";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import { isConflictError } from "../../errors";
import type { ScopeUnitOfWorkContext } from "../../execution/unitOfWork";
import { changeMemberRole } from "../changeMemberRole";
import { changeWorkspaceSlug } from "../changeWorkspaceSlug";
import { checkWorkspaceSlugAvailability } from "../checkWorkspaceSlugAvailability";
import { getPublicWorkspace } from "../getPublicWorkspace";
import {
  clearDirectoryOutages,
  createWorkspaceHarness,
  directoryRow,
  expectBusinessRule,
  expectConflict,
  expectNotFound,
  induceDirectoryOutage,
  outboxPayloads,
  outboxTypes,
  removeWorkspaceRow,
  seedWorkspace,
  slugReservations,
  storedWorkspace,
  type TestHarness,
  withFailingDirectoryProjection,
} from "./harness";

/** spec/testcases/workspace/changeWorkspaceSlug.md (TC-workspace-046〜054). */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const SECOND_OWNER = "owner-2";
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

const availability = (h: TestHarness, slug: string) =>
  checkWorkspaceSlugAvailability({
    container: h.container,
    input: { slug },
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

  /**
   * Clearing the slug hands the key to nobody, so `release` is the step
   * that frees it — and an `active` reservation carries no expiry, which
   * makes a lost response the one failure that would keep the key from
   * every workspace in the service for good.
   */
  it("TC-workspace-048: a lost release response is retried once and the key is freed within the request", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const inner = h.container.workspaceSlugReservationStore;
    let attempts = 0;
    const container: RequestContainer = {
      ...h.container,
      workspaceSlugReservationStore: {
        ...inner,
        release: async (input) => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("release response lost");
          }
          await inner.release(input);
        },
      },
    };

    await expect(change(h, null, OWNER, container)).resolves.toMatchObject({
      slug: null,
      previousSlug: "old-slug",
    });

    expect(attempts).toBe(2);
    expect(slugReservations(h)).toEqual([]);
    expect(directoryRow(h, WORKSPACE)?.slug).toBeNull();
  });

  it("TC-workspace-048: a release lost for good is reclaimed by re-sending the cleared slug", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const inner = h.container.workspaceSlugReservationStore;
    const releaseFailure = new Error("reservation shard unreachable");
    const failingRelease: RequestContainer = {
      ...h.container,
      workspaceSlugReservationStore: {
        ...inner,
        release: () => Promise.reject(releaseFailure),
      },
    };

    await expect(change(h, null, OWNER, failingRelease)).rejects.toBe(
      releaseFailure,
    );

    // The scope gave the slug up, the global plane did not: the key is
    // still `active` for this workspace and no expiry will collect it.
    expect(storedWorkspace(h, WORKSPACE)?.slug).toBeNull();
    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([["old-slug", WORKSPACE, "active"]]);
    await expect(availability(h, "old-slug")).resolves.toMatchObject({
      available: false,
    });

    await expect(change(h, null)).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: null,
      previousSlug: null,
    });

    expect(slugReservations(h)).toEqual([]);
    expect(directoryRow(h, WORKSPACE)?.slug).toBeNull();
    await expect(availability(h, "old-slug")).resolves.toEqual({
      slug: "old-slug",
      available: true,
      ownedBySelf: false,
    });
    // The repair writes nothing to the scope, so it emits nothing either.
    expect(outboxTypes(h)).toEqual(["workspace.slugChanged"]);
    expect(storedWorkspace(h, WORKSPACE)?.version).toBe(1);
  });

  /**
   * The directory row is the only record of the key the scope has left
   * behind, so the repair has to free the key before it overwrites that
   * row — a projection landing first would erase the trail while the
   * reservation is still held.
   */
  it("TC-workspace-048: a repair that fails again keeps the trail to the stranded key", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const inner = h.container.workspaceSlugReservationStore;
    const releaseFailure = new Error("reservation shard unreachable");
    const failingRelease: RequestContainer = {
      ...h.container,
      workspaceSlugReservationStore: {
        ...inner,
        release: () => Promise.reject(releaseFailure),
      },
    };

    await expect(change(h, null, OWNER, failingRelease)).rejects.toBe(
      releaseFailure,
    );
    await expect(change(h, null, OWNER, failingRelease)).rejects.toBe(
      releaseFailure,
    );

    expect(directoryRow(h, WORKSPACE)?.slug).toBe("old-slug");

    await expect(change(h, null)).resolves.toMatchObject({ slug: null });
    expect(slugReservations(h)).toEqual([]);
    await expect(availability(h, "old-slug")).resolves.toMatchObject({
      available: true,
    });
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
   * The two steps that follow the local commit — the reservation's
   * activation and the directory snapshot — can both be lost while the
   * scope has already moved to the new slug. Re-sending that slug is the
   * request that repairs them.
   */
  it("TC-workspace-307: re-sending the slug repairs an activation that was lost for good", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { publication: "published" });

    const inner = h.container.workspaceSlugReservationStore;
    const activateFailure = new Error("reservation shard unreachable");
    await expect(
      change(h, "team-alpha", OWNER, {
        ...h.container,
        workspaceSlugReservationStore: {
          ...inner,
          activate: () => Promise.reject(activateFailure),
        },
      }),
    ).rejects.toBe(activateFailure);

    // The scope moved, the global plane did not: the new URL resolves
    // nowhere and the directory still advertises the old slug.
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      slug: "team-alpha",
      version: 2,
    });
    expect(slugReservations(h).map((row) => [row.slug, row.state])).toEqual([
      ["old-slug", "active"],
      ["team-alpha", "reserved"],
    ]);
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("old-slug");
    await expectNotFound(
      getPublicWorkspace({
        container: h.container,
        input: { slug: "team-alpha" },
      }),
    );

    await expect(change(h, "team-alpha")).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: "team-alpha",
      previousSlug: "team-alpha",
    });

    // The exchange the failed attempt never completed: the old key is
    // freed by the repair, so one URL resolves, not two.
    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([["team-alpha", WORKSPACE, "active"]]);
    expect(directoryRow(h, WORKSPACE)).toMatchObject({
      slug: "team-alpha",
      sourceVersion: 2,
    });
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
    // The repair emits nothing: the scope was already where it belongs.
    expect(outboxTypes(h)).toEqual(["workspace.slugChanged"]);
    expect(storedWorkspace(h, WORKSPACE)?.version).toBe(2);
  });

  /**
   * `previousSlug` is the scope's view of the rename being made now, and
   * a rename whose activation was lost for good moved the scope without
   * moving the global plane. From then on the key nobody freed is named
   * only by the directory row — and the next change overwrites that row,
   * so a key the exchange does not free here is stranded with no expiry
   * and no way left to find it.
   */
  it("TC-workspace-314: a change to a different slug frees the key the directory still advertises", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const inner = h.container.workspaceSlugReservationStore;
    const activateFailure = new Error("reservation shard unreachable");
    await expect(
      change(h, "team-alpha", OWNER, {
        ...h.container,
        workspaceSlugReservationStore: {
          ...inner,
          activate: () => Promise.reject(activateFailure),
        },
      }),
    ).rejects.toBe(activateFailure);

    expect(storedWorkspace(h, WORKSPACE)?.slug).toBe("team-alpha");
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("old-slug");

    // The scope is on `team-alpha`, so `previousSlug` names that — but
    // the key still held is `old-slug`.
    await expect(change(h, "team-gamma")).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: "team-gamma",
      previousSlug: "team-alpha",
    });

    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([
      // Left to lapse: a `reserved` row carries an expiry, unlike the key
      // the exchange had to free here.
      ["team-alpha", WORKSPACE, "reserved"],
      ["team-gamma", WORKSPACE, "active"],
    ]);
    await expect(availability(h, "old-slug")).resolves.toEqual({
      slug: "old-slug",
      available: true,
      ownedBySelf: false,
    });
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("team-gamma");
  });

  it("TC-workspace-315: clearing the slug frees the key the directory still advertises", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const inner = h.container.workspaceSlugReservationStore;
    const activateFailure = new Error("reservation shard unreachable");
    await expect(
      change(h, "team-alpha", OWNER, {
        ...h.container,
        workspaceSlugReservationStore: {
          ...inner,
          activate: () => Promise.reject(activateFailure),
        },
      }),
    ).rejects.toBe(activateFailure);

    await expect(change(h, null)).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: null,
      previousSlug: "team-alpha",
    });

    expect(storedWorkspace(h, WORKSPACE)?.slug).toBeNull();
    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([["team-alpha", WORKSPACE, "reserved"]]);
    await expect(availability(h, "old-slug")).resolves.toEqual({
      slug: "old-slug",
      available: true,
      ownedBySelf: false,
    });
    expect(directoryRow(h, WORKSPACE)?.slug).toBeNull();
  });

  /**
   * The mirror image of TC-workspace-314 / 315, and the state the two of
   * them are read against: there the activation was lost and the
   * directory stayed right, here the activation lands and the
   * *projection* is what is lost for good. The scope and the global key
   * both move to the new slug while the directory goes on advertising the
   * one before it — and nothing re-sends that snapshot, so this is where
   * the workspace stays until its owner saves again.
   */
  it("TC-workspace-316: a projection lost for good leaves the directory advertising a slug the global plane has already freed", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    await expect(
      change(h, "team-alpha", OWNER, withFailingDirectoryProjection(h)),
    ).rejects.toThrow("directory shard unreachable");

    expect(storedWorkspace(h, WORKSPACE)?.slug).toBe("team-alpha");
    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([["team-alpha", WORKSPACE, "active"]]);
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("old-slug");
    // The advertised key is free: whoever asks for it may have it.
    await expect(availability(h, "old-slug")).resolves.toMatchObject({
      available: true,
    });
  });

  /**
   * From that state the directory names a key nobody holds, while the key
   * the workspace does hold is named only by the scope. A rename that
   * picks one candidate frees the wrong one — and `team-alpha` is
   * `active`, so it carries no expiry and no later request can reach it
   * once the projection overwrites the row it was read from.
   */
  it("TC-workspace-317: after a lost projection, a change to a third slug still frees the key the workspace holds", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await expect(
      change(h, "team-alpha", OWNER, withFailingDirectoryProjection(h)),
    ).rejects.toThrow("directory shard unreachable");

    await expect(change(h, "team-gamma")).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: "team-gamma",
      previousSlug: "team-alpha",
    });

    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([["team-gamma", WORKSPACE, "active"]]);
    await expect(availability(h, "team-alpha")).resolves.toEqual({
      slug: "team-alpha",
      available: true,
      ownedBySelf: false,
    });
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("team-gamma");
  });

  it("TC-workspace-318: after a lost projection, clearing the slug still frees the key the workspace holds", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    await expect(
      change(h, "team-alpha", OWNER, withFailingDirectoryProjection(h)),
    ).rejects.toThrow("directory shard unreachable");

    await expect(change(h, null)).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: null,
      previousSlug: "team-alpha",
    });

    expect(storedWorkspace(h, WORKSPACE)?.slug).toBeNull();
    expect(slugReservations(h)).toEqual([]);
    await expect(availability(h, "team-alpha")).resolves.toEqual({
      slug: "team-alpha",
      available: true,
      ownedBySelf: false,
    });
    expect(directoryRow(h, WORKSPACE)?.slug).toBeNull();
  });

  /**
   * A repair that ran while the directory shard was unreadable had no key
   * to hand the exchange, so it activated the new one beside the old:
   * the workspace ends up holding two `active` reservations, neither of
   * which expires. From then on the reservation for the scope's own slug
   * points at this workspace, so a repair that decides what to do purely
   * from that answer never looks at the other key again — the release
   * has to be evaluated on every call, not behind the skip that covers
   * the re-reservation.
   */
  it("TC-workspace-324: a repair that skips the re-reservation still frees the key the directory advertises", async () => {
    const h = createWorkspaceHarness();
    await seed(h);

    const inner = h.container.workspaceSlugReservationStore;
    const activateFailure = new Error("reservation shard unreachable");
    await expect(
      change(h, "team-alpha", OWNER, {
        ...h.container,
        workspaceSlugReservationStore: {
          ...inner,
          activate: () => Promise.reject(activateFailure),
        },
      }),
    ).rejects.toBe(activateFailure);

    induceDirectoryOutage(h, WORKSPACE);
    await expect(
      change(h, "team-alpha", OWNER, withFailingDirectoryProjection(h)),
    ).rejects.toThrow("directory shard unreachable");
    clearDirectoryOutages(h);

    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([
      ["old-slug", WORKSPACE, "active"],
      ["team-alpha", WORKSPACE, "active"],
    ]);
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("old-slug");

    await expect(change(h, "team-alpha")).resolves.toEqual({
      workspaceId: WORKSPACE,
      slug: "team-alpha",
      previousSlug: "team-alpha",
    });

    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([["team-alpha", WORKSPACE, "active"]]);
    await expect(availability(h, "old-slug")).resolves.toEqual({
      slug: "old-slug",
      available: true,
      ownedBySelf: false,
    });
    expect(directoryRow(h, WORKSPACE)?.slug).toBe("team-alpha");
  });

  /**
   * The state TC-workspace-324 builds, read from the other side. The
   * workspace holds two `active` keys and the directory advertises the
   * one the scope has already left — which makes that key the only one
   * the public URL still resolves through. A change to a third slug
   * gives it up, but only the exchange may open the successor, so
   * handing it back before `activate` lands is the window in which
   * neither URL resolves.
   */
  it("TC-workspace-327: a change whose activation never lands keeps the key the directory advertises", async () => {
    const h = createWorkspaceHarness();
    await seed(h, { publication: "published" });

    const inner = h.container.workspaceSlugReservationStore;
    const activateFailure = new Error("reservation shard unreachable");
    const losingActivate: RequestContainer = {
      ...h.container,
      workspaceSlugReservationStore: {
        ...inner,
        activate: () => Promise.reject(activateFailure),
      },
    };

    await expect(change(h, "team-alpha", OWNER, losingActivate)).rejects.toBe(
      activateFailure,
    );
    induceDirectoryOutage(h, WORKSPACE);
    await expect(
      change(h, "team-alpha", OWNER, withFailingDirectoryProjection(h)),
    ).rejects.toThrow("directory shard unreachable");
    clearDirectoryOutages(h);

    await expect(change(h, "team-gamma", OWNER, losingActivate)).rejects.toBe(
      activateFailure,
    );

    expect(
      slugReservations(h).map((row) => [row.slug, row.workspaceId, row.state]),
    ).toEqual([
      ["old-slug", WORKSPACE, "active"],
      ["team-alpha", WORKSPACE, "active"],
      ["team-gamma", WORKSPACE, "reserved"],
    ]);
    // The public page is still reachable through the URL the directory
    // hands out, which is the whole point of not freeing it first.
    await expect(
      getPublicWorkspace({
        container: h.container,
        input: { slug: "old-slug" },
      }),
    ).resolves.toMatchObject({ name: "Team Alpha" });
  });

  /**
   * Two attempts at the same rename share one reservation row, because
   * the operation id is derived from `(workspaceId, slug)`. The loser
   * must therefore not compensate: dropping the row the winner is about
   * to activate would leave the scope holding a slug the global plane has
   * no reservation for.
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

  /**
   * The winner's commit is not what protects the shared row — an attempt
   * refused before any commit lands has to keep its hands off too. The
   * refusals that reach here are all of that kind: a role lost between the
   * two reads, a deletion barrier, an operation lock.
   */
  it("TC-workspace-306: an attempt refused for a reason of its own leaves the winner's reservation alone", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      name: "Team Alpha",
      slug: "old-slug",
      members: [
        { userId: OWNER, role: "owner", membershipId: "m-owner" },
        { userId: SECOND_OWNER, role: "owner", membershipId: "m-owner-2" },
      ],
    });

    const inner = h.container.workspaceSlugReservationStore;
    const innerUnitOfWork = h.container.scopeUnitOfWorkProvider;

    let openGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let announceReserved = (): void => {};
    const reserved = new Promise<void>((resolve) => {
      announceReserved = resolve;
    });
    const refusedContainer: RequestContainer = {
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
    const refused = change(
      h,
      "team-alpha",
      SECOND_OWNER,
      refusedContainer,
    ).catch((error: unknown) => error);
    await reserved;

    // The second owner is demoted while their change is still in flight,
    // so the in-transaction check refuses it — no OCC conflict involved.
    await changeMemberRole({
      container: h.container,
      input: {
        workspaceId: WORKSPACE,
        actorUserId: OWNER,
        membershipId: "m-owner-2",
        role: "viewer",
      },
    });

    let raced = false;
    const winnerContainer: RequestContainer = {
      ...h.container,
      workspaceSlugReservationStore: {
        ...inner,
        activate: async (input) => {
          if (!raced) {
            raced = true;
            openGate();
            await refused;
          }
          await inner.activate(input);
        },
      },
    };

    await expect(
      change(h, "team-alpha", OWNER, winnerContainer),
    ).resolves.toMatchObject({ slug: "team-alpha" });

    expect(raced).toBe(true);
    expect(await refused).toSatisfy(
      (error: unknown) =>
        isBusinessRuleError(error) && error.code === INSUFFICIENT_ROLE,
    );
    expect(slugReservations(h)).toEqual([
      expect.objectContaining({
        slug: "team-alpha",
        workspaceId: WORKSPACE,
        state: "active",
      }),
    ]);
    expect(storedWorkspace(h, WORKSPACE)).toMatchObject({
      slug: "team-alpha",
    });
  });

  it("a workspace whose row the deletion saga removed is WORKSPACE_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seed(h);
    removeWorkspaceRow(h, WORKSPACE);

    await expectNotFound(change(h, "team-alpha"));
  });
});
