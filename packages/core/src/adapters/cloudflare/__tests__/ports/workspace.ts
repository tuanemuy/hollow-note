import type { InvitationRepository } from "../../../../domain/workspace/ports/invitationRepository";
import type { MembershipRepository } from "../../../../domain/workspace/ports/membershipRepository";
import type { PublicWorkspaceDirectoryReader } from "../../../../domain/workspace/ports/publicWorkspaceDirectoryReader";
import type { UserWorkspaceDirectory } from "../../../../domain/workspace/ports/userWorkspaceDirectory";
import type { WorkspaceDirectoryBatchReader } from "../../../../domain/workspace/ports/workspaceDirectoryBatchReader";
import type { WorkspaceRepository } from "../../../../domain/workspace/ports/workspaceRepository";
import { createD1PublicWorkspaceDirectoryReader } from "../../d1/repositories/publicWorkspaceDirectoryReader";
import { createD1UserWorkspaceDirectory } from "../../d1/repositories/userWorkspaceDirectory";
import { createD1WorkspaceDirectoryBatchReader } from "../../d1/repositories/workspaceDirectoryBatchReader";
import { createCloudflareInvitationRepository } from "../../do/repositories/invitationRepository";
import { createCloudflareMembershipRepository } from "../../do/repositories/membershipRepository";
import { createCloudflareWorkspaceRepository } from "../../do/repositories/workspaceRepository";
import type { GlobalPortDeps, ScopePortDeps } from "./deps";

/**
 * The Workspace ports, split by the plane that holds their table
 * (`spec/database/index.md` の「物理配置」, ADR 021 / ADR 023).
 *
 * The three aggregates live in the scope Durable Object: a workspace, its
 * memberships and its invitations are one workspace's business data and
 * never span scopes. The three readers live in global D1, because each
 * answers a question no single scope can — which workspaces a user
 * belongs to, what a page of WorkspaceIds displays as, and which
 * workspaces are published.
 *
 * Suites: `conformance/workspace.test.ts`.
 */
export type WorkspaceScopePorts = Readonly<{
  workspaceRepository: WorkspaceRepository;
  membershipRepository: MembershipRepository;
  invitationRepository: InvitationRepository;
}>;

export function createWorkspaceScopePorts(
  deps: ScopePortDeps,
): WorkspaceScopePorts {
  return {
    workspaceRepository: createCloudflareWorkspaceRepository({
      session: deps.session,
    }),
    membershipRepository: createCloudflareMembershipRepository({
      session: deps.session,
    }),
    invitationRepository: createCloudflareInvitationRepository({
      session: deps.session,
    }),
  };
}

export type WorkspaceDirectoryPorts = Readonly<{
  userWorkspaceDirectory: UserWorkspaceDirectory;
  workspaceDirectoryBatchReader: WorkspaceDirectoryBatchReader;
  publicWorkspaceDirectoryReader: PublicWorkspaceDirectoryReader;
}>;

export function createWorkspaceDirectoryPorts(
  deps: GlobalPortDeps,
): WorkspaceDirectoryPorts {
  const directory = {
    session: deps.session,
    unreadableWorkspaceIds: deps.workspaceDirectoryOutages,
  };
  return {
    userWorkspaceDirectory: createD1UserWorkspaceDirectory({
      session: deps.session,
    }),
    workspaceDirectoryBatchReader:
      createD1WorkspaceDirectoryBatchReader(directory),
    publicWorkspaceDirectoryReader:
      createD1PublicWorkspaceDirectoryReader(directory),
  };
}
