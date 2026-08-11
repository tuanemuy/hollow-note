import type { EventDraft } from "@repo/core/domain/common/event";
import type { ActiveUser } from "@repo/core/domain/identity/user";
import { User } from "@repo/core/domain/identity/user";
import {
  AvatarUrl,
  Handle,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import {
  activateUniqueKeys,
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
 * the empty string is the spec's spelling of "unset it".
 */
type HandlePlan =
  | Readonly<{ kind: "keep" }>
  | Readonly<{ kind: "assign"; handle: Handle }>
  | Readonly<{ kind: "clear" }>;

/**
 * Parent operation of the handle reservation saga.
 *
 * Composed from the user id rather than minted, so a retry after a lost
 * response derives the **same** reservation id and reuses the row it
 * already took (a fresh id would collide with its own reservation and
 * surface as `HANDLE_ALREADY_USED`). Same reasoning as the deterministic
 * continuation ids of ADR-019 / ADR-035.
 */
const profileOperationId = (userId: UserId): string =>
  `identity.updateProfile:${userId}`;

/** Operation that tears the *previous* handle's durable claim down. */
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

function planHandle(
  user: ActiveUser,
  raw: string | null | undefined,
): HandlePlan {
  if (raw === undefined || raw === null) {
    return { kind: "keep" };
  }
  if (raw.trim().length === 0) {
    return user.handle === null ? { kind: "keep" } : { kind: "clear" };
  }
  // Re-setting the handle one already owns is a no-op rather than a
  // reservation: the directory row is already `active` for this user and
  // `reserve` would answer its own claim with `HANDLE_ALREADY_USED`.
  const handle = Handle.create(raw);
  return handle === user.handle ? { kind: "keep" } : { kind: "assign", handle };
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
 * operation that created it is long past (ADR-015).
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
  const plan = planHandle(observed.entity, input.handle);

  const now = clock.now();
  const parentOperationId = profileOperationId(userId);
  const reservations =
    plan.kind === "assign"
      ? await reserveUniqueKeys(container, {
          parentOperationId,
          userId,
          keys: [{ kind: "handle", normalizedKey: plan.handle }],
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
    await releaseUniqueKeys(container, reservations);
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

  if (plan.kind !== "keep" && previousHandle !== null) {
    await releaseActiveUniqueKey(container, {
      kind: "handle",
      normalizedKey: previousHandle,
      expectedUserId: userId,
      operationId: handleReleaseOperationId(userId, previousHandle),
    });
  }

  return toProfileView(saved);
}
