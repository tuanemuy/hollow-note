import { isBusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import type { AvatarUrl } from "@repo/core/domain/identity/valueObject";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { WorkspaceErrorCode } from "../errorCode";
import { WorkspaceSlug } from "../valueObject";
import {
  type PrivateWorkspace,
  type PublishedWorkspace,
  Workspace,
} from "../workspace";

/**
 * Covers the private / published × active / deleting state space and the
 * transitions between its members.
 */

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T1 = new Date("2026-01-02T00:00:00.000Z");
const OWNER = UserId.create("owner-1");
const AVATAR = "/storage/avatar.png" as AvatarUrl;

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

const create = (slug: string | null = null): PrivateWorkspace =>
  Workspace.create(
    { id: "ws-1", ownerId: OWNER, name: "Team", description: "", slug },
    T0,
  ).entity;

const published = (): PublishedWorkspace =>
  Workspace.publish(create("team-alpha"), T0).entity;

describe("Workspace.create", () => {
  it("starts private, active, at version 0 and emits workspace.created", () => {
    const { entity, eventDrafts } = Workspace.create(
      {
        id: "ws-1",
        ownerId: OWNER,
        name: "  Team  ",
        description: "desc",
        slug: "Team-Alpha",
      },
      T0,
    );

    expect(entity).toMatchObject({
      id: "ws-1",
      name: "Team",
      description: "desc",
      slug: "team-alpha",
      avatarUrl: null,
      publication: "private",
      lifecycle: { state: "active" },
      version: 0,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(eventDrafts).toEqual([
      {
        type: "workspace.created",
        payload: { workspaceId: "ws-1", ownerId: OWNER },
        occurredAt: T0,
        aggregateId: "ws-1",
      },
    ]);
  });

  it("propagates the value objects' verdicts before any event is drafted", () => {
    expect(
      codeOf(() =>
        Workspace.create(
          { id: "ws-1", ownerId: OWNER, name: "", description: "", slug: null },
          T0,
        ),
      ),
    ).toBe(WorkspaceErrorCode.InvalidName);
    expect(
      codeOf(() =>
        Workspace.create(
          {
            id: "ws-1",
            ownerId: OWNER,
            name: "Team",
            description: "",
            slug: "settings",
          },
          T0,
        ),
      ),
    ).toBe(WorkspaceErrorCode.SlugReserved);
  });
});

describe("Workspace.updateProfile", () => {
  it("emits workspace.profileUpdated only when the name actually changes", () => {
    const workspace = create();

    const renamed = Workspace.updateProfile(workspace, { name: "Renamed" }, T1);
    expect(renamed.entity.name).toBe("Renamed");
    expect(renamed.entity.version).toBe(1);
    expect(renamed.eventDrafts).toEqual([
      {
        type: "workspace.profileUpdated",
        payload: { workspaceId: "ws-1", name: "Renamed" },
        occurredAt: T1,
        aggregateId: "ws-1",
      },
    ]);

    const described = Workspace.updateProfile(
      workspace,
      { description: "new description" },
      T1,
    );
    expect(described.entity.description).toBe("new description");
    expect(described.entity.version).toBe(1);
    expect(described.eventDrafts).toEqual([]);
  });

  it("treats a re-submitted identical name as no rename", () => {
    const { eventDrafts } = Workspace.updateProfile(
      create(),
      { name: "Team" },
      T1,
    );
    expect(eventDrafts).toEqual([]);
  });

  it("distinguishes an omitted avatarUrl from an explicit null", () => {
    const withAvatar = Workspace.updateProfile(
      create(),
      { avatarUrl: AVATAR },
      T1,
    ).entity;
    expect(withAvatar.avatarUrl).toBe(AVATAR);

    expect(
      Workspace.updateProfile(withAvatar, { name: "Team" }, T1).entity
        .avatarUrl,
    ).toBe(AVATAR);
    expect(
      Workspace.updateProfile(withAvatar, { avatarUrl: null }, T1).entity
        .avatarUrl,
    ).toBeNull();
  });

  it("keeps a published workspace published", () => {
    const next = Workspace.updateProfile(
      published(),
      { name: "Renamed" },
      T1,
    ).entity;
    expect(next.publication).toBe("published");
    expect(Workspace.isPublished(next) && next.publishedAt).toEqual(T0);
  });
});

describe("Workspace.changeSlug", () => {
  it("is a no-op — no version bump, no event — for the slug already held", () => {
    const workspace = create("team-alpha");
    const result = Workspace.changeSlug(workspace, "Team-Alpha", T1);
    expect(result.entity).toBe(workspace);
    expect(result.eventDrafts).toEqual([]);
  });

  it("emits workspace.slugChanged carrying both the old and the new slug", () => {
    const result = Workspace.changeSlug(create("team-alpha"), "team-beta", T1);
    expect(result.entity.slug).toBe("team-beta");
    expect(result.entity.version).toBe(1);
    expect(result.eventDrafts).toEqual([
      {
        type: "workspace.slugChanged",
        payload: {
          workspaceId: "ws-1",
          previousSlug: "team-alpha",
          currentSlug: "team-beta",
        },
        occurredAt: T1,
        aggregateId: "ws-1",
      },
    ]);
  });

  it("lets a private workspace drop its slug", () => {
    const result = Workspace.changeSlug(create("team-alpha"), null, T1);
    expect(result.entity.slug).toBeNull();
    expect(result.eventDrafts[0]?.payload).toEqual({
      workspaceId: "ws-1",
      previousSlug: "team-alpha",
      currentSlug: null,
    });
  });

  it("refuses to drop the slug of a published workspace", () => {
    expect(codeOf(() => Workspace.changeSlug(published(), null, T1))).toBe(
      WorkspaceErrorCode.PublishedWorkspaceRequiresSlug,
    );
  });
});

describe("Workspace.publish / unpublish", () => {
  it("refuses to publish without a slug", () => {
    expect(codeOf(() => Workspace.publish(create(null), T1))).toBe(
      WorkspaceErrorCode.SlugRequiredToPublish,
    );
  });

  it("stamps publishedAt, bumps the version and emits workspace.published", () => {
    const result = Workspace.publish(create("team-alpha"), T1);
    expect(result.entity).toMatchObject({
      publication: "published",
      slug: "team-alpha",
      publishedAt: T1,
      version: 1,
      updatedAt: T1,
    });
    expect(result.eventDrafts).toEqual([
      {
        type: "workspace.published",
        payload: { workspaceId: "ws-1", slug: "team-alpha" },
        occurredAt: T1,
        aggregateId: "ws-1",
      },
    ]);
  });

  it("keeps the slug on unpublish so the same URL can be reclaimed", () => {
    const result = Workspace.unpublish(published(), T1);
    expect(result.entity).toMatchObject({
      publication: "private",
      slug: "team-alpha",
      version: 2,
    });
    expect("publishedAt" in result.entity).toBe(false);
    expect(result.eventDrafts).toEqual([
      {
        type: "workspace.unpublished",
        payload: { workspaceId: "ws-1" },
        occurredAt: T1,
        aggregateId: "ws-1",
      },
    ]);
  });
});

describe("Workspace.reconstruct", () => {
  const base = {
    id: "ws-1",
    name: "Team",
    description: "",
    version: 3,
    createdAt: T0,
    updatedAt: T1,
  } as const;

  it("round-trips an active private row", () => {
    const workspace = Workspace.reconstruct({
      ...base,
      publication: "private",
      lifecycleState: "active",
    });
    expect(workspace).toMatchObject({
      publication: "private",
      slug: null,
      avatarUrl: null,
      lifecycle: { state: "active" },
      version: 3,
    });
  });

  it("round-trips a deleting row together with its operation id", () => {
    const workspace = Workspace.reconstruct({
      ...base,
      publication: "private",
      lifecycleState: "deleting",
      deletionOperationId: "op-1",
    });
    expect(workspace.lifecycle).toEqual({
      state: "deleting",
      operationId: "op-1",
    });
  });

  it("refuses a published row with no slug", () => {
    expect(() =>
      Workspace.reconstruct({
        ...base,
        publication: "published",
        publishedAt: T1,
        lifecycleState: "active",
      }),
    ).toThrow(RehydrationError);
  });

  it("refuses a published row with no publishedAt", () => {
    expect(() =>
      Workspace.reconstruct({
        ...base,
        slug: "team-alpha",
        publication: "published",
        lifecycleState: "active",
      }),
    ).toThrow(RehydrationError);
  });

  it("refuses a deleting row with no operation id", () => {
    expect(() =>
      Workspace.reconstruct({
        ...base,
        publication: "private",
        lifecycleState: "deleting",
      }),
    ).toThrow(RehydrationError);
  });

  it("refuses unknown publication and lifecycle values", () => {
    expect(() =>
      Workspace.reconstruct({
        ...base,
        publication: "draft",
        lifecycleState: "active",
      }),
    ).toThrow(RehydrationError);
    expect(() =>
      Workspace.reconstruct({
        ...base,
        publication: "private",
        lifecycleState: "archived",
      }),
    ).toThrow(RehydrationError);
  });

  it("accepts a published row and keeps its slug", () => {
    const workspace = Workspace.reconstruct({
      ...base,
      slug: "Team-Alpha",
      publication: "published",
      publishedAt: T1,
      lifecycleState: "active",
    });
    expect(Workspace.isPublished(workspace)).toBe(true);
    expect(workspace.slug).toBe("team-alpha");
    expect(WorkspaceSlug.create("team-alpha")).toBe(workspace.slug);
  });
});
