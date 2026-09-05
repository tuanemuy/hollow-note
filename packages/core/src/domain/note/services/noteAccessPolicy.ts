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
  /**
   * The pair of `ensureCanEdit` for the trash / purge paths. Kept
   * separate from it because the two capabilities part company for a
   * workspace role the moment `WorkspaceAuthorization` gives
   * `deleteNote` and `editNote` different minimum roles.
   */
  ensureCanDelete(note: Note, viewer: NoteViewer): void;
  isPassValid(link: ShareLink, pass: SharePass | null, now: Date): boolean;
  issuePass(link: ShareLink, now: Date): SharePass;
}

const NO_CREDENTIAL: ShareCredential = { tokenHash: null, pass: null };

// Constant-time equality over token hashes. Both sides are hashes, so a
// timing leak could only reveal the stored hash — not amplifiable into a
// token without a preimage — but the comparison stays constant time
// regardless, and a pure loop avoids pulling node:crypto into the domain.
// The early length exit only leaks the hash length, which is fixed by the
// hashing scheme.
const constantTimeHashEquals = (a: TokenHash, b: TokenHash): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const CAPABILITY_VERB = {
  canEdit: "edit",
  canDelete: "delete",
} as const;

const ensureCapability = (
  policy: NoteAccessPolicy,
  note: Note,
  viewer: NoteViewer,
  capability: keyof typeof CAPABILITY_VERB,
): void => {
  // `now` does not influence the ownership path, which is the only one
  // that can yield either capability — an epoch value keeps this pure.
  const access = policy.evaluate(note, viewer, NO_CREDENTIAL, new Date(0));
  if (access.kind !== "granted" || !access[capability]) {
    throw new BusinessRuleError(
      NoteErrorCode.AccessDenied,
      `The viewer cannot ${CAPABILITY_VERB[capability]} this note`,
    );
  }
};

const READ_ONLY_ACCESS: NoteAccess = {
  kind: "granted",
  canEdit: false,
  canDelete: false,
  canChangeVisibility: false,
};

/**
 * Decides what a viewer may do with a note. Evaluation order: ownership →
 * trash barrier → public → unlisted with a matching token → denied. Only
 * the ownership path can reach a trashed note. `WorkspaceAuthorization` is injected as a domain service
 * so the role table stays the single source of truth for every action.
 */
export function createNoteAccessPolicy(
  authorization: WorkspaceAuthorization,
): NoteAccessPolicy {
  const policy: NoteAccessPolicy = {
    evaluate: (note, viewer, credential, now) => {
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
      if (note.lifecycle === "trashed") {
        return { kind: "denied" };
      }
      if (note.visibility.status === "public") {
        return READ_ONLY_ACCESS;
      }
      if (
        note.visibility.status === "unlisted" &&
        credential.tokenHash !== null &&
        constantTimeHashEquals(
          credential.tokenHash,
          note.visibility.shareLink.tokenHash,
        )
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
      return { kind: "denied" };
    },

    ensureCanEdit: (note, viewer) => {
      ensureCapability(policy, note, viewer, "canEdit");
    },

    ensureCanDelete: (note, viewer) => {
      ensureCapability(policy, note, viewer, "canDelete");
    },

    isPassValid: (link, pass, now) => {
      if (pass === null || link.password === null) {
        return false;
      }
      if (!constantTimeHashEquals(pass.tokenHash, link.tokenHash)) {
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
