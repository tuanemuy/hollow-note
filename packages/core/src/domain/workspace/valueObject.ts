import { BusinessRuleError } from "@repo/core/domain/error";
import { WorkspaceErrorCode } from "./errorCode";

declare const workspaceIdBrand: unique symbol;
declare const membershipIdBrand: unique symbol;
declare const invitationIdBrand: unique symbol;
declare const workspaceSlugBrand: unique symbol;
declare const workspaceNameBrand: unique symbol;
declare const workspaceDescriptionBrand: unique symbol;

const createId = <T>(id: string, brandCast: (v: string) => T): T => {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new BusinessRuleError(WorkspaceErrorCode.InvalidId, "Invalid id");
  }
  return brandCast(trimmed);
};

export type WorkspaceId = string & { readonly [workspaceIdBrand]: true };
export const WorkspaceId = {
  create: (id: string): WorkspaceId => createId(id, (v) => v as WorkspaceId),
};

export type MembershipId = string & { readonly [membershipIdBrand]: true };
export const MembershipId = {
  create: (id: string): MembershipId => createId(id, (v) => v as MembershipId),
};

export type InvitationId = string & { readonly [invitationIdBrand]: true };
export const InvitationId = {
  create: (id: string): InvitationId => createId(id, (v) => v as InvitationId),
};

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/;
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "new",
  "settings",
  "api",
  "search",
  "about",
]);

/** Public-URL slug of a workspace. Compared (and stored) in lowercase. */
export type WorkspaceSlug = string & { readonly [workspaceSlugBrand]: true };
export const WorkspaceSlug = {
  create: (raw: string): WorkspaceSlug => {
    const normalized = raw.trim().toLowerCase();
    // Reserved first: the reserved verdict is the actionable one for a
    // value that also happens to satisfy the shape rule.
    if (RESERVED_SLUGS.has(normalized)) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.SlugReserved,
        "Workspace slug is reserved",
      );
    }
    if (!SLUG_PATTERN.test(normalized)) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InvalidSlug,
        "Invalid workspace slug",
      );
    }
    return normalized as WorkspaceSlug;
  },
};

const NAME_MAX_LENGTH = 80;

export type WorkspaceName = string & { readonly [workspaceNameBrand]: true };
export const WorkspaceName = {
  create: (raw: string): WorkspaceName => {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_MAX_LENGTH) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InvalidName,
        "Invalid workspace name",
      );
    }
    return trimmed as WorkspaceName;
  },
};

const DESCRIPTION_MAX_LENGTH = 500;

export type WorkspaceDescription = string & {
  readonly [workspaceDescriptionBrand]: true;
};
export const WorkspaceDescription = {
  create: (raw: string): WorkspaceDescription => {
    if (raw.length > DESCRIPTION_MAX_LENGTH) {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InvalidDescription,
        "Invalid workspace description",
      );
    }
    return raw as WorkspaceDescription;
  },
};

export type WorkspaceRole = "owner" | "editor" | "viewer";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

export const WorkspaceRole = {
  create: (raw: string): WorkspaceRole => {
    if (raw !== "owner" && raw !== "editor" && raw !== "viewer") {
      throw new BusinessRuleError(
        WorkspaceErrorCode.InvalidRole,
        `Invalid workspace role: ${raw}`,
      );
    }
    return raw;
  },
  /** Role ordering is `owner > editor > viewer`. */
  atLeast: (role: WorkspaceRole, minimum: WorkspaceRole): boolean =>
    ROLE_RANK[role] >= ROLE_RANK[minimum],
};
