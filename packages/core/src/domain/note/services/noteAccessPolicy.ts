import { BusinessRuleError } from "@repo/core/domain/error";
import type { TokenHash, UserId } from "@repo/core/domain/identity/valueObject";
import type { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import type { WorkspaceRole } from "@repo/core/domain/workspace/valueObject";
import { NoteErrorCode } from "../errorCode";
import type { Note } from "../note";
import { type ShareLink, SharePass } from "../valueObject";

export type NoteViewer =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{
      kind: "user";
      userId: UserId;
      workspaceRole: WorkspaceRole | null;
    }>;

export type ShareCredential = Readonly<{
  /** Hash of the presented share token, if any. */
  tokenHash: TokenHash | null;
  /** Client-held password pass, if any. */
  pass: SharePass | null;
}>;

export type NoteAccess =
  | Readonly<{
      kind: "granted";
      canEdit: boolean;
      canDelete: boolean;
      canChangeVisibility: boolean;
    }>
  | Readonly<{ kind: "passwordRequired" }>
  | Readonly<{ kind: "denied" }>;

export interface NoteAccessPolicy {
  evaluate(
    note: Note,
    viewer: NoteViewer,
    credential: ShareCredential,
    now: Date,
  ): NoteAccess;
  ensureCanEdit(note: Note, viewer: NoteViewer): void;
  isPassValid(link: ShareLink, pass: SharePass | null, now: Date): boolean;
  issuePass(link: ShareLink, now: Date): SharePass;
}

const NO_CREDENTIAL: ShareCredential = { tokenHash: null, pass: null };

const READ_ONLY_ACCESS: NoteAccess = {
  kind: "granted",
  canEdit: false,
  canDelete: false,
  canChangeVisibility: false,
};

/**
 * Decides what a viewer may do with a note. Evaluation order
 * (spec/domains/note.md): ownership → trash barrier → public → unlisted
 * with a matching token → denied. Only the ownership path can reach a
 * trashed note. `WorkspaceAuthorization` is injected as a domain service;
 * in the walking-skeleton slice every call takes the personal path.
 */
export function createNoteAccessPolicy(
  authorization: WorkspaceAuthorization,
): NoteAccessPolicy {
  const policy: NoteAccessPolicy = {
    evaluate: (note, viewer, credential, now) => {
      // 1. Ownership.
      if (viewer.kind === "user") {
        if (note.owner.type === "user" && note.owner.userId === viewer.userId) {
          return {
            kind: "granted",
            canEdit: true,
            canDelete: true,
            canChangeVisibility: true,
          };
        }
        if (note.owner.type === "workspace" && viewer.workspaceRole !== null) {
          const role = viewer.workspaceRole;
          if (
            note.lifecycle === "trashed" &&
            !authorization.can(role, "viewTrash")
          ) {
            return { kind: "denied" };
          }
          return {
            kind: "granted",
            canEdit: authorization.can(role, "editNote"),
            canDelete: authorization.can(role, "deleteNote"),
            canChangeVisibility: authorization.can(
              role,
              "changeNoteVisibility",
            ),
          };
        }
      }
      // 2. Trash barrier: viewers not settled by ownership never reach a
      // trashed note.
      if (note.lifecycle === "trashed") {
        return { kind: "denied" };
      }
      // 3. Public.
      if (note.visibility.status === "public") {
        return READ_ONLY_ACCESS;
      }
      // 4. Unlisted with a matching token.
      if (
        note.visibility.status === "unlisted" &&
        credential.tokenHash !== null &&
        credential.tokenHash === note.visibility.shareLink.tokenHash
      ) {
        const link = note.visibility.shareLink;
        if (
          link.password !== null &&
          !policy.isPassValid(link, credential.pass, now)
        ) {
          return { kind: "passwordRequired" };
        }
        return READ_ONLY_ACCESS;
      }
      // 5. Everything else.
      return { kind: "denied" };
    },

    ensureCanEdit: (note, viewer) => {
      // `now` does not influence the ownership path, which is the only
      // one that can yield canEdit — an epoch value keeps this pure.
      const access = policy.evaluate(note, viewer, NO_CREDENTIAL, new Date(0));
      if (access.kind !== "granted" || !access.canEdit) {
        throw new BusinessRuleError(
          NoteErrorCode.AccessDenied,
          "The viewer cannot edit this note",
        );
      }
    },

    isPassValid: (link, pass, now) => {
      if (pass === null || link.password === null) {
        return false;
      }
      if (pass.tokenHash !== link.tokenHash) {
        return false;
      }
      if (now.getTime() - pass.issuedAt.getTime() >= SharePass.ttlMs) {
        return false;
      }
      return (
        pass.passwordUpdatedAt.getTime() === link.password.updatedAt.getTime()
      );
    },

    issuePass: (link, now) => {
      if (link.password === null) {
        throw new BusinessRuleError(
          NoteErrorCode.AccessDenied,
          "Cannot issue a pass for an unprotected share link",
        );
      }
      return {
        tokenHash: link.tokenHash,
        passwordUpdatedAt: link.password.updatedAt,
        issuedAt: now,
      };
    },
  };
  return policy;
}
