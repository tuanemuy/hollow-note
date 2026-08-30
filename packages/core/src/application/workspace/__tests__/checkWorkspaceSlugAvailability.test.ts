import {
  WorkspaceId,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { checkWorkspaceSlugAvailability } from "../checkWorkspaceSlugAvailability";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  seedWorkspace,
  type TestHarness,
} from "./harness";

/**
 * spec/testcases/workspace/checkWorkspaceSlugAvailability.md
 * (TC-workspace-281〜288).
 */

const MINE = "workspace-mine";
const THEIRS = "workspace-theirs";
const SLUG = "team-alpha";

const check = (h: TestHarness, slug: string, workspaceId?: string | null) =>
  checkWorkspaceSlugAvailability({
    container: h.container,
    input: workspaceId === undefined ? { slug } : { slug, workspaceId },
  });

const seedHolder = (h: TestHarness, workspaceId: string, slug: string) =>
  seedWorkspace(h, {
    workspaceId,
    slug,
    members: [{ userId: `owner-of-${workspaceId}`, role: "owner" }],
  });

describe("checkWorkspaceSlugAvailability", () => {
  it("TC-workspace-281: a slug nobody holds is available and not owned by the caller", async () => {
    const h = createWorkspaceHarness();
    await seedHolder(h, THEIRS, "someone-else");

    await expect(check(h, SLUG)).resolves.toEqual({
      slug: SLUG,
      available: true,
      ownedBySelf: false,
    });
  });

  it("TC-workspace-282: the caller's own slug is available and reported as its own", async () => {
    const h = createWorkspaceHarness();
    await seedHolder(h, MINE, SLUG);

    await expect(check(h, SLUG, MINE)).resolves.toEqual({
      slug: SLUG,
      available: true,
      ownedBySelf: true,
    });
  });

  it("TC-workspace-283: another workspace's slug is unavailable even with a workspaceId", async () => {
    const h = createWorkspaceHarness();
    await seedHolder(h, THEIRS, SLUG);
    await seedHolder(h, MINE, "mine-for-now");

    await expect(check(h, SLUG, MINE)).resolves.toEqual({
      slug: SLUG,
      available: false,
      ownedBySelf: false,
    });
  });

  it("TC-workspace-284: the creation form, with no workspaceId, sees the same refusal", async () => {
    const h = createWorkspaceHarness();
    await seedHolder(h, THEIRS, SLUG);

    await expect(check(h, SLUG)).resolves.toEqual({
      slug: SLUG,
      available: false,
      ownedBySelf: false,
    });
    await expect(check(h, SLUG, null)).resolves.toMatchObject({
      available: false,
      ownedBySelf: false,
    });
  });

  it("TC-workspace-285: the input is normalized before it is judged", async () => {
    const h = createWorkspaceHarness();
    await seedHolder(h, MINE, SLUG);

    await expect(check(h, "  Team-Alpha  ", MINE)).resolves.toEqual({
      slug: SLUG,
      available: true,
      ownedBySelf: true,
    });
  });

  it("TC-workspace-286: a slug another operation has only reserved reads as free", async () => {
    const h = createWorkspaceHarness();
    await h.container.workspaceSlugReservationStore.reserve({
      slug: WorkspaceSlug.create(SLUG),
      workspaceId: WorkspaceId.create(THEIRS),
      operationId: "in-flight",
      attemptId: "in-flight",
      expiresAt: new Date(h.clock.now().getTime() + 60_000),
    });

    await expect(check(h, SLUG)).resolves.toEqual({
      slug: SLUG,
      available: true,
      ownedBySelf: false,
    });
  });

  it("TC-workspace-287: a malformed slug is InvalidSlug", async () => {
    const h = createWorkspaceHarness();

    for (const slug of ["ab", "-team", "team-", "team alpha", "チーム"]) {
      await expectBusinessRule(check(h, slug), "WORKSPACE_INVALID_SLUG");
    }
  });

  it("TC-workspace-288: a reserved word is SlugReserved, told apart from a malformed one", async () => {
    const h = createWorkspaceHarness();

    for (const slug of ["new", "settings", "api", "search", "about", "New"]) {
      await expectBusinessRule(check(h, slug), "WORKSPACE_SLUG_RESERVED");
    }
  });
});
