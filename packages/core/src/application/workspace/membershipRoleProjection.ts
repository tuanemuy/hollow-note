import type { MembershipRoleChangedEvent } from "@repo/core/domain/workspace/events";
import type { WorkerContainer } from "../di/types";

/**
 * Projects `workspace.membership.roleChanged` onto the global
 * `membership_directory` edge (spec/domains/workspace.md `ドメインイベント`).
 *
 * The edge is the only place `listUserWorkspaces` reads a role from, so
 * without this the switcher keeps rendering the role the join was created
 * with while the scope already holds another one. It stays a projection:
 * every decision that depends on a role re-reads `Membership` in the
 * workspace scope, which is why a lagging edge is a display gap and never
 * a privilege.
 *
 * Ordering is the event's own `membershipId` and `sourceVersion`, applied
 * by the store: a change of a membership the edge no longer names writes
 * nothing, a redelivery repeats a version that is no longer newer, and a
 * change that arrives after a later one is refused rather than rolling
 * the role back. That is what makes the handler safe under the
 * at-least-once, unordered delivery the relay gives it, with no
 * `IdempotencyStore`.
 *
 * Removal is deliberately not projected here. `removeMember` /
 * `leaveWorkspace` tear the edge down in band, `removing` first and then
 * gone, so a subscriber deleting it a second time would race their two
 * phases and could drop an edge whose cleanup has not been acknowledged.
 */
export async function projectMembershipRole(
  event: MembershipRoleChangedEvent,
  deps: WorkerContainer,
): Promise<void> {
  await deps.membershipDirectoryReservationStore.applyRoleIfNewer({
    userId: event.payload.userId,
    workspaceId: event.payload.workspaceId,
    membershipId: event.payload.membershipId,
    role: event.payload.currentRole,
    sourceVersion: event.payload.sourceVersion,
  });
}
