import {
  PasswordHash,
  TokenHash,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import {
  WorkspaceId,
  type WorkspaceRole,
} from "@repo/core/domain/workspace/valueObject";
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

describe("NoteAccessPolicy.ensureCanDelete", () => {
  const workspacePolicy = createNoteAccessPolicy(WorkspaceAuthorization);
  const workspaceNote = (lifecycle: "active" | "trashed" = "active") => {
    const note = Note.createBlank(
      {
        id: "n2",
        owner: NoteOwner.workspace(WorkspaceId.create("w1")),
        createdBy: ownerId,
        title: "",
        projectionRevision: 1,
      },
      T0,
    ).entity;
    return lifecycle === "active" ? note : Note.trash(note, at(2)).entity;
  };
  const member = (role: WorkspaceRole): NoteViewer => ({
    kind: "user",
    userId: UserId.create("u3"),
    workspaceRole: role,
  });

  it("passes for the personal owner and throws AccessDenied for everyone else", () => {
    expect(() => policy.ensureCanDelete(blank(), ownerViewer)).not.toThrow();
    expect(() =>
      policy.ensureCanDelete(publicNote(), strangerViewer),
    ).toThrow();
    expect(() => policy.ensureCanDelete(blank(), anonymous)).toThrow();
  });

  it("reports AccessDenied naming the refused action", () => {
    expect(() => policy.ensureCanDelete(blank(), anonymous)).toThrow(
      /cannot delete this note/,
    );
    expect(() => policy.ensureCanEdit(blank(), anonymous)).toThrow(
      /cannot edit this note/,
    );
  });

  it("follows the workspace role table rather than the edit verdict", () => {
    for (const role of ["owner", "editor"] as const) {
      expect(() =>
        workspacePolicy.ensureCanDelete(workspaceNote(), member(role)),
      ).not.toThrow();
    }
    expect(() =>
      workspacePolicy.ensureCanDelete(workspaceNote(), member("viewer")),
    ).toThrow();
  });

  it("still passes on a trashed note, which is what purge needs", () => {
    expect(() =>
      policy.ensureCanDelete(Note.trash(blank(), at(2)).entity, ownerViewer),
    ).not.toThrow();
    expect(() =>
      workspacePolicy.ensureCanDelete(
        workspaceNote("trashed"),
        member("editor"),
      ),
    ).not.toThrow();
    // A viewer cannot even see the trash, so the trash barrier answers
    // before the delete verdict does.
    expect(() =>
      workspacePolicy.ensureCanDelete(
        workspaceNote("trashed"),
        member("viewer"),
      ),
    ).toThrow();
  });
});

describe("NoteOwnershipPolicy.ensureMovable", () => {
  const granted = {
    kind: "granted",
    canEdit: true,
    canDelete: true,
    canChangeVisibility: true,
  } as const;

  it("passes when editable and not processing", () => {
    expect(() =>
      NoteOwnershipPolicy.ensureMovable(blank(), granted),
    ).not.toThrow();
  });

  it("rejects when the source access lacks edit", () => {
    expect(() =>
      NoteOwnershipPolicy.ensureMovable(blank(), { kind: "denied" }),
    ).toThrowError();
    expect(() =>
      NoteOwnershipPolicy.ensureMovable(blank(), {
        ...granted,
        canEdit: false,
      }),
    ).toThrowError();
  });

  it("rejects a processing body with CannotMoveWhileProcessing", () => {
    const processing = {
      ...blank(),
      content: { status: "processing" } as const,
    };
    expect(() =>
      NoteOwnershipPolicy.ensureMovable(processing, granted),
    ).toThrowError(/processing/i);
  });
});
