import type {
  DomainEventBase,
  EventDraft,
} from "@repo/core/domain/common/event";
import type { DisplayName, Handle, IdentityId, UserId } from "./valueObject";

export type UserCreatedEvent = DomainEventBase<
  "identity.user.created",
  Readonly<{ userId: UserId }>
>;

export type UserEmailVerifiedEvent = DomainEventBase<
  "identity.user.emailVerified",
  Readonly<{ userId: UserId }>
>;

export type UserProfileUpdatedEvent = DomainEventBase<
  "identity.user.profileUpdated",
  Readonly<{ userId: UserId; displayName: DisplayName }>
>;

export type UserHandleChangedEvent = DomainEventBase<
  "identity.user.handleChanged",
  Readonly<{
    userId: UserId;
    previousHandle: Handle | null;
    currentHandle: Handle | null;
  }>
>;

export type UserDeletedEvent = DomainEventBase<
  "identity.user.deleted",
  Readonly<{ userId: UserId; deletionOperationId: string }>
>;

export type IdentityAddedEvent = DomainEventBase<
  "identity.identity.added",
  Readonly<{
    identityId: IdentityId;
    userId: UserId;
    kind: "password" | "oauth";
  }>
>;

/**
 * Emitted directly by usecases when an identity is removed (there is no
 * successor entity). `providerAccountKey` is the normalized directory key
 * fixed before deletion — `null` for password identities — consumed by the
 * global reservation-release consumer.
 */
export type IdentityRemovedEvent = DomainEventBase<
  "identity.identity.removed",
  Readonly<{
    identityId: IdentityId;
    userId: UserId;
    kind: "password" | "oauth";
    providerAccountKey: string | null;
    operationId: string;
  }>
>;

export type IdentityPasswordChangedEvent = DomainEventBase<
  "identity.identity.passwordChanged",
  Readonly<{ identityId: IdentityId; userId: UserId }>
>;

export type IdentityEvent =
  | UserCreatedEvent
  | UserEmailVerifiedEvent
  | UserProfileUpdatedEvent
  | UserHandleChangedEvent
  | UserDeletedEvent
  | IdentityAddedEvent
  | IdentityRemovedEvent
  | IdentityPasswordChangedEvent;

export const IdentityEvents = {
  userCreated: (
    userId: UserId,
    occurredAt: Date,
  ): EventDraft<UserCreatedEvent> => ({
    type: "identity.user.created",
    payload: { userId },
    occurredAt,
    aggregateId: userId,
  }),

  userEmailVerified: (
    userId: UserId,
    occurredAt: Date,
  ): EventDraft<UserEmailVerifiedEvent> => ({
    type: "identity.user.emailVerified",
    payload: { userId },
    occurredAt,
    aggregateId: userId,
  }),

  userProfileUpdated: (
    userId: UserId,
    displayName: DisplayName,
    occurredAt: Date,
  ): EventDraft<UserProfileUpdatedEvent> => ({
    type: "identity.user.profileUpdated",
    payload: { userId, displayName },
    occurredAt,
    aggregateId: userId,
  }),

  userHandleChanged: (
    userId: UserId,
    previousHandle: Handle | null,
    currentHandle: Handle | null,
    occurredAt: Date,
  ): EventDraft<UserHandleChangedEvent> => ({
    type: "identity.user.handleChanged",
    payload: { userId, previousHandle, currentHandle },
    occurredAt,
    aggregateId: userId,
  }),

  userDeleted: (
    userId: UserId,
    deletionOperationId: string,
    occurredAt: Date,
  ): EventDraft<UserDeletedEvent> => ({
    type: "identity.user.deleted",
    payload: { userId, deletionOperationId },
    occurredAt,
    aggregateId: userId,
  }),

  identityAdded: (
    identityId: IdentityId,
    userId: UserId,
    kind: "password" | "oauth",
    occurredAt: Date,
  ): EventDraft<IdentityAddedEvent> => ({
    type: "identity.identity.added",
    payload: { identityId, userId, kind },
    occurredAt,
    aggregateId: identityId,
  }),

  identityRemoved: (
    params: Readonly<{
      identityId: IdentityId;
      userId: UserId;
      kind: "password" | "oauth";
      providerAccountKey: string | null;
      operationId: string;
    }>,
    occurredAt: Date,
  ): EventDraft<IdentityRemovedEvent> => ({
    type: "identity.identity.removed",
    payload: params,
    occurredAt,
    aggregateId: params.identityId,
  }),

  identityPasswordChanged: (
    identityId: IdentityId,
    userId: UserId,
    occurredAt: Date,
  ): EventDraft<IdentityPasswordChangedEvent> => ({
    type: "identity.identity.passwordChanged",
    payload: { identityId, userId },
    occurredAt,
    aggregateId: identityId,
  }),
};
