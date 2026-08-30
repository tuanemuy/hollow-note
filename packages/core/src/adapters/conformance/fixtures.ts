import { ScopeKey } from "../../application/scope";
import {
  AuthToken,
  type PendingAuthToken,
} from "../../domain/identity/authToken";
import {
  Identity,
  type PasswordIdentity,
} from "../../domain/identity/identity";
import { Session } from "../../domain/identity/session";
import {
  type ActiveUser,
  type PendingUser,
  User,
} from "../../domain/identity/user";
import {
  type AuthTokenPurpose,
  PasswordHash,
  TokenHash,
  UserId,
} from "../../domain/identity/valueObject";
import { type ActiveNote, Note } from "../../domain/note/note";
import { NoteRevision } from "../../domain/note/noteRevision";
import type { NoteProjectionEntry } from "../../domain/note/ports/localNoteProjectionWriter";
import { NoteId, NoteOwner } from "../../domain/note/valueObject";
import {
  Invitation,
  type PendingInvitation,
} from "../../domain/workspace/invitation";
import { Membership } from "../../domain/workspace/membership";
import {
  InvitationId,
  MembershipId,
  WorkspaceId,
  type WorkspaceRole,
} from "../../domain/workspace/valueObject";
import {
  type PrivateWorkspace,
  Workspace,
} from "../../domain/workspace/workspace";

export const at = (iso: string): Date => new Date(iso);

export const userId = (n: number): UserId => UserId.create(`user-${n}`);

export const scopeOf = (n: number): ScopeKey => ScopeKey.user(userId(n));

export function makePendingUser(n: number, now: Date): PendingUser {
  return User.create(
    {
      id: `user-${n}`,
      email: `user-${n}@example.com`,
      displayName: `User ${n}`,
    },
    now,
  ).entity;
}

export function makeActiveUser(n: number, now: Date): ActiveUser {
  return User.createVerified(
    {
      id: `user-${n}`,
      email: `user-${n}@example.com`,
      displayName: `User ${n}`,
    },
    now,
  ).entity;
}

export function makePasswordIdentity(
  n: number,
  owner: UserId,
  now: Date,
): PasswordIdentity {
  return Identity.createPassword(
    {
      id: `identity-${n}`,
      userId: owner,
      passwordHash: PasswordHash.create(`hash-${n}`),
    },
    now,
  ).entity;
}

export function makeSession(n: number, owner: UserId, now: Date): Session {
  return Session.create(
    {
      id: `session-${n}`,
      userId: owner,
      tokenHash: TokenHash.create(`session-hash-${n}`),
      authEpoch: 0,
    },
    now,
  );
}

export function makeAuthToken(
  n: number,
  owner: UserId,
  purpose: AuthTokenPurpose,
  now: Date,
): PendingAuthToken {
  return AuthToken.issue(
    {
      id: `auth-token-${n}`,
      userId: owner,
      purpose,
      tokenHash: TokenHash.create(`auth-token-hash-${n}`),
      authEpoch: 0,
    },
    now,
  );
}

export function makeBlankNote(
  n: number,
  owner: UserId,
  now: Date,
  title = `Note ${n}`,
): ActiveNote {
  return Note.createBlank(
    {
      id: `note-${String(n).padStart(3, "0")}`,
      owner: NoteOwner.user(owner),
      createdBy: owner,
      title,
      projectionRevision: 1,
    },
    now,
  ).entity;
}

export const noteId = (n: number): NoteId =>
  NoteId.create(`note-${String(n).padStart(3, "0")}`);

export function makeRevision(
  n: number,
  note: ActiveNote,
  now: Date,
): NoteRevision {
  return NoteRevision.capture(
    {
      id: `revision-${String(n).padStart(3, "0")}`,
      note,
      createdBy: note.createdBy,
      reason: "manualEdit",
    },
    now,
  );
}

export const workspaceId = (n: number): WorkspaceId =>
  WorkspaceId.create(`workspace-${n}`);

export const membershipId = (n: number): MembershipId =>
  MembershipId.create(`membership-${String(n).padStart(3, "0")}`);

export const invitationId = (n: number): InvitationId =>
  InvitationId.create(`invitation-${String(n).padStart(3, "0")}`);

/** The token hash `makeInvitation(n, …)` issues its invitation with. */
export const invitationTokenHash = (n: number): TokenHash =>
  TokenHash.create(`invitation-hash-${n}`);

export const workspaceScopeOf = (n: number): ScopeKey =>
  ScopeKey.workspace(workspaceId(n));

export function makeWorkspace(
  n: number,
  owner: UserId,
  now: Date,
  slug: string | null = `workspace-${n}`,
): PrivateWorkspace {
  return Workspace.create(
    {
      id: `workspace-${n}`,
      ownerId: owner,
      name: `Workspace ${n}`,
      description: `Description of workspace ${n}`,
      slug,
    },
    now,
  ).entity;
}

export function makeMembership(
  n: number,
  workspace: WorkspaceId,
  member: UserId,
  role: WorkspaceRole,
  now: Date,
): Membership {
  return Membership.create(
    {
      id: `membership-${String(n).padStart(3, "0")}`,
      workspaceId: workspace,
      userId: member,
      role,
    },
    now,
  ).entity;
}

export function makeInvitation(
  n: number,
  workspace: WorkspaceId,
  invitedBy: UserId,
  now: Date,
  overrides: Readonly<{ email?: string; role?: WorkspaceRole }> = {},
): PendingInvitation {
  return Invitation.issue(
    {
      id: `invitation-${String(n).padStart(3, "0")}`,
      workspaceId: workspace,
      email: overrides.email ?? `invitee-${n}@example.com`,
      role: overrides.role ?? "editor",
      invitedBy,
      tokenHash: invitationTokenHash(n),
    },
    now,
  ).entity;
}

export function makeProjectionEntry(
  n: number,
  owner: UserId,
  now: Date,
  overrides: Partial<NoteProjectionEntry> = {},
): NoteProjectionEntry {
  return {
    noteId: noteId(n),
    owner: NoteOwner.user(owner),
    createdBy: owner,
    author: { displayName: `User ${n}`, handle: null, version: 1 },
    workspace: null,
    title: `Note ${n}`,
    text: `Body of note ${n}`,
    excerpt: `Body of note ${n}`,
    visibility: "private",
    contentStatus: "ready",
    styleMode: "default",
    hasSourceFile: false,
    lifecycle: "active",
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    purgeAfter: null,
    ...overrides,
  };
}
