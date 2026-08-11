import type { WithEventDrafts } from "@repo/core/domain/common/event";
import { Version } from "@repo/core/domain/common/version";
import { BusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "./errorCode";
import { type IdentityEvent, IdentityEvents } from "./events";
import {
  type AvatarUrl,
  Bio,
  DisplayName,
  Email,
  Handle,
  UserId,
} from "./valueObject";

type UserBase = Readonly<{
  id: UserId;
  email: Email;
  displayName: DisplayName;
  bio: Bio;
  // Public URL, not a StoredFileId — keeps Identity free of Storage.
  avatarUrl: AvatarUrl | null;
  handle: Handle | null;
  /**
   * Monotonic generation that logically expires every session / auth
   * token in O(1): rows minted under an older epoch are invalid even if
   * the physical rows remain.
   */
  authEpoch: number;
  version: Version;
  createdAt: Date;
  updatedAt: Date;
}>;

export type PendingUser = UserBase & Readonly<{ status: "pending" }>;
export type ActiveUser = UserBase &
  Readonly<{ status: "active"; verifiedAt: Date }>;
export type DeletingUser = UserBase &
  Readonly<{
    status: "deleting";
    verifiedAt: Date;
    deletionOperationId: string;
  }>;
/** PII-free tombstone. Never transitions back to active. */
export type DeletedUser = Readonly<{
  id: UserId;
  status: "deleted";
  authEpoch: number;
  version: Version;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
}>;

export type User = PendingUser | ActiveUser | DeletingUser | DeletedUser;

type ReconstructInput = Readonly<{
  id: string;
  status: string;
  email?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string | null;
  handle?: string | null;
  authEpoch: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  verifiedAt?: Date | null;
  deletionOperationId?: string | null;
  deletedAt?: Date | null;
}>;

const nonNegativeEpoch = (raw: number): number => {
  if (!Number.isInteger(raw) || raw < 0) {
    throw new BusinessRuleError(
      IdentityErrorCode.InvalidId,
      `Invalid auth epoch: ${raw}`,
    );
  }
  return raw;
};

export const User = {
  create: (
    params: Readonly<{ id: string; email: string; displayName: string }>,
    now: Date,
  ): WithEventDrafts<PendingUser, IdentityEvent> => {
    const user: PendingUser = {
      status: "pending",
      id: UserId.create(params.id),
      email: Email.create(params.email),
      displayName: DisplayName.create(params.displayName),
      bio: Bio.create(""),
      avatarUrl: null,
      handle: null,
      authEpoch: 0,
      version: Version.initial(),
      createdAt: now,
      updatedAt: now,
    };
    return {
      entity: user,
      eventDrafts: [IdentityEvents.userCreated(user.id, now)],
    };
  },

  /** For OAuth / invitation sign-up where the address is already verified. */
  createVerified: (
    params: Readonly<{ id: string; email: string; displayName: string }>,
    now: Date,
  ): WithEventDrafts<ActiveUser, IdentityEvent> => {
    const user: ActiveUser = {
      status: "active",
      id: UserId.create(params.id),
      email: Email.create(params.email),
      displayName: DisplayName.create(params.displayName),
      bio: Bio.create(""),
      avatarUrl: null,
      handle: null,
      authEpoch: 0,
      verifiedAt: now,
      version: Version.initial(),
      createdAt: now,
      updatedAt: now,
    };
    return {
      entity: user,
      eventDrafts: [
        IdentityEvents.userCreated(user.id, now),
        IdentityEvents.userEmailVerified(user.id, now),
      ],
    };
  },

  verifyEmail: (
    user: PendingUser,
    now: Date,
  ): WithEventDrafts<ActiveUser, IdentityEvent> => {
    const next: ActiveUser = {
      ...user,
      status: "active",
      verifiedAt: now,
      version: Version.next(user.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [IdentityEvents.userEmailVerified(next.id, now)],
    };
  },

  updateProfile: (
    user: ActiveUser,
    params: Readonly<{
      displayName?: string;
      bio?: string;
      avatarUrl?: AvatarUrl | null;
    }>,
    now: Date,
  ): WithEventDrafts<ActiveUser, IdentityEvent> => {
    const displayName =
      params.displayName !== undefined
        ? DisplayName.create(params.displayName)
        : user.displayName;
    const next: ActiveUser = {
      ...user,
      displayName,
      bio: params.bio !== undefined ? Bio.create(params.bio) : user.bio,
      avatarUrl:
        params.avatarUrl !== undefined ? params.avatarUrl : user.avatarUrl,
      version: Version.next(user.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts:
        displayName !== user.displayName
          ? [IdentityEvents.userProfileUpdated(next.id, displayName, now)]
          : [],
    };
  },

  // Emits unconditionally (even on first assignment, with
  // `previousHandle: null`): this event is the only path that fills the
  // read model's `author_handle`, and muting the first assignment would
  // leave public listings without an author link (spec/domains/identity.md).
  assignHandle: (
    user: ActiveUser,
    handle: string,
    now: Date,
  ): WithEventDrafts<ActiveUser, IdentityEvent> => {
    const next: ActiveUser = {
      ...user,
      handle: Handle.create(handle),
      version: Version.next(user.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        IdentityEvents.userHandleChanged(
          next.id,
          user.handle,
          next.handle,
          now,
        ),
      ],
    };
  },

  clearHandle: (
    user: ActiveUser,
    now: Date,
  ): WithEventDrafts<ActiveUser, IdentityEvent> => {
    const next: ActiveUser = {
      ...user,
      handle: null,
      version: Version.next(user.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        IdentityEvents.userHandleChanged(next.id, user.handle, null, now),
      ],
    };
  },

  /** Logically expires all existing sessions / tokens. Never decreases. */
  advanceAuthEpoch: (user: ActiveUser, now: Date): ActiveUser => ({
    ...user,
    authEpoch: user.authEpoch + 1,
    version: Version.next(user.version),
    updatedAt: now,
  }),

  beginDeletion: (
    user: ActiveUser,
    operationId: string,
    now: Date,
  ): DeletingUser => ({
    ...user,
    status: "deleting",
    deletionOperationId: operationId,
    authEpoch: user.authEpoch + 1,
    version: Version.next(user.version),
    updatedAt: now,
  }),

  /**
   * Only the pre-check failure path of the owning deletion operation may
   * revert to active — callers must pass the same operation id recorded
   * by `beginDeletion`.
   */
  rejectDeletion: (
    user: DeletingUser,
    operationId: string,
    now: Date,
  ): ActiveUser => {
    ensureDeletionOwner(user, operationId);
    const { deletionOperationId: _dropped, ...rest } = user;
    return {
      ...rest,
      status: "active",
      version: Version.next(user.version),
      updatedAt: now,
    };
  },

  /** Drops PII after all cleanup acks; the only emitter of `user.deleted`. */
  finalizeDeletion: (
    user: DeletingUser,
    operationId: string,
    now: Date,
  ): WithEventDrafts<DeletedUser, IdentityEvent> => {
    ensureDeletionOwner(user, operationId);
    const next: DeletedUser = {
      id: user.id,
      status: "deleted",
      authEpoch: user.authEpoch,
      version: Version.next(user.version),
      createdAt: user.createdAt,
      updatedAt: now,
      deletedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [IdentityEvents.userDeleted(next.id, operationId, now)],
    };
  },

  reconstruct: (input: ReconstructInput): User => {
    try {
      if (input.status === "deleted") {
        return {
          id: UserId.create(input.id),
          status: "deleted",
          authEpoch: nonNegativeEpoch(input.authEpoch),
          version: Version.create(input.version),
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          deletedAt: requireField(input.deletedAt, "deletedAt"),
        };
      }
      const base = {
        id: UserId.create(input.id),
        email: Email.create(requireField(input.email, "email")),
        displayName: DisplayName.create(
          requireField(input.displayName, "displayName"),
        ),
        bio: Bio.create(input.bio ?? ""),
        // Trusted as validated on write: `AvatarUrl.create` needs the
        // app origin, and reading configuration is exactly what a domain
        // rehydration must not do.
        avatarUrl: (input.avatarUrl ?? null) as AvatarUrl | null,
        handle:
          input.handle !== undefined && input.handle !== null
            ? Handle.create(input.handle)
            : null,
        authEpoch: nonNegativeEpoch(input.authEpoch),
        version: Version.create(input.version),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };
      switch (input.status) {
        case "pending":
          return { ...base, status: "pending" };
        case "active":
          return {
            ...base,
            status: "active",
            verifiedAt: requireField(input.verifiedAt, "verifiedAt"),
          };
        case "deleting":
          return {
            ...base,
            status: "deleting",
            verifiedAt: requireField(input.verifiedAt, "verifiedAt"),
            deletionOperationId: requireField(
              input.deletionOperationId,
              "deletionOperationId",
            ),
          };
        default:
          throw new BusinessRuleError(
            IdentityErrorCode.InvalidId,
            `Invalid user status: ${input.status}`,
          );
      }
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct User ${input.id}`,
        error,
      );
    }
  },
};

function requireField<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) {
    throw new BusinessRuleError(
      IdentityErrorCode.InvalidId,
      `Missing user field: ${field}`,
    );
  }
  return value;
}

function ensureDeletionOwner(user: DeletingUser, operationId: string): void {
  if (user.deletionOperationId !== operationId) {
    throw new BusinessRuleError(
      IdentityErrorCode.InvalidId,
      "Deletion operation id does not match the running operation",
    );
  }
}
