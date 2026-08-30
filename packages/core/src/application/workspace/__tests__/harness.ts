import type { DomainEvent } from "@repo/core/domain/common/event";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { User } from "@repo/core/domain/identity/user";
import {
  AvatarUrl,
  type TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { Note } from "@repo/core/domain/note/note";
import { NoteOwner } from "@repo/core/domain/note/valueObject";
import {
  Invitation,
  type PendingInvitation,
} from "@repo/core/domain/workspace/invitation";
import { Membership } from "@repo/core/domain/workspace/membership";
import type { WorkspaceDirectoryEntry } from "@repo/core/domain/workspace/ports/workspaceDirectoryBatchReader";
import {
  InvitationId,
  type MembershipId,
  WorkspaceId,
  type WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
import type {
  PrivateWorkspace,
  Workspace,
} from "@repo/core/domain/workspace/workspace";
import { Workspace as WorkspaceEntity } from "@repo/core/domain/workspace/workspace";
import { expect } from "vitest";
import type { OutboxRow } from "../../../adapters/memory/store";
import {
  createTestHarness,
  type TestHarness,
  type TestHarnessOptions,
} from "../../__tests__/helpers";
import type { RequestContainer, WorkerContainer } from "../../di/types";
import {
  isConflictError,
  isNotFoundError,
  isValidationError,
} from "../../errors";
import { markDeleted } from "../../identity/__tests__/authFlowHelpers";
import { ScopeKey } from "../../scope";
import {
  type EventDispatchOutcome,
  processOutboxEvents,
} from "../../workers/eventRelayWorker";
import {
  type RunDueScopeTasksOptions,
  runDueScopeTasks,
} from "../../workers/scopeTaskRunner";
import { dispatchDomainEvent } from "../../workers/subscribers";
import { projectWorkspaceDirectory } from "../directoryProjection";

/**
 * Shared scaffolding for the workspace usecase tests
 * (`spec/testcases/workspace/`).
 *
 * Everything here runs against the memory reference adapters through the
 * production DI of `createTestHarness` — the memory backend is a real
 * backend, not a fake, so a seed goes through the same ports a request
 * would use. The two exceptions are the states no usecase in this slice
 * can produce (an invitation whose window has already closed, a workspace
 * row the saga has already removed); those are written straight to
 * `harness.backend` through the domain `reconstruct` factories, which is
 * what `docs/test.md` asks for.
 */

export const DEFAULT_WORKSPACE_ID = "workspace-1";

/** How long an invitation stays valid (`Invitation.issue`). */
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** TTL the seeding sagas hold their global reservations for. */
const SEED_RESERVATION_TTL_MS = 10 * 60 * 1000;

export const workspaceScope = (workspaceId: string): ScopeKey =>
  ScopeKey.workspace(WorkspaceId.create(workspaceId));

/**
 * A harness over one fresh memory backend. Identical to
 * `createTestHarness`; it exists so every workspace test takes its
 * container, clock, id stream and fault-injection overrides from one
 * import.
 */
export function createWorkspaceHarness(
  options: TestHarnessOptions = {},
): TestHarness {
  return createTestHarness(options);
}

export type { TestHarness, TestHarnessOptions };

export type UserSeed = Readonly<{
  userId: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string | null;
}>;

/**
 * Writes one verified `User` row. Members need an identity row because
 * `listMembers` resolves display data through `UserBatchReader` and the
 * membership-directory reservation refuses a user that is not active.
 */
export function seedUser(h: TestHarness, seed: UserSeed): UserId {
  const now = h.clock.now();
  const created = User.createVerified(
    {
      id: seed.userId,
      email: seed.email ?? `${seed.userId}@example.com`,
      displayName: seed.displayName ?? seed.userId,
    },
    now,
  ).entity;
  const user =
    seed.avatarUrl === undefined || seed.avatarUrl === null
      ? created
      : User.updateProfile(
          created,
          { avatarUrl: AvatarUrl.create(seed.avatarUrl, h.config.appUrl) },
          now,
        ).entity;
  h.backend.users.set(user.id, user);
  return user.id;
}

/**
 * Turns a seeded user into the PII-free tombstone `deleteAccount` leaves,
 * so a membership that outlived its account can be rendered.
 */
export function markUserDeleted(h: TestHarness, userId: string): void {
  markDeleted(h, userId);
}

export type MemberSeed = Readonly<{
  userId: string;
  role: WorkspaceRole;
  membershipId?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string | null;
  /**
   * Identity row to leave behind the membership. `deleted` seeds the
   * account and then tombstones it, `none` leaves no row at all.
   */
  user?: "active" | "deleted" | "none";
  /**
   * Global `membership_directory` edge. Default `active`, except for a
   * member seeded with `user: "none"` — the reservation refuses a user
   * that has no active identity row, so there is no such edge to seed.
   */
  edge?: "active" | "none";
}>;

export type WorkspaceSeed = Readonly<{
  workspaceId?: string;
  name?: string;
  description?: string;
  slug?: string | null;
  avatarUrl?: string | null;
  publication?: "private" | "published";
  members?: readonly MemberSeed[];
  /** Claim the slug in `workspace_slug_reservations`. Default true. */
  reserveSlug?: boolean;
  /** Publish the row into `workspace_directory`. Default true. */
  projectDirectory?: boolean;
}>;

export type SeededWorkspace = Readonly<{
  workspaceId: WorkspaceId;
  scope: ScopeKey;
  workspace: Workspace;
  memberships: readonly Membership[];
}>;

const seedMemberUser = (h: TestHarness, member: MemberSeed): void => {
  if ((member.user ?? "active") === "none") {
    return;
  }
  seedUser(h, {
    userId: member.userId,
    ...(member.displayName !== undefined
      ? { displayName: member.displayName }
      : {}),
    ...(member.email !== undefined ? { email: member.email } : {}),
    ...(member.avatarUrl !== undefined ? { avatarUrl: member.avatarUrl } : {}),
  });
};

const seedMemberEdge = async (
  h: TestHarness,
  workspaceId: WorkspaceId,
  member: MemberSeed,
  membershipId: MembershipId,
): Promise<void> => {
  if (
    (member.edge ?? "active") === "none" ||
    (member.user ?? "active") === "none"
  ) {
    return;
  }
  const operationId = `seed-edge-${workspaceId}-${member.userId}`;
  await h.container.membershipDirectoryReservationStore.reserveAndClaimActivation(
    {
      operationId,
      userId: UserId.create(member.userId),
      workspaceId,
      membershipId,
      role: member.role,
      expiresAt: new Date(h.clock.now().getTime() + SEED_RESERVATION_TTL_MS),
    },
  );
  await h.container.membershipDirectoryReservationStore.activate(operationId);
};

/**
 * Seeds one workspace with its members, its global slug claim and its
 * directory row — the state every workspace usecase starts from.
 *
 * The directory edge of each member carries the clock's current instant as
 * its `created_at`, which is the key `listUserWorkspaces` pages by; advance
 * `h.clock` between calls to give two workspaces a defined order.
 */
export async function seedWorkspace(
  h: TestHarness,
  seed: WorkspaceSeed = {},
): Promise<SeededWorkspace> {
  const id = seed.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const workspaceId = WorkspaceId.create(id);
  const scope = ScopeKey.workspace(workspaceId);
  const now = h.clock.now();
  const members = seed.members ?? [];
  const ownerId = UserId.create(members[0]?.userId ?? "owner-1");

  let priv: PrivateWorkspace = WorkspaceEntity.create(
    {
      id,
      ownerId,
      name: seed.name ?? "Workspace",
      description: seed.description ?? "",
      slug: seed.slug ?? null,
    },
    now,
  ).entity;
  if (seed.avatarUrl !== undefined && seed.avatarUrl !== null) {
    const updated = WorkspaceEntity.updateProfile(
      priv,
      { avatarUrl: AvatarUrl.create(seed.avatarUrl, h.config.appUrl) },
      now,
    ).entity;
    if (updated.publication !== "private") {
      throw new Error("updateProfile must not change the publication");
    }
    priv = updated;
  }
  const workspace: Workspace =
    (seed.publication ?? "private") === "published"
      ? WorkspaceEntity.publish(priv, now).entity
      : priv;

  for (const member of members) {
    seedMemberUser(h, member);
  }

  const memberships = members.map(
    (member, index) =>
      Membership.create(
        {
          id: member.membershipId ?? `membership-${index + 1}`,
          workspaceId,
          userId: UserId.create(member.userId),
          role: member.role,
        },
        now,
      ).entity,
  );

  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    await ctx.workspaceRepository.insert(workspace);
    for (const membership of memberships) {
      await ctx.membershipRepository.insert(membership);
    }
  });

  const slug = workspace.slug;
  if (slug !== null && seed.reserveSlug !== false) {
    const operationId = `seed-slug-${id}`;
    await h.container.workspaceSlugReservationStore.reserve({
      slug,
      workspaceId,
      operationId,
      attemptId: operationId,
      expiresAt: new Date(now.getTime() + SEED_RESERVATION_TTL_MS),
    });
    await h.container.workspaceSlugReservationStore.activate({
      slug,
      workspaceId,
      operationId,
      releasing: null,
    });
  }

  for (const [index, member] of members.entries()) {
    const membership = memberships[index];
    if (membership === undefined) {
      continue;
    }
    await seedMemberEdge(h, workspaceId, member, membership.id);
  }

  if (seed.projectDirectory !== false) {
    await projectWorkspaceDirectory(h.container, "[seed] directory", workspace);
  }

  for (const member of members) {
    if (member.user === "deleted") {
      markUserDeleted(h, member.userId);
    }
  }

  return { workspaceId, scope, workspace, memberships };
}

/** Adds one member to a workspace that already exists. */
export async function seedMember(
  h: TestHarness,
  workspaceId: string,
  member: MemberSeed,
): Promise<Membership> {
  const id = WorkspaceId.create(workspaceId);
  seedMemberUser(h, member);
  const membership = Membership.create(
    {
      id: member.membershipId ?? `membership-${member.userId}`,
      workspaceId: id,
      userId: UserId.create(member.userId),
      role: member.role,
    },
    h.clock.now(),
  ).entity;
  await h.container.scopeUnitOfWorkProvider.run(ScopeKey.workspace(id), (ctx) =>
    ctx.membershipRepository.insert(membership),
  );
  await seedMemberEdge(h, id, member, membership.id);
  if (member.user === "deleted") {
    markUserDeleted(h, member.userId);
  }
  return membership;
}

/** Notes owned by a workspace, for the public-note count of P-33. */
export async function seedWorkspaceNotes(
  h: TestHarness,
  workspaceId: string,
  counts: Readonly<{ publicNotes?: number; privateNotes?: number }>,
): Promise<void> {
  const id = WorkspaceId.create(workspaceId);
  const owner = NoteOwner.workspace(id);
  const createdBy = UserId.create("owner-1");
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(id),
    async (ctx) => {
      const write = async (
        prefix: string,
        count: number,
        makePublic: boolean,
      ): Promise<void> => {
        for (let i = 0; i < count; i += 1) {
          const blank = Note.createBlank(
            {
              id: `${prefix}-${workspaceId}-${i}`,
              owner,
              createdBy,
              title: `${prefix} ${i}`,
              projectionRevision: 1,
            },
            now,
          ).entity;
          await ctx.noteRepository.insert(
            makePublic ? Note.makePublic(blank, now).entity : blank,
          );
        }
      };
      await write("public-note", counts.publicNotes ?? 0, true);
      await write("private-note", counts.privateNotes ?? 0, false);
    },
  );
}

export type InvitationSeed = Readonly<{
  invitationId?: string;
  email?: string;
  role?: WorkspaceRole;
  invitedBy: string;
  /** Terminal state of the invitation itself. Default `pending`. */
  state?: "pending" | "expired" | "accepted" | "revoked";
  acceptedBy?: string;
  /**
   * Global `invitation_routes` row. Defaults to the state the invitation
   * implies: `active` while it can still be accepted, `closed` once it has
   * been consumed or cancelled.
   */
  route?: "active" | "reserved" | "closed" | "none";
}>;

export type SeededInvitation = Readonly<{
  invitation: Invitation;
  token: string;
  tokenHash: TokenHash;
}>;

/**
 * Issues one invitation into a workspace together with its global token
 * route, and returns the plaintext token the recipient would open.
 *
 * `state: "expired"` is the one seed that cannot go through the sagas: a
 * route whose reservation has lapsed can never be activated, so the row is
 * issued live and then re-written with a closed window through
 * `Invitation.reconstruct`. That is exactly the state a link that sat in an
 * inbox for a fortnight reaches — an `active` route pointing at an
 * invitation the scope judges expired.
 */
export async function seedInvitation(
  h: TestHarness,
  workspaceId: string,
  seed: InvitationSeed,
): Promise<SeededInvitation> {
  const id = WorkspaceId.create(workspaceId);
  const scope = ScopeKey.workspace(id);
  const now = h.clock.now();
  const invitationId = seed.invitationId ?? "invitation-1";
  const secret = h.container.secureTokenGenerator.issue();
  const state = seed.state ?? "pending";

  const pending: PendingInvitation = Invitation.issue(
    {
      id: invitationId,
      workspaceId: id,
      email: seed.email ?? "invitee@example.com",
      role: seed.role ?? "editor",
      invitedBy: UserId.create(seed.invitedBy),
      tokenHash: secret.hash,
    },
    now,
  ).entity;

  const invitation: Invitation =
    state === "accepted"
      ? Invitation.accept(
          pending,
          UserId.create(seed.acceptedBy ?? "invitee-1"),
          now,
        ).entity
      : state === "revoked"
        ? Invitation.revoke(pending, now).entity
        : state === "expired"
          ? Invitation.reconstruct({
              id: pending.id,
              workspaceId: pending.workspaceId,
              email: pending.email,
              role: pending.role,
              invitedBy: pending.invitedBy,
              tokenHash: pending.tokenHash,
              status: "pending",
              version: pending.version,
              createdAt: new Date(now.getTime() - INVITATION_TTL_MS - 1000),
              expiresAt: new Date(now.getTime() - 1000),
            })
          : pending;

  await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
    ctx.invitationRepository.insert(invitation),
  );

  const route =
    seed.route ??
    (state === "accepted" || state === "revoked" ? "closed" : "active");
  if (route !== "none") {
    const operationId = `seed-route-${invitationId}`;
    await h.container.invitationRouteStore.reserve({
      tokenHash: secret.hash,
      workspaceId: id,
      invitationId: InvitationId.create(invitationId),
      operationId,
      expiresAt: pending.expiresAt,
    });
    if (route !== "reserved") {
      await h.container.invitationRouteStore.activate({
        tokenHash: secret.hash,
        operationId,
      });
    }
    if (route === "closed") {
      const close =
        state === "accepted"
          ? h.container.invitationRouteStore.consume
          : h.container.invitationRouteStore.revoke;
      await close({
        tokenHash: secret.hash,
        invitationId: InvitationId.create(invitationId),
        operationId,
      });
    }
  }

  return { invitation, token: secret.token, tokenHash: secret.hash };
}

/** The plaintext token inside an `invitationUrl` a usecase answered with. */
export const tokenOfInvitationUrl = (invitationUrl: string): string =>
  decodeURIComponent(invitationUrl.slice(invitationUrl.lastIndexOf("/") + 1));

export const storedWorkspace = (
  h: TestHarness,
  workspaceId: string,
): Workspace | null =>
  h.backend.scope(workspaceScope(workspaceId)).workspaces.get(workspaceId) ??
  null;

export const storedMembership = (
  h: TestHarness,
  workspaceId: string,
  membershipId: string,
): Membership | null =>
  h.backend.scope(workspaceScope(workspaceId)).memberships.get(membershipId) ??
  null;

export const storedMemberships = (
  h: TestHarness,
  workspaceId: string,
): readonly Membership[] =>
  h.backend.scope(workspaceScope(workspaceId)).memberships.values();

export const storedInvitation = (
  h: TestHarness,
  workspaceId: string,
  invitationId: string,
): Invitation | null =>
  h.backend.scope(workspaceScope(workspaceId)).invitations.get(invitationId) ??
  null;

/** Scope-plane continuation rows — the workspace deletion's driver. */
export const scheduledTasks = (h: TestHarness, workspaceId: string) =>
  h.backend.scope(workspaceScope(workspaceId)).scheduledTasks.values();

export const directoryRow = (h: TestHarness, workspaceId: string) =>
  h.backend.workspaceDirectory.get(workspaceId) ?? null;

export const membershipEdges = (h: TestHarness, userId?: string) =>
  h.backend.membershipEdges
    .values()
    .filter((row) => userId === undefined || row.userId === userId);

export const invitationRoutes = (h: TestHarness) =>
  h.backend.invitationRoutes.values();

export const slugReservations = (h: TestHarness) =>
  h.backend.slugReservations.values();

/**
 * Flips the workspace to `deleting` under `operationId` without running
 * `deleteWorkspace`, so the barrier can be observed on its own.
 */
export async function beginWorkspaceDeletion(
  h: TestHarness,
  workspaceId: string,
  operationId = "deletion-op-1",
): Promise<string> {
  const id = WorkspaceId.create(workspaceId);
  await h.container.scopeUnitOfWorkProvider.run(
    ScopeKey.workspace(id),
    async (ctx) => {
      const versioned = await ctx.workspaceRepository.findById(id);
      if (versioned === null) {
        throw new Error(`no workspace row for ${workspaceId}`);
      }
      await ctx.workspaceOperationLockStore.beginDeletion({
        workspaceId: id,
        operationId,
        expectedWorkspaceVersion: versioned.expectedVersion,
      });
    },
  );
  return operationId;
}

/**
 * Removes the Workspace row the deletion saga's last local turn deletes,
 * leaving the scope as a member who has already lost the workspace sees it.
 */
export function removeWorkspaceRow(h: TestHarness, workspaceId: string): void {
  h.backend.scope(workspaceScope(workspaceId)).workspaces.delete(workspaceId);
}

/** Tombstones the directory row, the durable `deleted` verdict. */
export async function tombstoneDirectory(
  h: TestHarness,
  workspaceId: string,
  operationId = "deletion-op-1",
): Promise<void> {
  await h.workerContainer.workspaceDirectoryProjectionWriter.tombstone({
    workspaceId: WorkspaceId.create(workspaceId),
    operationId,
  });
}

/**
 * Makes the named workspaces' directory shard unreadable. The batch reader
 * degrades those ids to `unavailable`; the public enumeration fails whole.
 */
export function induceDirectoryOutage(
  h: TestHarness,
  ...workspaceIds: readonly string[]
): void {
  for (const id of workspaceIds) {
    h.backend.workspaceDirectoryOutages.add(id);
  }
}

export function clearDirectoryOutages(h: TestHarness): void {
  h.backend.workspaceDirectoryOutages.clear();
}

/** Overwrites a directory row, e.g. to make the projection lag its scope. */
export function overwriteDirectoryRow(
  h: TestHarness,
  workspaceId: string,
  patch: Partial<
    Readonly<{
      name: WorkspaceDirectoryEntry["name"];
      slug: WorkspaceDirectoryEntry["slug"];
      avatarUrl: string | null;
      publication: "private" | "published";
      lifecycle: "active" | "deleting";
      sourceVersion: number;
      updatedAt: Date;
    }>
  >,
): void {
  const stored = h.backend.workspaceDirectory.get(workspaceId);
  if (stored === undefined) {
    throw new Error(`no directory row for ${workspaceId}`);
  }
  h.backend.workspaceDirectory.set(workspaceId, { ...stored, ...patch });
}

/**
 * A container whose `workspace_directory` snapshot never lands.
 *
 * Every usecase that writes the projection sends it *after* its own
 * scope-local commit and gives it one retry, so two refusals end the
 * request in failure with the scope already moved and the directory row
 * still on the version before it. Nothing repairs that row afterwards —
 * the projection has no subscriber and no recovery entry point (see
 * `WorkspaceDirectoryProjectionWriter`) — which is what makes this the
 * lasting state the advertised slug is read out of, rather than a lag
 * that the next round of work closes on its own.
 */
export function withFailingDirectoryProjection(
  h: TestHarness,
  error: Error = new Error("directory shard unreachable"),
): RequestContainer {
  return {
    ...h.container,
    workspaceDirectoryProjectionWriter: {
      ...h.container.workspaceDirectoryProjectionWriter,
      applySnapshotIfNewer: () => Promise.reject(error),
    },
  };
}

/**
 * The worker-plane half of the same fault: the deletion saga's directory
 * `tombstone` never lands.
 *
 * It takes a container of its own rather than an argument to the request
 * helper above because the two writes sit on different containers on
 * purpose — the request path is handed a `Pick` without `tombstone`
 * (`WorkspaceDirectoryProjector`), since the terminal write belongs to
 * the cleanup turn alone.
 *
 * Unlike the projection, this loss is not permanent by construction: the
 * turn is a scope task, so it backs off and comes round again. What it
 * exposes is the order the turn owes — nothing past the tombstone runs,
 * the slug keys included, so a workspace whose public route is still
 * resolving never has its keys handed to the next taker.
 */
export function withFailingDirectoryTombstone(
  h: TestHarness,
  error: Error = new Error("directory shard unreachable"),
): WorkerContainer {
  return {
    ...h.workerContainer,
    workspaceDirectoryProjectionWriter: {
      ...h.workerContainer.workspaceDirectoryProjectionWriter,
      tombstone: () => Promise.reject(error),
    },
  };
}

export const outboxRows = (
  h: TestHarness,
  type?: string,
): readonly OutboxRow[] =>
  h.backend.outbox
    .values()
    .filter((row) => type === undefined || row.type === type);

export const outboxTypes = (h: TestHarness): readonly string[] =>
  h.backend.outbox.values().map((row) => row.type);

/** Payloads of every row of one event type, in insertion order. */
export const outboxPayloads = <T = Record<string, unknown>>(
  h: TestHarness,
  type: string,
): readonly T[] => outboxRows(h, type).map((row) => row.payload as T);

export type DrainOutboxOptions = Readonly<{
  /**
   * Reorders each claimed batch before it is dispatched. Delivery carries
   * no ordering guarantee, so a consumer that only works in emission order
   * is a bug this hook exposes.
   */
  order?: (events: readonly DomainEvent[]) => readonly DomainEvent[];
}>;

/**
 * Runs the relay against the real subscriber registry until the outbox is
 * drained — the same path `pnpm dev` takes.
 */
export async function drainOutbox(
  h: TestHarness,
  options: DrainOutboxOptions = {},
): Promise<number> {
  const { processed } = await processOutboxEvents(
    h.workerContainer,
    async (events) => {
      const ordered = options.order?.(events) ?? events;
      const outcomes: EventDispatchOutcome[] = [];
      for (const event of ordered) {
        await dispatchDomainEvent(event, h.workerContainer);
        outcomes.push({ kind: "success", id: event.id });
      }
      return outcomes;
    },
  );
  return processed;
}

/** One round of the scope plane's continuation work. */
export const runScopeTasks = (
  h: TestHarness,
  options: RunDueScopeTasksOptions = {},
): Promise<Readonly<{ processed: number }>> =>
  runDueScopeTasks(h.workerContainer, options);

/**
 * Drives scope tasks and the outbox alternately until neither has work
 * left, which is how a multi-turn saga reaches its terminal state.
 */
export async function drainScopeTasks(
  h: TestHarness,
  maxRounds = 50,
): Promise<number> {
  let total = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const { processed } = await runDueScopeTasks(h.workerContainer);
    const dispatched = await drainOutbox(h);
    total += processed + dispatched;
    if (processed === 0 && dispatched === 0) {
      return total;
    }
  }
  throw new Error(`scope tasks did not settle within ${maxRounds} rounds`);
}

/**
 * A container whose `userBatchReader` records the id lists it is asked
 * for. The fan-out contract is "group by id, one bounded read" — the call
 * log is the only place that is observable from a usecase's result.
 */
export function recordUserBatchReads(
  h: TestHarness,
): Readonly<{ container: RequestContainer; calls: readonly UserId[][] }> {
  const calls: UserId[][] = [];
  const inner = h.container.userBatchReader;
  return {
    calls,
    container: {
      ...h.container,
      userBatchReader: {
        resolveMany: (ids) => {
          calls.push([...ids]);
          return inner.resolveMany(ids);
        },
      },
    },
  };
}

/** The same for the workspace directory's shard-spanning batch read. */
export function recordWorkspaceDirectoryReads(
  h: TestHarness,
): Readonly<{ container: RequestContainer; calls: readonly WorkspaceId[][] }> {
  const calls: WorkspaceId[][] = [];
  const inner = h.container.workspaceDirectoryBatchReader;
  return {
    calls,
    container: {
      ...h.container,
      workspaceDirectoryBatchReader: {
        resolveMany: (ids) => {
          calls.push([...ids]);
          return inner.resolveMany(ids);
        },
      },
    },
  };
}

export const expectBusinessRule = (
  promise: Promise<unknown>,
  code: string,
): Promise<void> =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => isBusinessRuleError(error) && error.code === code,
  );

export const expectNotFound = (
  promise: Promise<unknown>,
  code = "WORKSPACE_NOT_FOUND",
): Promise<void> =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => isNotFoundError(error) && error.code === code,
  );

export const expectValidation = (
  promise: Promise<unknown>,
  code: string,
): Promise<void> =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => isValidationError(error) && error.code === code,
  );

export const expectConflict = (
  promise: Promise<unknown>,
  code: string,
): Promise<void> =>
  expect(promise).rejects.toSatisfy(
    (error: unknown) => isConflictError(error) && error.code === code,
  );
