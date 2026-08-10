import {
  PasswordHash,
  TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import type { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import { describe, expect, it } from "vitest";
import { Note } from "../note";
import {
  createNoteAccessPolicy,
  type NoteViewer,
  type ShareCredential,
} from "../services/noteAccessPolicy";
import { NoteOwnershipPolicy } from "../services/noteOwnershipPolicy";
import { NoteOwner, ShareLink, SharePass } from "../valueObject";

const T0 = new Date(0);
const at = (ms: number) => new Date(ms);

// The workspace path is out of this slice; the stub only satisfies the
// injected interface and must never be reached by these personal-path tests.
const unreachableAuthorization: WorkspaceAuthorization = {
  minimumRoleFor: () => {
    throw new Error("workspace path must not be reached");
  },
  can: () => {
    throw new Error("workspace path must not be reached");
  },
  ensureCan: () => {
    throw new Error("workspace path must not be reached");
  },
};

const policy = createNoteAccessPolicy(unreachableAuthorization);

const ownerId = UserId.create("u1");
const owner = NoteOwner.user(ownerId);
const ownerViewer: NoteViewer = {
  kind: "user",
  userId: ownerId,
  workspaceRole: null,
};
const strangerViewer: NoteViewer = {
  kind: "user",
  userId: UserId.create("u2"),
  workspaceRole: null,
};
const anonymous: NoteViewer = { kind: "anonymous" };
const noCredential: ShareCredential = { tokenHash: null, pass: null };

const makeLink = (token: string, passwordHash: string | null = null) =>
  ShareLink.create({
    tokenHash: TokenHash.create(token),
    protectedToken: { cipherText: `enc(${token})`, keyVersion: 1 },
    password:
      passwordHash === null
        ? null
        : { hash: PasswordHash.create(passwordHash), updatedAt: at(10) },
    issuedAt: T0,
  });

const blank = () =>
  Note.createBlank(
    { id: "n1", owner, createdBy: ownerId, title: "", projectionRevision: 1 },
    T0,
  ).entity;

const unlisted = (passwordHash: string | null = null) =>
  Note.makeUnlisted(blank(), makeLink("t1", passwordHash), at(1)).entity;

const publicNote = () => Note.makePublic(blank(), at(1)).entity;

describe("NoteAccessPolicy.evaluate — ownership first", () => {
  it("grants the personal owner full rights", () => {
    expect(policy.evaluate(blank(), ownerViewer, noCredential, T0)).toEqual({
      kind: "granted",
      canEdit: true,
      canDelete: true,
      canChangeVisibility: true,
    });
  });

  it("only the ownership path reaches a trashed note", () => {
    const trashed = Note.trash(publicNote(), at(2)).entity;
    const ownerAccess = policy.evaluate(trashed, ownerViewer, noCredential, T0);
    expect(ownerAccess.kind).toBe("granted");
    // Even a public note is denied to others once trashed (trash barrier
    // sits before the public rule).
    expect(policy.evaluate(trashed, strangerViewer, noCredential, T0)).toEqual({
      kind: "denied",
    });
    expect(policy.evaluate(trashed, anonymous, noCredential, T0)).toEqual({
      kind: "denied",
    });
  });
});

describe("NoteAccessPolicy.evaluate — public and unlisted", () => {
  it("grants anonymous read-only access to a public note", () => {
    expect(policy.evaluate(publicNote(), anonymous, noCredential, T0)).toEqual({
      kind: "granted",
      canEdit: false,
      canDelete: false,
      canChangeVisibility: false,
    });
  });

  it("denies others a private note", () => {
    expect(policy.evaluate(blank(), strangerViewer, noCredential, T0)).toEqual({
      kind: "denied",
    });
    expect(policy.evaluate(blank(), anonymous, noCredential, T0)).toEqual({
      kind: "denied",
    });
  });

  it("grants unlisted access only with the matching token", () => {
    const note = unlisted();
    const match: ShareCredential = {
      tokenHash: TokenHash.create("t1"),
      pass: null,
    };
    const mismatch: ShareCredential = {
      tokenHash: TokenHash.create("t9"),
      pass: null,
    };
    expect(policy.evaluate(note, anonymous, match, T0).kind).toBe("granted");
    expect(policy.evaluate(note, anonymous, mismatch, T0)).toEqual({
      kind: "denied",
    });
    expect(policy.evaluate(note, anonymous, noCredential, T0)).toEqual({
      kind: "denied",
    });
  });

  it("requires the password when protected and the pass is invalid", () => {
    const note = unlisted("pw");
    const credential: ShareCredential = {
      tokenHash: TokenHash.create("t1"),
      pass: null,
    };
    expect(policy.evaluate(note, anonymous, credential, at(20))).toEqual({
      kind: "passwordRequired",
    });
  });

  it("grants when a valid pass accompanies the token", () => {
    const note = unlisted("pw");
    if (note.visibility.status !== "unlisted") {
      expect.unreachable();
      return;
    }
    const pass = policy.issuePass(note.visibility.shareLink, at(20));
    const credential: ShareCredential = {
      tokenHash: TokenHash.create("t1"),
      pass,
    };
    expect(policy.evaluate(note, anonymous, credential, at(30)).kind).toBe(
      "granted",
    );
  });
});

describe("NoteAccessPolicy.isPassValid", () => {
  const link = makeLink("t1", "pw");

  it("is false without a pass or without a link password", () => {
    expect(policy.isPassValid(link, null, T0)).toBe(false);
    const pass = policy.issuePass(link, at(20));
    expect(policy.isPassValid(makeLink("t1"), pass, at(21))).toBe(false);
  });

  it("is false on token mismatch", () => {
    const pass = policy.issuePass(link, at(20));
    expect(policy.isPassValid(makeLink("t2", "pw"), pass, at(21))).toBe(false);
  });

  it("expires 24 hours after issue", () => {
    const pass = policy.issuePass(link, at(20));
    expect(policy.isPassValid(link, pass, at(20 + SharePass.ttlMs - 1))).toBe(
      true,
    );
    expect(policy.isPassValid(link, pass, at(20 + SharePass.ttlMs))).toBe(
      false,
    );
  });

  it("is false once the password generation changes", () => {
    const pass = policy.issuePass(link, at(20));
    const rotated = ShareLink.create({
      ...link,
      password: { hash: PasswordHash.create("pw2"), updatedAt: at(100) },
    });
    expect(policy.isPassValid(rotated, pass, at(101))).toBe(false);
  });
});

describe("NoteAccessPolicy.ensureCanEdit", () => {
  it("passes for the owner and throws AccessDenied otherwise", () => {
    expect(() => policy.ensureCanEdit(blank(), ownerViewer)).not.toThrow();
    expect(() => policy.ensureCanEdit(publicNote(), strangerViewer)).toThrow();
    expect(() => policy.ensureCanEdit(blank(), anonymous)).toThrow();
  });
});

describe("NoteOwnershipPolicy.ensureMovable", () => {
  const granted = {
    kind: "granted",
    canEdit: true,
    canDelete: true,
    canChangeVisibility: true,
  } as const;
  const target = { owner, canCreate: true };

  it("passes when editable, creatable, and not processing", () => {
    expect(() =>
      NoteOwnershipPolicy.ensureMovable(blank(), granted, target),
    ).not.toThrow();
  });

  it("rejects when the source access lacks edit or the target lacks create", () => {
    expect(() =>
      NoteOwnershipPolicy.ensureMovable(blank(), { kind: "denied" }, target),
    ).toThrowError();
    expect(() =>
      NoteOwnershipPolicy.ensureMovable(blank(), granted, {
        owner,
        canCreate: false,
      }),
    ).toThrowError();
  });

  it("rejects a processing body with CannotMoveWhileProcessing", () => {
    const processing = {
      ...blank(),
      content: { status: "processing" } as const,
    };
    expect(() =>
      NoteOwnershipPolicy.ensureMovable(processing, granted, target),
    ).toThrowError(/processing/i);
  });
});
