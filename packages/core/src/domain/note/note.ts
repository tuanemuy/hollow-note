import type { WithEventDrafts } from "@repo/core/domain/common/event";
import { Version } from "@repo/core/domain/common/version";
import type { InitialContentState } from "@repo/core/domain/conversion/valueObject";
import { BusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import {
  PasswordHash,
  TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { StoredFileId } from "@repo/core/domain/storage/valueObject";
import { WorkspaceId } from "@repo/core/domain/workspace/valueObject";
import { NoteErrorCode } from "./errorCode";
import { type NoteEvent, NoteEvents } from "./events";
import type { ProcessedHtml } from "./ports/htmlProcessor";
import {
  Excerpt,
  MAX_HEADINGS_PER_NOTE,
  type NoteFailureReason,
  NoteHeading,
  NoteHtml,
  NoteId,
  NoteOwner,
  NoteTitle,
  PlainTextContent,
  ShareLink,
  StyleMode,
} from "./valueObject";

export type NoteContent =
  | Readonly<{ status: "processing" }>
  | Readonly<{ status: "awaitingIntegration" }>
  | Readonly<{ status: "failed"; reason: NoteFailureReason }>
  | Readonly<{
      status: "ready";
      html: NoteHtml;
      text: PlainTextContent;
      excerpt: Excerpt;
      headings: readonly NoteHeading[];
    }>;

/**
 * `unlisted` always carries its share link, while `private` / `public`
 * may hold a dormant one — "unlisted without a link" is unrepresentable,
 * and returning to unlisted revives the same link. A public note never
 * holds a password (`dormantShareLink.password` is always `null`).
 */
export type NoteVisibility =
  | Readonly<{ status: "private"; dormantShareLink: ShareLink | null }>
  | Readonly<{ status: "unlisted"; shareLink: ShareLink }>
  | Readonly<{
      status: "public";
      publishedAt: Date;
      dormantShareLink: ShareLink | null;
    }>;

type NoteBase = Readonly<{
  id: NoteId;
  owner: NoteOwner;
  createdBy: UserId;
  title: NoteTitle;
  content: NoteContent;
  visibility: NoteVisibility;
  styleMode: StyleMode;
  sourceFileId: StoredFileId | null;
  version: Version;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ActiveNote = NoteBase & Readonly<{ lifecycle: "active" }>;
export type TrashedNote = NoteBase &
  Readonly<{ lifecycle: "trashed"; trashedAt: Date; purgeAfter: Date }>;
export type Note = ActiveNote | TrashedNote;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = 30 * DAY_MS;

const ensureReady = (
  content: NoteContent,
): Extract<NoteContent, { status: "ready" }> => {
  if (content.status !== "ready") {
    throw new BusinessRuleError(
      NoteErrorCode.CannotPublishEmptyNote,
      "A note without a ready body cannot be published",
    );
  }
  return content;
};

const capHeadings = (
  headings: readonly NoteHeading[],
): readonly NoteHeading[] => headings.slice(0, MAX_HEADINGS_PER_NOTE);

const readyContentFromProcessed = (processed: ProcessedHtml): NoteContent => ({
  status: "ready",
  html: processed.html,
  text: processed.text,
  excerpt: processed.excerpt,
  headings: capHeadings(processed.headings.map(NoteHeading.create)),
});

const stripPassword = (link: ShareLink): ShareLink =>
  link.password === null ? link : { ...link, password: null };

type ReconstructShareLinkInput = Readonly<{
  tokenHash: string;
  cipherText: string;
  keyVersion: number;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  issuedAt: Date;
}>;

type ReconstructInput = Readonly<{
  id: string;
  ownerType: string;
  ownerId: string;
  createdBy: string;
  title: string;
  titleOrigin: string;
  contentStatus: string;
  failureReason?: string | null;
  html?: string | null;
  text?: string | null;
  excerpt?: string | null;
  headings?: readonly Readonly<{
    level: number;
    text: string;
    anchorId: string;
  }>[];
  visibilityStatus: string;
  publishedAt?: Date | null;
  shareLink?: ReconstructShareLinkInput | null;
  dormantShareLink?: ReconstructShareLinkInput | null;
  styleMode: string;
  sourceFileId?: string | null;
  lifecycle: string;
  trashedAt?: Date | null;
  purgeAfter?: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export const Note = {
  isActive: (note: Note): note is ActiveNote => note.lifecycle === "active",
  isTrashed: (note: Note): note is TrashedNote => note.lifecycle === "trashed",

  createFromUpload: (
    params: Readonly<{
      id: string;
      owner: NoteOwner;
      createdBy: UserId;
      title: string;
      sourceFileId: StoredFileId;
      initialContent: InitialContentState;
      styleMode: StyleMode;
      projectionRevision: number;
    }>,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const note: ActiveNote = {
      lifecycle: "active",
      id: NoteId.create(params.id),
      owner: params.owner,
      createdBy: params.createdBy,
      title: NoteTitle.auto(params.title),
      content: params.initialContent,
      visibility: { status: "private", dormantShareLink: null },
      styleMode: params.styleMode,
      sourceFileId: params.sourceFileId,
      version: Version.initial(),
      createdAt: now,
      updatedAt: now,
    };
    return {
      entity: note,
      eventDrafts: [
        NoteEvents.created(
          {
            noteId: note.id,
            owner: note.owner,
            createdBy: note.createdBy,
            sourceFileId: note.sourceFileId,
            projectionRevision: params.projectionRevision,
          },
          now,
        ),
      ],
    };
  },

  createBlank: (
    params: Readonly<{
      id: string;
      owner: NoteOwner;
      createdBy: UserId;
      title: string;
      projectionRevision: number;
    }>,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const note: ActiveNote = {
      lifecycle: "active",
      id: NoteId.create(params.id),
      owner: params.owner,
      createdBy: params.createdBy,
      title: NoteTitle.manual(params.title),
      content: {
        status: "ready",
        html: NoteHtml.empty(),
        text: PlainTextContent.create(""),
        excerpt: Excerpt.fromText(""),
        headings: [],
      },
      visibility: { status: "private", dormantShareLink: null },
      styleMode: "default",
      sourceFileId: null,
      version: Version.initial(),
      createdAt: now,
      updatedAt: now,
    };
    return {
      entity: note,
      eventDrafts: [
        NoteEvents.created(
          {
            noteId: note.id,
            owner: note.owner,
            createdBy: note.createdBy,
            sourceFileId: null,
            projectionRevision: params.projectionRevision,
          },
          now,
        ),
      ],
    };
  },

  applyConversionResult: (
    note: ActiveNote,
    result: Readonly<{
      html: NoteHtml;
      text: PlainTextContent;
      excerpt: Excerpt;
      headings: readonly NoteHeading[];
      styleMode: StyleMode;
      title: NoteTitle | null;
    }>,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const shouldRename = result.title !== null && NoteTitle.isAuto(note.title);
    const nextTitle =
      shouldRename && result.title !== null ? result.title : note.title;
    const next: ActiveNote = {
      ...note,
      title: nextTitle,
      content: {
        status: "ready",
        html: result.html,
        text: result.text,
        excerpt: result.excerpt,
        headings: capHeadings(result.headings),
      },
      styleMode: result.styleMode,
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        NoteEvents.contentUpdated(next.id, now),
        ...(shouldRename ? [NoteEvents.renamed(next.id, nextTitle, now)] : []),
      ],
    };
  },

  markConversionFailed: (
    note: ActiveNote,
    reason: NoteFailureReason,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const next: ActiveNote = {
      ...note,
      content: { status: "failed", reason },
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.conversionFailed(next.id, reason, now)],
    };
  },

  /** Only called as the outcome of the initial conversion. */
  markAwaitingIntegration: (
    note: ActiveNote,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const next: ActiveNote = {
      ...note,
      content: { status: "awaitingIntegration" },
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.awaitingIntegration(next.id, now)],
    };
  },

  updateBody: (
    note: ActiveNote,
    processed: ProcessedHtml,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const next: ActiveNote = {
      ...note,
      content: readyContentFromProcessed(processed),
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.contentUpdated(next.id, now)],
    };
  },

  rename: (
    note: ActiveNote,
    title: string,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const next: ActiveNote = {
      ...note,
      title: NoteTitle.manual(title),
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.renamed(next.id, next.title, now)],
    };
  },

  changeStyleMode: (
    note: ActiveNote,
    mode: string,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const next: ActiveNote = {
      ...note,
      styleMode: StyleMode.create(mode),
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.styleModeChanged(next.id, next.styleMode, now)],
    };
  },

  // `routeVersion` rides on `note.moved` for the projection consumers;
  // it is resolved by the move orchestration (NoteRouteStore), not the
  // aggregate, so it arrives as an argument.
  moveTo: (
    note: ActiveNote,
    owner: NoteOwner,
    routeVersion: number,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    if (NoteOwner.equals(note.owner, owner)) {
      return { entity: note, eventDrafts: [] };
    }
    const next: ActiveNote = {
      ...note,
      owner,
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        NoteEvents.moved(
          {
            noteId: next.id,
            previousOwner: note.owner,
            currentOwner: owner,
            routeVersion,
          },
          now,
        ),
      ],
    };
  },

  makePrivate: (
    note: ActiveNote,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const dormant =
      note.visibility.status === "unlisted"
        ? note.visibility.shareLink
        : note.visibility.dormantShareLink;
    const next: ActiveNote = {
      ...note,
      visibility: { status: "private", dormantShareLink: dormant },
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        NoteEvents.visibilityChanged(
          next.id,
          note.visibility.status,
          "private",
          now,
        ),
      ],
    };
  },

  makeUnlisted: (
    note: ActiveNote,
    newLink: ShareLink | null,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    ensureReady(note.content);
    const revived =
      note.visibility.status === "unlisted"
        ? note.visibility.shareLink
        : (note.visibility.dormantShareLink ?? newLink);
    if (revived === null) {
      throw new BusinessRuleError(
        NoteErrorCode.ShareLinkRequired,
        "A share link is required to make a note unlisted",
      );
    }
    const next: ActiveNote = {
      ...note,
      visibility: { status: "unlisted", shareLink: revived },
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        NoteEvents.visibilityChanged(
          next.id,
          note.visibility.status,
          "unlisted",
          now,
        ),
      ],
    };
  },

  makePublic: (
    note: ActiveNote,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    ensureReady(note.content);
    const dormant =
      note.visibility.status === "unlisted"
        ? stripPassword(note.visibility.shareLink)
        : note.visibility.dormantShareLink !== null
          ? stripPassword(note.visibility.dormantShareLink)
          : null;
    const next: ActiveNote = {
      ...note,
      visibility: {
        status: "public",
        publishedAt:
          note.visibility.status === "public"
            ? note.visibility.publishedAt
            : now,
        dormantShareLink: dormant,
      },
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        NoteEvents.visibilityChanged(
          next.id,
          note.visibility.status,
          "public",
          now,
        ),
        NoteEvents.published(next.id, now),
      ],
    };
  },

  reissueShareLink: (
    note: ActiveNote,
    newLink: ShareLink,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    if (note.visibility.status !== "unlisted") {
      throw new BusinessRuleError(
        NoteErrorCode.NotUnlisted,
        "Only an unlisted note can reissue its share link",
      );
    }
    const next: ActiveNote = {
      ...note,
      visibility: {
        status: "unlisted",
        // Token is replaced; the existing password survives.
        shareLink: { ...newLink, password: note.visibility.shareLink.password },
      },
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.shareLinkReissued(next.id, now)],
    };
  },

  setSharePassword: (
    note: ActiveNote,
    passwordHash: PasswordHash | null,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    if (note.visibility.status !== "unlisted") {
      throw new BusinessRuleError(
        NoteErrorCode.NotUnlisted,
        "Only an unlisted note can hold a share password",
      );
    }
    const next: ActiveNote = {
      ...note,
      visibility: {
        status: "unlisted",
        shareLink: {
          ...note.visibility.shareLink,
          // A new password (with a new `updatedAt`) invalidates every
          // previously issued SharePass; `null` clears the protection.
          password:
            passwordHash === null
              ? null
              : { hash: passwordHash, updatedAt: now },
        },
      },
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.sharePasswordChanged(next.id, now)],
    };
  },

  trash: (
    note: ActiveNote,
    now: Date,
  ): WithEventDrafts<TrashedNote, NoteEvent> => {
    const next: TrashedNote = {
      ...note,
      lifecycle: "trashed",
      trashedAt: now,
      purgeAfter: new Date(now.getTime() + TRASH_RETENTION_MS),
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.trashed(next.id, next.owner, now)],
    };
  },

  restore: (
    note: TrashedNote,
    now: Date,
  ): WithEventDrafts<ActiveNote, NoteEvent> => {
    const { trashedAt: _trashedAt, purgeAfter: _purgeAfter, ...rest } = note;
    const next: ActiveNote = {
      ...rest,
      lifecycle: "active",
      version: Version.next(note.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [NoteEvents.restored(next.id, next.owner, now)],
    };
  },

  reconstruct: (input: ReconstructInput): Note => {
    try {
      const base: NoteBase = {
        id: NoteId.create(input.id),
        owner: reconstructOwner(input.ownerType, input.ownerId),
        createdBy: UserId.create(input.createdBy),
        title: NoteTitle.create(
          input.title,
          reconstructTitleOrigin(input.titleOrigin),
        ),
        content: reconstructContent(input),
        visibility: reconstructVisibility(input),
        styleMode: StyleMode.create(input.styleMode),
        sourceFileId:
          input.sourceFileId !== undefined && input.sourceFileId !== null
            ? StoredFileId.create(input.sourceFileId)
            : null,
        version: Version.create(input.version),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };
      if (input.lifecycle === "active") {
        return { ...base, lifecycle: "active" };
      }
      if (input.lifecycle === "trashed") {
        if (
          input.trashedAt === null ||
          input.trashedAt === undefined ||
          input.purgeAfter === null ||
          input.purgeAfter === undefined
        ) {
          throw invalid("missing trash timestamps");
        }
        return {
          ...base,
          lifecycle: "trashed",
          trashedAt: input.trashedAt,
          purgeAfter: input.purgeAfter,
        };
      }
      throw invalid(`invalid lifecycle: ${input.lifecycle}`);
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct Note ${input.id}`,
        error,
      );
    }
  },
};

function invalid(message: string): BusinessRuleError<NoteErrorCode> {
  return new BusinessRuleError(NoteErrorCode.InvalidId, message);
}

function reconstructOwner(ownerType: string, ownerId: string): NoteOwner {
  if (ownerType === "user") {
    return NoteOwner.user(UserId.create(ownerId));
  }
  if (ownerType === "workspace") {
    return NoteOwner.workspace(WorkspaceId.create(ownerId));
  }
  throw new BusinessRuleError(
    NoteErrorCode.InvalidOwner,
    `Invalid owner type: ${ownerType}`,
  );
}

function reconstructTitleOrigin(raw: string): "auto" | "manual" {
  if (raw !== "auto" && raw !== "manual") {
    throw invalid(`invalid title origin: ${raw}`);
  }
  return raw;
}

const NOTE_FAILURE_REASONS: ReadonlySet<string> = new Set([
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

function reconstructContent(input: ReconstructInput): NoteContent {
  switch (input.contentStatus) {
    case "processing":
      return { status: "processing" };
    case "awaitingIntegration":
      return { status: "awaitingIntegration" };
    case "failed": {
      const reason = input.failureReason;
      if (
        reason === null ||
        reason === undefined ||
        !NOTE_FAILURE_REASONS.has(reason)
      ) {
        throw invalid(`invalid failure reason: ${reason}`);
      }
      return { status: "failed", reason: reason as NoteFailureReason };
    }
    case "ready":
      return {
        status: "ready",
        html: NoteHtml.create(input.html ?? ""),
        text: PlainTextContent.create(input.text ?? ""),
        excerpt: Excerpt.create(input.excerpt ?? ""),
        headings: capHeadings((input.headings ?? []).map(NoteHeading.create)),
      };
    default:
      throw invalid(`invalid content status: ${input.contentStatus}`);
  }
}

function reconstructShareLink(input: ReconstructShareLinkInput): ShareLink {
  if ((input.passwordHash === null) !== (input.passwordUpdatedAt === null)) {
    throw invalid("share password hash and updatedAt must be set together");
  }
  return ShareLink.create({
    tokenHash: TokenHash.create(input.tokenHash),
    protectedToken: {
      cipherText: input.cipherText,
      keyVersion: input.keyVersion,
    },
    password:
      input.passwordHash !== null && input.passwordUpdatedAt !== null
        ? {
            hash: PasswordHash.create(input.passwordHash),
            updatedAt: input.passwordUpdatedAt,
          }
        : null,
    issuedAt: input.issuedAt,
  });
}

function reconstructVisibility(input: ReconstructInput): NoteVisibility {
  const dormant =
    input.dormantShareLink !== undefined && input.dormantShareLink !== null
      ? reconstructShareLink(input.dormantShareLink)
      : null;
  switch (input.visibilityStatus) {
    case "private":
      return { status: "private", dormantShareLink: dormant };
    case "unlisted": {
      if (input.shareLink === undefined || input.shareLink === null) {
        throw invalid("unlisted note requires a share link");
      }
      return {
        status: "unlisted",
        shareLink: reconstructShareLink(input.shareLink),
      };
    }
    case "public": {
      if (input.publishedAt === undefined || input.publishedAt === null) {
        throw invalid("public note requires publishedAt");
      }
      if (dormant !== null && dormant.password !== null) {
        throw invalid("public note cannot hold a share password");
      }
      return {
        status: "public",
        publishedAt: input.publishedAt,
        dormantShareLink: dormant,
      };
    }
    default:
      throw invalid(`invalid visibility status: ${input.visibilityStatus}`);
  }
}
