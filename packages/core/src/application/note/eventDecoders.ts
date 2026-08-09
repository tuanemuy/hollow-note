import { UserId } from "@repo/core/domain/identity/valueObject";
import type {
  NoteAwaitingIntegrationEvent,
  NoteContentUpdatedEvent,
  NoteConversionFailedEvent,
  NoteCreatedEvent,
  NoteMovedEvent,
  NotePublishedEvent,
  NotePurgedEvent,
  NoteRenamedEvent,
  NoteRestoredEvent,
  NoteShareLinkReissuedEvent,
  NoteSharePasswordChangedEvent,
  NoteStyleModeChangedEvent,
  NoteTrashedEvent,
  NoteVisibilityChangedEvent,
} from "@repo/core/domain/note/events";
import {
  type NoteFailureReason,
  NoteId,
  NoteOwner,
  NoteTitle,
  StyleMode,
} from "@repo/core/domain/note/valueObject";
import { StoredFileId } from "@repo/core/domain/storage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { z } from "zod";
import { buildEventDecoder } from "../events/buildDecoder";

/**
 * Wire decoders for the note events (ADR-013: decoders live in the
 * application layer). Strict schemas: unexpected keys fail as
 * `SystemError(DataIntegrityError)`.
 */

const ownerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.string().min(1) }).strict(),
  z
    .object({ type: z.literal("workspace"), workspaceId: z.string().min(1) })
    .strict(),
]);
type OwnerWire = z.infer<typeof ownerSchema>;

const rehydrateOwner = (owner: OwnerWire): NoteOwner =>
  owner.type === "user"
    ? NoteOwner.user(UserId.create(owner.userId))
    : NoteOwner.workspace(WorkspaceId.create(owner.workspaceId));

const visibilitySchema = z.enum(["private", "unlisted", "public"]);

const failureReasonSchema = z.enum([
  "unsupportedFormat",
  "corruptedFile",
  "machineExtractionUnavailable",
  "providerAuthFailed",
  "modelError",
  "quotaExceeded",
  "timeout",
  "sizeExceeded",
  "passwordProtected",
  "unknown",
  "canceled",
]);

const noteIdOnly = z.object({ noteId: z.string().min(1) }).strict();
type NoteIdOnly = z.infer<typeof noteIdOnly>;

const noteIdPayload = (parsed: NoteIdOnly) => ({
  noteId: NoteId.create(parsed.noteId),
});

export const noteEventDecoders = {
  "note.created": buildEventDecoder<
    NoteCreatedEvent,
    {
      noteId: string;
      owner: OwnerWire;
      createdBy: string;
      sourceFileId: string | null;
      projectionRevision: number;
    }
  >(
    "note.created",
    z
      .object({
        noteId: z.string().min(1),
        owner: ownerSchema,
        createdBy: z.string().min(1),
        sourceFileId: z.string().min(1).nullable(),
        projectionRevision: z.number().int().nonnegative(),
      })
      .strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      owner: rehydrateOwner(parsed.owner),
      createdBy: UserId.create(parsed.createdBy),
      sourceFileId:
        parsed.sourceFileId === null
          ? null
          : StoredFileId.create(parsed.sourceFileId),
      projectionRevision: parsed.projectionRevision,
    }),
  ),

  "note.contentUpdated": buildEventDecoder<NoteContentUpdatedEvent, NoteIdOnly>(
    "note.contentUpdated",
    noteIdOnly,
    noteIdPayload,
  ),

  "note.conversionFailed": buildEventDecoder<
    NoteConversionFailedEvent,
    { noteId: string; reason: NoteFailureReason }
  >(
    "note.conversionFailed",
    z
      .object({ noteId: z.string().min(1), reason: failureReasonSchema })
      .strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      reason: parsed.reason,
    }),
  ),

  "note.awaitingIntegration": buildEventDecoder<
    NoteAwaitingIntegrationEvent,
    NoteIdOnly
  >("note.awaitingIntegration", noteIdOnly, noteIdPayload),

  "note.renamed": buildEventDecoder<
    NoteRenamedEvent,
    { noteId: string; title: { value: string; origin: "auto" | "manual" } }
  >(
    "note.renamed",
    z
      .object({
        noteId: z.string().min(1),
        title: z
          .object({
            value: z.string().min(1),
            origin: z.enum(["auto", "manual"]),
          })
          .strict(),
      })
      .strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      title: NoteTitle.create(parsed.title.value, parsed.title.origin),
    }),
  ),

  "note.styleModeChanged": buildEventDecoder<
    NoteStyleModeChangedEvent,
    { noteId: string; styleMode: "default" | "preserve" }
  >(
    "note.styleModeChanged",
    z
      .object({
        noteId: z.string().min(1),
        styleMode: z.enum(["default", "preserve"]),
      })
      .strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      styleMode: StyleMode.create(parsed.styleMode),
    }),
  ),

  "note.visibilityChanged": buildEventDecoder<
    NoteVisibilityChangedEvent,
    {
      noteId: string;
      previous: "private" | "unlisted" | "public";
      current: "private" | "unlisted" | "public";
    }
  >(
    "note.visibilityChanged",
    z
      .object({
        noteId: z.string().min(1),
        previous: visibilitySchema,
        current: visibilitySchema,
      })
      .strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      previous: parsed.previous,
      current: parsed.current,
    }),
  ),

  "note.published": buildEventDecoder<NotePublishedEvent, NoteIdOnly>(
    "note.published",
    noteIdOnly,
    noteIdPayload,
  ),

  "note.shareLinkReissued": buildEventDecoder<
    NoteShareLinkReissuedEvent,
    NoteIdOnly
  >("note.shareLinkReissued", noteIdOnly, noteIdPayload),

  "note.sharePasswordChanged": buildEventDecoder<
    NoteSharePasswordChangedEvent,
    NoteIdOnly
  >("note.sharePasswordChanged", noteIdOnly, noteIdPayload),

  "note.moved": buildEventDecoder<
    NoteMovedEvent,
    {
      noteId: string;
      previousOwner: OwnerWire;
      currentOwner: OwnerWire;
      routeVersion: number;
    }
  >(
    "note.moved",
    z
      .object({
        noteId: z.string().min(1),
        previousOwner: ownerSchema,
        currentOwner: ownerSchema,
        routeVersion: z.number().int().positive(),
      })
      .strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      previousOwner: rehydrateOwner(parsed.previousOwner),
      currentOwner: rehydrateOwner(parsed.currentOwner),
      routeVersion: parsed.routeVersion,
    }),
  ),

  "note.trashed": buildEventDecoder<
    NoteTrashedEvent,
    { noteId: string; owner: OwnerWire }
  >(
    "note.trashed",
    z.object({ noteId: z.string().min(1), owner: ownerSchema }).strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      owner: rehydrateOwner(parsed.owner),
    }),
  ),

  "note.restored": buildEventDecoder<
    NoteRestoredEvent,
    { noteId: string; owner: OwnerWire }
  >(
    "note.restored",
    z.object({ noteId: z.string().min(1), owner: ownerSchema }).strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      owner: rehydrateOwner(parsed.owner),
    }),
  ),

  "note.purged": buildEventDecoder<
    NotePurgedEvent,
    {
      noteId: string;
      owner: OwnerWire;
      sourceFileId: string | null;
      operationId: string;
      deletionOperationId: string | null;
      routeVersion: number;
      projectionRevision: number;
    }
  >(
    "note.purged",
    z
      .object({
        noteId: z.string().min(1),
        owner: ownerSchema,
        sourceFileId: z.string().min(1).nullable(),
        operationId: z.string().min(1),
        deletionOperationId: z.string().min(1).nullable(),
        routeVersion: z.number().int().positive(),
        projectionRevision: z.number().int().nonnegative(),
      })
      .strict(),
    (parsed) => ({
      noteId: NoteId.create(parsed.noteId),
      owner: rehydrateOwner(parsed.owner),
      sourceFileId:
        parsed.sourceFileId === null
          ? null
          : StoredFileId.create(parsed.sourceFileId),
      operationId: parsed.operationId,
      deletionOperationId: parsed.deletionOperationId,
      routeVersion: parsed.routeVersion,
      projectionRevision: parsed.projectionRevision,
    }),
  ),
} as const;
