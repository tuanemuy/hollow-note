import {
  isBusinessRuleError,
  isRehydrationError,
} from "@repo/core/domain/error";
import { describe, expect, it } from "vitest";
import { User } from "../user";

const T0 = new Date(0);
const at = (ms: number) => new Date(ms);

const createActive = () => {
  const { entity: pending } = User.create(
    { id: "u1", email: "a@example.com", displayName: "Alice" },
    T0,
  );
  return User.verifyEmail(pending, at(1000)).entity;
};

describe("User.create", () => {
  it("creates a pending user with authEpoch 0 / version 0 and emits user.created", () => {
    const { entity, eventDrafts } = User.create(
      { id: "u1", email: "A@Example.com", displayName: "Alice" },
      T0,
    );
    expect(entity.status).toBe("pending");
    expect(entity.email).toBe("a@example.com");
    expect(entity.authEpoch).toBe(0);
    expect(entity.version).toBe(0);
    expect(entity.handle).toBeNull();
    expect(eventDrafts.map((d) => d.type)).toEqual(["identity.user.created"]);
  });
});

describe("User.createVerified", () => {
  it("creates an active user and emits created + emailVerified", () => {
    const { entity, eventDrafts } = User.createVerified(
      { id: "u1", email: "a@example.com", displayName: "Alice" },
      T0,
    );
    expect(entity.status).toBe("active");
    expect(entity.verifiedAt).toEqual(T0);
    expect(eventDrafts.map((d) => d.type)).toEqual([
      "identity.user.created",
      "identity.user.emailVerified",
    ]);
  });
});

describe("User.verifyEmail", () => {
  it("transitions pending → active, bumping the version", () => {
    const { entity: pending } = User.create(
      { id: "u1", email: "a@example.com", displayName: "Alice" },
      T0,
    );
    const { entity, eventDrafts } = User.verifyEmail(pending, at(500));
    expect(entity.status).toBe("active");
    expect(entity.verifiedAt).toEqual(at(500));
    expect(entity.version).toBe(1);
    expect(eventDrafts.map((d) => d.type)).toEqual([
      "identity.user.emailVerified",
    ]);
  });
});

describe("User.updateProfile", () => {
  it("emits profileUpdated only when displayName changes", () => {
    const active = createActive();
    const changed = User.updateProfile(
      active,
      { displayName: "Bob" },
      at(2000),
    );
    expect(changed.eventDrafts.map((d) => d.type)).toEqual([
      "identity.user.profileUpdated",
    ]);
    const bioOnly = User.updateProfile(active, { bio: "hello" }, at(2000));
    expect(bioOnly.entity.bio).toBe("hello");
    expect(bioOnly.eventDrafts).toHaveLength(0);
  });

  it("leaves unspecified fields untouched and clears avatarUrl with null", () => {
    const active = createActive();
    const { entity } = User.updateProfile(active, { avatarUrl: null }, at(2));
    expect(entity.displayName).toBe(active.displayName);
    expect(entity.avatarUrl).toBeNull();
  });
});

describe("User.assignHandle / clearHandle", () => {
  it("emits handleChanged with previousHandle null on first assignment", () => {
    const active = createActive();
    const { entity, eventDrafts } = User.assignHandle(active, "alice", at(3));
    expect(entity.handle).toBe("alice");
    expect(eventDrafts).toHaveLength(1);
    const draft = eventDrafts[0];
    expect(draft?.type).toBe("identity.user.handleChanged");
    expect(draft?.payload).toMatchObject({
      previousHandle: null,
      currentHandle: "alice",
    });
  });

  it("carries the old handle on change and on clear", () => {
    const active = createActive();
    const withHandle = User.assignHandle(active, "alice", at(3)).entity;
    const changed = User.assignHandle(withHandle, "alice2", at(4));
    expect(changed.eventDrafts[0]?.payload).toMatchObject({
      previousHandle: "alice",
      currentHandle: "alice2",
    });
    const cleared = User.clearHandle(withHandle, at(5));
    expect(cleared.entity.handle).toBeNull();
    expect(cleared.eventDrafts[0]?.payload).toMatchObject({
      previousHandle: "alice",
      currentHandle: null,
    });
  });
});

describe("auth epoch transitions", () => {
  it("advanceAuthEpoch increments monotonically", () => {
    const active = createActive();
    const once = User.advanceAuthEpoch(active, at(6));
    const twice = User.advanceAuthEpoch(once, at(7));
    expect(once.authEpoch).toBe(active.authEpoch + 1);
    expect(twice.authEpoch).toBe(active.authEpoch + 2);
  });

  it("beginDeletion advances the epoch and records the operation id", () => {
    const active = createActive();
    const deleting = User.beginDeletion(active, "op-1", at(8));
    expect(deleting.status).toBe("deleting");
    expect(deleting.deletionOperationId).toBe("op-1");
    expect(deleting.authEpoch).toBe(active.authEpoch + 1);
  });
});

describe("User deletion", () => {
  it("rejectDeletion returns to active only for the owning operation", () => {
    const deleting = User.beginDeletion(createActive(), "op-1", at(8));
    const active = User.rejectDeletion(deleting, "op-1", at(9));
    expect(active.status).toBe("active");
    expect("deletionOperationId" in active).toBe(false);
    expect(() => User.rejectDeletion(deleting, "op-2", at(9))).toThrowError();
  });

  it("finalizeDeletion drops PII and emits user.deleted", () => {
    const deleting = User.beginDeletion(createActive(), "op-1", at(8));
    const { entity, eventDrafts } = User.finalizeDeletion(
      deleting,
      "op-1",
      at(10),
    );
    expect(entity.status).toBe("deleted");
    expect(entity.deletedAt).toEqual(at(10));
    expect("email" in entity).toBe(false);
    expect("displayName" in entity).toBe(false);
    expect(eventDrafts.map((d) => d.type)).toEqual(["identity.user.deleted"]);
    expect(eventDrafts[0]?.payload).toMatchObject({
      deletionOperationId: "op-1",
    });
  });

  it("finalizeDeletion refuses a foreign operation id", () => {
    const deleting = User.beginDeletion(createActive(), "op-1", at(8));
    expect(() =>
      User.finalizeDeletion(deleting, "op-9", at(10)),
    ).toThrowError();
  });
});

describe("User.reconstruct", () => {
  it("round-trips an active user", () => {
    const user = User.reconstruct({
      id: "u1",
      status: "active",
      email: "a@example.com",
      displayName: "Alice",
      bio: "",
      avatarUrl: null,
      handle: "alice",
      authEpoch: 2,
      version: 5,
      createdAt: T0,
      updatedAt: at(1),
      verifiedAt: at(1),
    });
    expect(user.status).toBe("active");
    if (user.status === "active") {
      expect(user.handle).toBe("alice");
      expect(user.authEpoch).toBe(2);
    }
  });

  it("reconstructs a deleted tombstone without PII fields", () => {
    const user = User.reconstruct({
      id: "u1",
      status: "deleted",
      authEpoch: 3,
      version: 9,
      createdAt: T0,
      updatedAt: at(2),
      deletedAt: at(2),
    });
    expect(user.status).toBe("deleted");
    expect("email" in user).toBe(false);
  });

  it("wraps invariant violations in RehydrationError, preserving the cause", () => {
    try {
      User.reconstruct({
        id: "u1",
        status: "active",
        email: "not-an-email",
        displayName: "Alice",
        authEpoch: 0,
        version: 0,
        createdAt: T0,
        updatedAt: T0,
        verifiedAt: T0,
      });
      expect.unreachable();
    } catch (error) {
      expect(isRehydrationError(error)).toBe(true);
      if (isRehydrationError(error)) {
        expect(isBusinessRuleError(error.cause)).toBe(true);
      }
    }
  });

  it("rejects an unknown status", () => {
    expect(() =>
      User.reconstruct({
        id: "u1",
        status: "suspended",
        email: "a@example.com",
        displayName: "Alice",
        authEpoch: 0,
        version: 0,
        createdAt: T0,
        updatedAt: T0,
      }),
    ).toThrowError();
  });
});
