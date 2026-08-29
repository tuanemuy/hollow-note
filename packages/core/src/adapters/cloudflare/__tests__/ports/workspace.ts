import type { InvitationRepository } from "../../../../domain/workspace/ports/invitationRepository";
import type { InvitationRouteStore } from "../../../../domain/workspace/ports/invitationRouteStore";
import type { MembershipDirectoryReservationStore } from "../../../../domain/workspace/ports/membershipDirectoryReservationStore";
import type { MembershipRemovalPreparationStore } from "../../../../domain/workspace/ports/membershipRemovalPreparationStore";
import type { MembershipRepository } from "../../../../domain/workspace/ports/membershipRepository";
import type { PublicWorkspaceDirectoryReader } from "../../../../domain/workspace/ports/publicWorkspaceDirectoryReader";
import type { UserWorkspaceDirectory } from "../../../../domain/workspace/ports/userWorkspaceDirectory";
import type { WorkspaceDeletionManifestStore } from "../../../../domain/workspace/ports/workspaceDeletionManifestStore";
import type { WorkspaceDirectoryBatchReader } from "../../../../domain/workspace/ports/workspaceDirectoryBatchReader";
import type { WorkspaceDirectoryProjectionWriter } from "../../../../domain/workspace/ports/workspaceDirectoryProjectionWriter";
import type { WorkspaceOperationLockStore } from "../../../../domain/workspace/ports/workspaceOperationLockStore";
import type { WorkspaceRepository } from "../../../../domain/workspace/ports/workspaceRepository";
import type { WorkspaceSlugReservationStore } from "../../../../domain/workspace/ports/workspaceSlugReservationStore";
import { createD1InvitationRouteStore } from "../../d1/repositories/invitationRouteStore";
import { createD1MembershipDirectoryReservationStore } from "../../d1/repositories/membershipDirectoryReservationStore";
import { createD1PublicWorkspaceDirectoryReader } from "../../d1/repositories/publicWorkspaceDirectoryReader";
import { createD1UserWorkspaceDirectory } from "../../d1/repositories/userWorkspaceDirectory";
import { createD1WorkspaceDirectoryBatchReader } from "../../d1/repositories/workspaceDirectoryBatchReader";
import { createD1WorkspaceDirectoryProjectionWriter } from "../../d1/repositories/workspaceDirectoryProjectionWriter";
import { createD1WorkspaceSlugReservationStore } from "../../d1/repositories/workspaceSlugReservationStore";
import { createCloudflareInvitationRepository } from "../../do/repositories/invitationRepository";
import { createCloudflareMembershipRemovalPreparationStore } from "../../do/repositories/membershipRemovalPreparationStore";
import { createCloudflareMembershipRepository } from "../../do/repositories/membershipRepository";
import { createCloudflareWorkspaceDeletionManifestStore } from "../../do/repositories/workspaceDeletionManifestStore";
import { createCloudflareWorkspaceOperationLockStore } from "../../do/repositories/workspaceOperationLockStore";
import { createCloudflareWorkspaceRepository } from "../../do/repositories/workspaceRepository";
import type { GlobalPortDeps, ScopePortDeps } from "./deps";

/**
 * The Workspace ports, split by the plane that holds their table
 * (`spec/database/index.md` の「物理配置」, ADR 021 / ADR 023).
 *
 * The scope Durable Object holds everything that is one workspace's own
 * business data and never spans scopes: the three aggregates, the
 * account-deletion prepare lock on a membership, the move locks and
 * deletion admission, and the deletion manifest that drives cleanup.
 *
 * Global D1 holds what no single scope can answer: which workspaces a
 * user belongs to, what a page of WorkspaceIds displays as, which
 * workspaces are published — and the three service-wide reservations a
 * scope cannot arbitrate on its own, since a slug, an invitation token
 * and a `(user, workspace)` edge are unique across every scope.
 *
 * Suites: `conformance/workspace.test.ts`.
 */
export type WorkspaceScopePorts = Readonly<{
  workspaceRepository: WorkspaceRepository;
  membershipRepository: MembershipRepository;
  invitationRepository: InvitationRepository;
  membershipRemovalPreparationStore: MembershipRemovalPreparationStore;
  workspaceOperationLockStore: WorkspaceOperationLockStore;
  workspaceDeletionManifestStore: WorkspaceDeletionManifestStore;
}>;

export function createWorkspaceScopePorts(
  deps: ScopePortDeps,
): WorkspaceScopePorts {
  const scoped = { session: deps.session, clock: deps.clock };
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
    membershipRemovalPreparationStore:
      createCloudflareMembershipRemovalPreparationStore({
        session: deps.session,
      }),
    workspaceOperationLockStore:
      createCloudflareWorkspaceOperationLockStore(scoped),
    workspaceDeletionManifestStore:
      createCloudflareWorkspaceDeletionManifestStore(scoped),
  };
}

export type WorkspaceReservationPorts = Readonly<{
  invitationRouteStore: InvitationRouteStore;
  membershipDirectoryReservationStore: MembershipDirectoryReservationStore;
  workspaceSlugReservationStore: WorkspaceSlugReservationStore;
}>;

export function createWorkspaceReservationPorts(
  deps: GlobalPortDeps,
): WorkspaceReservationPorts {
  const global = { session: deps.session, clock: deps.clock };
  return {
    invitationRouteStore: createD1InvitationRouteStore(global),
    membershipDirectoryReservationStore:
      createD1MembershipDirectoryReservationStore(global),
    workspaceSlugReservationStore:
      createD1WorkspaceSlugReservationStore(global),
  };
}

export type WorkspaceDirectoryPorts = Readonly<{
  userWorkspaceDirectory: UserWorkspaceDirectory;
  workspaceDirectoryBatchReader: WorkspaceDirectoryBatchReader;
  publicWorkspaceDirectoryReader: PublicWorkspaceDirectoryReader;
  workspaceDirectoryProjectionWriter: WorkspaceDirectoryProjectionWriter;
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
    workspaceDirectoryProjectionWriter:
      createD1WorkspaceDirectoryProjectionWriter({
        session: deps.session,
        clock: deps.clock,
      }),
  };
}
