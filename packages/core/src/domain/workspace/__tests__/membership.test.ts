import { isBusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { WorkspaceErrorCode } from "../errorCode";
import { Membership } from "../membership";
import { WorkspaceId } from "../valueObject";

/** DOM-workspace-009 (spec/domains/workspace.md#エンティティ). */

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T1 = new Date("2026-01-02T00:00:00.000Z");
const WORKSPACE = WorkspaceId.create("ws-1");
const MEMBER = UserId.create("member-1");

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

const create = (role: string) =>
  Membership.create(
    { id: "m-1", workspaceId: WORKSPACE, userId: MEMBER, role },
    T0,
  );

describe("Membership.create", () => {
  it("holds workspace, user and role and emits membership.added", () => {
    const { entity, eventDrafts } = create("editor");

    expect(entity).toMatchObject({
      id: "m-1",
      workspaceId: WORKSPACE,
      userId: MEMBER,
      role: "editor",
      version: 0,
      joinedAt: T0,
      updatedAt: T0,
    });
    expect(eventDrafts).toEqual([
      {
        type: "workspace.membership.added",
        payload: { workspaceId: WORKSPACE, userId: MEMBER, role: "editor" },
        occurredAt: T0,
        aggregateId: WORKSPACE,
      },
    ]);
  });

  it("rejects an unknown role with InvalidRole", () => {
    expect(codeOf(() => create("admin"))).toBe(WorkspaceErrorCode.InvalidRole);
  });
});

describe("Membership.changeRole", () => {
  it("emits membership.roleChanged with both roles and bumps the version", () => {
    const membership = create("editor").entity;
    const result = Membership.changeRole(membership, "owner", T1);

    expect(result.entity).toMatchObject({
      role: "owner",
      version: 1,
      updatedAt: T1,
      joinedAt: T0,
    });
    expect(result.eventDrafts).toEqual([
      {
        type: "workspace.membership.roleChanged",
        payload: {
          workspaceId: WORKSPACE,
          userId: MEMBER,
          previousRole: "editor",
          currentRole: "owner",
          sourceVersion: 1,
        },
        occurredAt: T1,
        aggregateId: WORKSPACE,
      },
    ]);
  });

  it("changes nothing and emits nothing when the role is already held", () => {
    const membership = create("editor").entity;
    const result = Membership.changeRole(membership, "editor", T1);

    expect(result.entity).toBe(membership);
    expect(result.entity.version).toBe(0);
    expect(result.entity.updatedAt).toEqual(T0);
    expect(result.eventDrafts).toEqual([]);
  });

  it("rejects an unknown target role before touching the membership", () => {
    const membership = create("editor").entity;
    expect(codeOf(() => Membership.changeRole(membership, "admin", T1))).toBe(
      WorkspaceErrorCode.InvalidRole,
    );
    expect(membership.role).toBe("editor");
  });
});

describe("Membership.reconstruct", () => {
  it("round-trips a stored row", () => {
    const membership = Membership.reconstruct({
      id: "m-1",
      workspaceId: "ws-1",
      userId: "member-1",
      role: "viewer",
      version: 4,
      joinedAt: T0,
      updatedAt: T1,
    });
    expect(membership).toMatchObject({
      id: "m-1",
      workspaceId: "ws-1",
      userId: "member-1",
      role: "viewer",
      version: 4,
    });
  });

  it("wraps an invalid stored role in a RehydrationError", () => {
    expect(() =>
      Membership.reconstruct({
        id: "m-1",
        workspaceId: "ws-1",
        userId: "member-1",
        role: "admin",
        version: 0,
        joinedAt: T0,
        updatedAt: T0,
      }),
    ).toThrow(RehydrationError);
  });

  it("wraps a blank stored id in a RehydrationError", () => {
    expect(() =>
      Membership.reconstruct({
        id: "  ",
        workspaceId: "ws-1",
        userId: "member-1",
        role: "viewer",
        version: 0,
        joinedAt: T0,
        updatedAt: T0,
      }),
    ).toThrow(RehydrationError);
  });
});
