import type { EventDraft } from "@repo/core/domain/common/event";
import type { IdentityUniqueDirectory } from "@repo/core/domain/identity/ports/identityUniqueDirectory";
import type { ActiveUser } from "@repo/core/domain/identity/user";
import { User } from "@repo/core/domain/identity/user";
import {
  AvatarUrl,
  Handle,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import {
  ConflictError,
  isConflictError,
  NotFoundError,
  ValidationError,
} from "../errors";
import type { ServiceArgs } from "../types";
import {
  activateUniqueKeys,
  holdsActiveUniqueKey,
  releaseActiveUniqueKey,
  releaseUniqueKeys,
  reserveUniqueKeys,
} from "./uniqueness";
import { type ProfileView, toProfileView } from "./view";

export type UpdateProfileInput = Readonly<{
  userId: string;
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  handle?: string | null;
}>;

/**
 * What the request asks of the handle. Absent / `null` leaves it alone;
 * the empty string is the spec's spelling of "unset it". `reclaim` asks
 * for the handle the user row already names, whose durable claim is
 * missing from the directory.
 */
type HandlePlan =
  | Readonly<{ kind: "keep" }>
  | Readonly<{ kind: "assign"; handle: Handle }>
  | Readonly<{ kind: "reclaim"; handle: Handle }>
  | Readonly<{ kind: "clear" }>;

/**
 * Parent operation of the handle reservation saga.
 *
 * Composed from the user id rather than minted, so a retry after a lost
 * response derives the **same** reservation id and reuses the row it
 * already took (a fresh id would collide with its own reservation and
 * surface as `HANDLE_ALREADY_USED`).
 */
const profileOperationId = (userId: UserId): string =>
  `identity.updateProfile:${userId}`;

/**
 * Operation that tears the *previous* handle's durable claim down. It
 * embeds the handle, so it stays inside the directory call and never
 * reaches a log.
 */
const handleReleaseOperationId = (userId: UserId, handle: Handle): string =>
  `${profileOperationId(userId)}:release:handle:${handle}`;

const emailNotVerified = (): ValidationError =>
  new ValidationError(
    "EMAIL_NOT_VERIFIED",
    "The email address has not been verified",
  );

const accountUnavailable = (): ValidationError =>
  new ValidationError("ACCOUNT_UNAVAILABLE", "Account is unavailable");

const userNotFound = (): NotFoundError =>
  new NotFoundError("USER_NOT_FOUND", "User not found");

async function planHandle(
  deps: Readonly<{ identityUniqueDirectory: IdentityUniqueDirectory }>,
  user: ActiveUser,
  raw: string | null | undefined,
): Promise<HandlePlan> {
  if (raw === undefined || raw === null) {
    return { kind: "keep" };
  }
  if (raw.trim().length === 0) {
    return user.handle === null ? { kind: "keep" } : { kind: "clear" };
  }
  const handle = Handle.create(raw);
  if (handle !== user.handle) {
    return { kind: "assign", handle };
  }
  // Re-setting the handle one already owns is a no-op only while the
  // claim is really published: `reserve` would answer this user's own
  // `active` row with `HANDLE_ALREADY_USED`. A saga stopped between the
  // shard commit and `activate` leaves no claim behind, and this re-run
  // is the only thing that can publish it again.
  const claimed = await holdsActiveUniqueKey(deps, {
    kind: "handle",
    normalizedKey: handle,
    expectedUserId: user.id,
  });
  return claimed ? { kind: "keep" } : { kind: "reclaim", handle };
}

/**
 * Updates the profile and the public handle (UC-identity-017,
 * spec/usecases/identity.md#updateprofile).
 *
 * A handle change is a uniqueness saga on top of the profile write:
 * reserve the new key → commit the UserId shard → activate at the
 * committed user version → tear the previous claim down. The order is
 * load-bearing. Releasing the old key first would open a window where
 * neither key is held and a rival could take the old one while this
 * request still might fail; activating after the release would leave the
 * new key parked. The old claim is freed by `normalizedKey` because the
 * operation that created it is long past.
 *
 * A saga stopped between the commit and the activation leaves the user
 * row naming a handle the directory does not claim, which a rival could
 * then take. Re-sending the same handle repairs it: the plan reads the
 * directory before collapsing to a no-op and reserves again under the
 * same deterministic operation id.
 *
 * Concurrency is decided by the user version observed before the
 * transaction: a profile write that committed in between makes this one a
 * stale write, answered as `OPTIMISTIC_LOCK_FAILURE` instead of silently
 * overwriting it.
 */
export async function updateProfile({
  container,
  input,
}: ServiceArgs<UpdateProfileInput>): Promise<ProfileView> {
  const { clock, config, userReader, globalUnitOfWorkProvider } = container;

  const userId = UserId.create(input.userId);
  const observed = await userReader.findById(userId);
  if (observed === null || observed.entity.status === "deleted") {
    throw userNotFound();
  }
  if (observed.entity.status === "pending") {
    throw emailNotVerified();
  }
  if (observed.entity.status !== "active") {
    throw accountUnavailable();
  }
  const observedVersion = observed.entity.version;
  const previousHandle = observed.entity.handle;

  // Value objects are constructed before any reservation so an invalid
  // display name / bio / avatar can never leave saga state behind.
  const profilePatch = {
    ...(input.displayName !== undefined && input.displayName !== null
      ? { displayName: input.displayName }
      : {}),
    ...(input.bio !== undefined && input.bio !== null
      ? { bio: input.bio }
      : {}),
    ...(input.avatarUrl !== undefined
      ? {
          avatarUrl:
            input.avatarUrl === null
              ? null
              : AvatarUrl.create(input.avatarUrl, config.appUrl),
        }
      : {}),
  };
  const plan = await planHandle(container, observed.entity, input.handle);
  const claimedHandle =
    plan.kind === "assign" || plan.kind === "reclaim" ? plan.handle : null;
  // `reclaim` re-publishes the claim for the handle the user row already
  // names, so there is no superseded claim to tear down afterwards.
  const supersededHandle =
    plan.kind === "assign" || plan.kind === "clear" ? previousHandle : null;

  const now = clock.now();
  const parentOperationId = profileOperationId(userId);
  const reservations =
    claimedHandle !== null
      ? await reserveUniqueKeys(container, {
          parentOperationId,
          userId,
          keys: [{ kind: "handle", normalizedKey: claimedHandle }],
        })
      : [];

  let saved: ActiveUser;
  try {
    saved = await globalUnitOfWorkProvider.run(async (ctx) => {
      const fresh = await ctx.userRepository.findById(userId);
      if (fresh === null || fresh.entity.status === "deleted") {
        throw userNotFound();
      }
      if (fresh.entity.status === "pending") {
        throw emailNotVerified();
      }
      if (fresh.entity.status !== "active") {
        throw accountUnavailable();
      }
      if (fresh.entity.version !== observedVersion) {
        throw new ConflictError(
          "OPTIMISTIC_LOCK_FAILURE",
          "The profile changed during the update",
        );
      }

      const updated = User.updateProfile(fresh.entity, profilePatch, now);
      const drafts: EventDraft[] = [...updated.eventDrafts];
      let entity = updated.entity;
      if (plan.kind === "assign") {
        const assigned = User.assignHandle(entity, plan.handle, now);
        entity = assigned.entity;
        drafts.push(...assigned.eventDrafts);
      } else if (plan.kind === "clear") {
        const cleared = User.clearHandle(entity, now);
        entity = cleared.entity;
        drafts.push(...cleared.eventDrafts);
      }

      await ctx.userRepository.save(entity, fresh.expectedVersion);
      ctx.collectEvents(drafts);
      return entity;
    });
  } catch (error) {
    // A lost race is the one failure that must not compensate. The
    // reservation id is derived from the user id and the key, so two
    // concurrent attempts at the same handle share a single directory
    // row; releasing here would delete the row the winning attempt is
    // about to activate, leaving the user row naming a handle nobody
    // claims. Losing means "another attempt of this same operation is
    // in flight", and that attempt owns the row.
    if (!(isConflictError(error) && error.code === "OPTIMISTIC_LOCK_FAILURE")) {
      await releaseUniqueKeys(container, reservations);
    }
    throw error;
  }

  await activateUniqueKeys(container, {
    reservations,
    committedVersion: saved.version,
    confirm: async () => {
      const current = await userReader.findById(userId);
      return current === null || current.entity.status === "deleted"
        ? null
        : current.entity.version;
    },
  });

  if (supersededHandle !== null) {
    await releaseActiveUniqueKey(container, {
      kind: "handle",
      normalizedKey: supersededHandle,
      expectedUserId: userId,
      operationId: handleReleaseOperationId(userId, supersededHandle),
    });
  }

  return toProfileView(saved);
}
