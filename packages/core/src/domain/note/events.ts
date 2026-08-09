import type {
  DomainEventBase,
  EventDraft,
} from "@repo/core/domain/common/event";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { StoredFileId } from "@repo/core/domain/storage/valueObject";
import type {
  NoteFailureReason,
  NoteId,
  NoteOwner,
  NoteTitle,
  StyleMode,
} from "./valueObject";

export type NoteVisibilityStatus = "private" | "unlisted" | "public";

export type NoteCreatedEvent = DomainEventBase<
  "note.created",
  Readonly<{
    noteId: NoteId;
    owner: NoteOwner;
    createdBy: UserId;
    sourceFileId: StoredFileId | null;
    projectionRevision: number;
  }>
>;

export type NoteContentUpdatedEvent = DomainEventBase<
  "note.contentUpdated",
  Readonly<{ noteId: NoteId }>
>;

export type NoteConversionFailedEvent = DomainEventBase<
  "note.conversionFailed",
  Readonly<{ noteId: NoteId; reason: NoteFailureReason }>
>;

export type NoteAwaitingIntegrationEvent = DomainEventBase<
  "note.awaitingIntegration",
  Readonly<{ noteId: NoteId }>
>;

export type NoteRenamedEvent = DomainEventBase<
  "note.renamed",
  Readonly<{ noteId: NoteId; title: NoteTitle }>
>;

export type NoteStyleModeChangedEvent = DomainEventBase<
  "note.styleModeChanged",
  Readonly<{ noteId: NoteId; styleMode: StyleMode }>
>;

export type NoteVisibilityChangedEvent = DomainEventBase<
  "note.visibilityChanged",
  Readonly<{
    noteId: NoteId;
    previous: NoteVisibilityStatus;
    current: NoteVisibilityStatus;
  }>
>;

export type NotePublishedEvent = DomainEventBase<
  "note.published",
  Readonly<{ noteId: NoteId }>
>;

export type NoteShareLinkReissuedEvent = DomainEventBase<
  "note.shareLinkReissued",
  Readonly<{ noteId: NoteId }>
>;

export type NoteSharePasswordChangedEvent = DomainEventBase<
  "note.sharePasswordChanged",
  Readonly<{ noteId: NoteId }>
>;

export type NoteMovedEvent = DomainEventBase<
  "note.moved",
  Readonly<{
    noteId: NoteId;
    previousOwner: NoteOwner;
    currentOwner: NoteOwner;
    routeVersion: number;
  }>
>;

export type NoteTrashedEvent = DomainEventBase<
  "note.trashed",
  Readonly<{ noteId: NoteId; owner: NoteOwner }>
>;

export type NoteRestoredEvent = DomainEventBase<
  "note.restored",
  Readonly<{ noteId: NoteId; owner: NoteOwner }>
>;

/**
 * Emitted directly by usecases (purging has no successor entity).
 * Carries the cleanup admission token when the purge originates from a
 * scope cleanup.
 */
export type NotePurgedEvent = DomainEventBase<
  "note.purged",
  Readonly<{
    noteId: NoteId;
    owner: NoteOwner;
    sourceFileId: StoredFileId | null;
    operationId: string;
    deletionOperationId: string | null;
    routeVersion: number;
    projectionRevision: number;
  }>
>;

export type NoteEvent =
  | NoteCreatedEvent
  | NoteContentUpdatedEvent
  | NoteConversionFailedEvent
  | NoteAwaitingIntegrationEvent
  | NoteRenamedEvent
  | NoteStyleModeChangedEvent
  | NoteVisibilityChangedEvent
  | NotePublishedEvent
  | NoteShareLinkReissuedEvent
  | NoteSharePasswordChangedEvent
  | NoteMovedEvent
  | NoteTrashedEvent
  | NoteRestoredEvent
  | NotePurgedEvent;

export const NoteEvents = {
  created: (
    params: Readonly<{
      noteId: NoteId;
      owner: NoteOwner;
      createdBy: UserId;
      sourceFileId: StoredFileId | null;
      projectionRevision: number;
    }>,
    occurredAt: Date,
  ): EventDraft<NoteCreatedEvent> => ({
    type: "note.created",
    payload: params,
    occurredAt,
    aggregateId: params.noteId,
  }),

  contentUpdated: (
    noteId: NoteId,
    occurredAt: Date,
  ): EventDraft<NoteContentUpdatedEvent> => ({
    type: "note.contentUpdated",
    payload: { noteId },
    occurredAt,
    aggregateId: noteId,
  }),

  conversionFailed: (
    noteId: NoteId,
    reason: NoteFailureReason,
    occurredAt: Date,
  ): EventDraft<NoteConversionFailedEvent> => ({
    type: "note.conversionFailed",
    payload: { noteId, reason },
    occurredAt,
    aggregateId: noteId,
  }),

  awaitingIntegration: (
    noteId: NoteId,
    occurredAt: Date,
  ): EventDraft<NoteAwaitingIntegrationEvent> => ({
    type: "note.awaitingIntegration",
    payload: { noteId },
    occurredAt,
    aggregateId: noteId,
  }),

  renamed: (
    noteId: NoteId,
    title: NoteTitle,
    occurredAt: Date,
  ): EventDraft<NoteRenamedEvent> => ({
    type: "note.renamed",
    payload: { noteId, title },
    occurredAt,
    aggregateId: noteId,
  }),

  styleModeChanged: (
    noteId: NoteId,
    styleMode: StyleMode,
    occurredAt: Date,
  ): EventDraft<NoteStyleModeChangedEvent> => ({
    type: "note.styleModeChanged",
    payload: { noteId, styleMode },
    occurredAt,
    aggregateId: noteId,
  }),

  visibilityChanged: (
    noteId: NoteId,
    previous: NoteVisibilityStatus,
    current: NoteVisibilityStatus,
    occurredAt: Date,
  ): EventDraft<NoteVisibilityChangedEvent> => ({
    type: "note.visibilityChanged",
    payload: { noteId, previous, current },
    occurredAt,
    aggregateId: noteId,
  }),

  published: (
    noteId: NoteId,
    occurredAt: Date,
  ): EventDraft<NotePublishedEvent> => ({
    type: "note.published",
    payload: { noteId },
    occurredAt,
    aggregateId: noteId,
  }),

  shareLinkReissued: (
    noteId: NoteId,
    occurredAt: Date,
  ): EventDraft<NoteShareLinkReissuedEvent> => ({
    type: "note.shareLinkReissued",
    payload: { noteId },
    occurredAt,
    aggregateId: noteId,
  }),

  sharePasswordChanged: (
    noteId: NoteId,
    occurredAt: Date,
  ): EventDraft<NoteSharePasswordChangedEvent> => ({
    type: "note.sharePasswordChanged",
    payload: { noteId },
    occurredAt,
    aggregateId: noteId,
  }),

  moved: (
    params: Readonly<{
      noteId: NoteId;
      previousOwner: NoteOwner;
      currentOwner: NoteOwner;
      routeVersion: number;
    }>,
    occurredAt: Date,
  ): EventDraft<NoteMovedEvent> => ({
    type: "note.moved",
    payload: params,
    occurredAt,
    aggregateId: params.noteId,
  }),

  trashed: (
    noteId: NoteId,
    owner: NoteOwner,
    occurredAt: Date,
  ): EventDraft<NoteTrashedEvent> => ({
    type: "note.trashed",
    payload: { noteId, owner },
    occurredAt,
    aggregateId: noteId,
  }),

  restored: (
    noteId: NoteId,
    owner: NoteOwner,
    occurredAt: Date,
  ): EventDraft<NoteRestoredEvent> => ({
    type: "note.restored",
    payload: { noteId, owner },
    occurredAt,
    aggregateId: noteId,
  }),

  purged: (
    params: Readonly<{
      noteId: NoteId;
      owner: NoteOwner;
      sourceFileId: StoredFileId | null;
      operationId: string;
      deletionOperationId: string | null;
      routeVersion: number;
      projectionRevision: number;
    }>,
    occurredAt: Date,
  ): EventDraft<NotePurgedEvent> => ({
    type: "note.purged",
    payload: params,
    occurredAt,
    aggregateId: params.noteId,
  }),
};
