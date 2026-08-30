import type { WithEventDrafts } from "@repo/core/domain/common/event";
import { Version } from "@repo/core/domain/common/version";
import { BusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import type { AvatarUrl, UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "./errorCode";
import { type WorkspaceEvent, WorkspaceEvents } from "./events";
import {
  WorkspaceDescription,
  WorkspaceId,
  WorkspaceName,
  WorkspaceSlug,
} from "./valueObject";

/**
 * Once `deleting` is entered the scope accepts no mutation other than the
 * continuation of the same operation, so the operation id is part of the
 * state rather than a separate nullable column.
 */
export type WorkspaceLifecycle =
  | Readonly<{ state: "active" }>
  | Readonly<{ state: "deleting"; operationId: string }>;

type WorkspaceBase = Readonly<{
  id: WorkspaceId;
  name: WorkspaceName;
  description: WorkspaceDescription;
  // Public URL, not a StoredFileId — keeps Workspace free of Storage.
  avatarUrl: AvatarUrl | null;
  slug: WorkspaceSlug | null;
  version: Version;
  lifecycle: WorkspaceLifecycle;
  createdAt: Date;
  updatedAt: Date;
}>;

export type PrivateWorkspace = WorkspaceBase &
  Readonly<{ publication: "private" }>;

/**
 * Narrows `slug` to non-null, which is what makes "published without a
 * slug" unrepresentable rather than a runtime check.
 */
export type PublishedWorkspace = WorkspaceBase &
  Readonly<{
    publication: "published";
    slug: WorkspaceSlug;
    publishedAt: Date;
  }>;

export type Workspace = PrivateWorkspace | PublishedWorkspace;

type ReconstructInput = Readonly<{
  id: string;
  name: string;
  description: string;
  avatarUrl?: string | null;
  slug?: string | null;
  publication: string;
  publishedAt?: Date | null;
  lifecycleState: string;
  deletionOperationId?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

const isPublished = (workspace: Workspace): workspace is PublishedWorkspace =>
  workspace.publication === "published";

const requireSlug = (slug: WorkspaceSlug | null): WorkspaceSlug => {
  if (slug === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.PublishedWorkspaceRequiresSlug,
      "A published workspace cannot drop its slug",
    );
  }
  return slug;
};

export const Workspace = {
  isPublished,

  create: (
    params: Readonly<{
      id: string;
      ownerId: UserId;
      name: string;
      description: string;
      slug: string | null;
    }>,
    now: Date,
  ): WithEventDrafts<PrivateWorkspace, WorkspaceEvent> => {
    const workspace: PrivateWorkspace = {
      publication: "private",
      id: WorkspaceId.create(params.id),
      name: WorkspaceName.create(params.name),
      description: WorkspaceDescription.create(params.description),
      avatarUrl: null,
      slug: params.slug === null ? null : WorkspaceSlug.create(params.slug),
      version: Version.initial(),
      lifecycle: { state: "active" },
      createdAt: now,
      updatedAt: now,
    };
    return {
      entity: workspace,
      eventDrafts: [
        WorkspaceEvents.workspaceCreated(workspace.id, params.ownerId, now),
      ],
    };
  },

  /**
   * `avatarUrl` arrives as a constructed value object because
   * `AvatarUrl.create` needs the app origin and an aggregate never reads
   * configuration.
   */
  updateProfile: (
    workspace: Workspace,
    params: Readonly<{
      name?: string;
      description?: string;
      avatarUrl?: AvatarUrl | null;
    }>,
    now: Date,
  ): WithEventDrafts<Workspace, WorkspaceEvent> => {
    const name =
      params.name !== undefined
        ? WorkspaceName.create(params.name)
        : workspace.name;
    const next: Workspace = {
      ...workspace,
      name,
      description:
        params.description !== undefined
          ? WorkspaceDescription.create(params.description)
          : workspace.description,
      avatarUrl:
        params.avatarUrl !== undefined ? params.avatarUrl : workspace.avatarUrl,
      version: Version.next(workspace.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts:
        name !== workspace.name
          ? [WorkspaceEvents.workspaceProfileUpdated(next.id, name, now)]
          : [],
    };
  },

  changeSlug: (
    workspace: Workspace,
    slug: string | null,
    now: Date,
  ): WithEventDrafts<Workspace, WorkspaceEvent> => {
    const nextSlug = slug === null ? null : WorkspaceSlug.create(slug);
    if (nextSlug === workspace.slug) {
      return { entity: workspace, eventDrafts: [] };
    }
    const bumped = { version: Version.next(workspace.version), updatedAt: now };
    const next: Workspace = isPublished(workspace)
      ? { ...workspace, ...bumped, slug: requireSlug(nextSlug) }
      : { ...workspace, ...bumped, slug: nextSlug };
    return {
      entity: next,
      eventDrafts: [
        WorkspaceEvents.workspaceSlugChanged(
          next.id,
          workspace.slug,
          nextSlug,
          now,
        ),
      ],
    };
  },

  publish: (
    workspace: PrivateWorkspace,
    now: Date,
  ): WithEventDrafts<PublishedWorkspace, WorkspaceEvent> => {
    if (workspace.slug === null) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.SlugRequiredToPublish,
        "A slug is required to publish a workspace",
      );
    }
    const next: PublishedWorkspace = {
      ...workspace,
      publication: "published",
      slug: workspace.slug,
      publishedAt: now,
      version: Version.next(workspace.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        WorkspaceEvents.workspacePublished(next.id, next.slug, now),
      ],
    };
  },

  /** The slug survives so re-publishing keeps the same public URL. */
  unpublish: (
    workspace: PublishedWorkspace,
    now: Date,
  ): WithEventDrafts<PrivateWorkspace, WorkspaceEvent> => {
    const { publishedAt: _publishedAt, ...rest } = workspace;
    const next: PrivateWorkspace = {
      ...rest,
      publication: "private",
      version: Version.next(workspace.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [WorkspaceEvents.workspaceUnpublished(next.id, now)],
    };
  },

  reconstruct: (input: ReconstructInput): Workspace => {
    try {
      const base: WorkspaceBase = {
        id: WorkspaceId.create(input.id),
        name: WorkspaceName.create(input.name),
        description: WorkspaceDescription.create(input.description),
        // Trusted as validated on write: `AvatarUrl.create` needs the app
        // origin, which a rehydration must not reach for.
        avatarUrl: (input.avatarUrl ?? null) as AvatarUrl | null,
        slug:
          input.slug !== undefined && input.slug !== null
            ? WorkspaceSlug.create(input.slug)
            : null,
        version: Version.create(input.version),
        lifecycle: reconstructLifecycle(input),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };
      switch (input.publication) {
        case "private":
          return { ...base, publication: "private" };
        case "published": {
          if (base.slug === null) {
            throw invalid("a published workspace requires a slug");
          }
          if (input.publishedAt === null || input.publishedAt === undefined) {
            throw invalid("a published workspace requires publishedAt");
          }
          return {
            ...base,
            publication: "published",
            slug: base.slug,
            publishedAt: input.publishedAt,
          };
        }
        default:
          throw invalid(`invalid publication: ${input.publication}`);
      }
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct Workspace ${input.id}`,
        error,
      );
    }
  },
};

function invalid(message: string): BusinessRuleError<WorkspaceErrorCode> {
  return new BusinessRuleError(WorkspaceErrorCode.InvalidId, message);
}

function reconstructLifecycle(input: ReconstructInput): WorkspaceLifecycle {
  switch (input.lifecycleState) {
    case "active":
      return { state: "active" };
    case "deleting": {
      const operationId = input.deletionOperationId;
      if (operationId === null || operationId === undefined) {
        throw invalid("a deleting workspace requires a deletion operation id");
      }
      return { state: "deleting", operationId };
    }
    default:
      throw invalid(`invalid lifecycle state: ${input.lifecycleState}`);
  }
}
