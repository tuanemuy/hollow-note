import { isBusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import { TokenHash, UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { WorkspaceErrorCode } from "../errorCode";
import { Invitation, type PendingInvitation } from "../invitation";
import { WorkspaceId } from "../valueObject";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 14 * DAY_MS;
const EXPIRES_AT = new Date(T0.getTime() + TTL_MS);

const WORKSPACE = WorkspaceId.create("ws-1");
const INVITER = UserId.create("owner-1");
const INVITEE = UserId.create("invitee-1");
const HASH = TokenHash.create("hash-1");
const NEW_HASH = TokenHash.create("hash-2");

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isBusinessRuleError(error) ? error.code : null;
  }
};

const issue = (): PendingInvitation =>
  Invitation.issue(
    {
      id: "i-1",
      workspaceId: WORKSPACE,
      email: "invitee@example.com",
      role: "editor",
      invitedBy: INVITER,
      tokenHash: HASH,
    },
    T0,
  ).entity;

describe("Invitation.issue", () => {
  it("opens a 14-day window and emits invitation.created", () => {
    const { entity, eventDrafts } = Invitation.issue(
      {
        id: "i-1",
        workspaceId: WORKSPACE,
        email: "Invitee@Example.com",
        role: "editor",
        invitedBy: INVITER,
        tokenHash: HASH,
      },
      T0,
    );

    expect(entity).toMatchObject({
      status: "pending",
      id: "i-1",
      workspaceId: WORKSPACE,
      role: "editor",
      invitedBy: INVITER,
      tokenHash: HASH,
      version: 0,
      createdAt: T0,
      expiresAt: EXPIRES_AT,
    });
    expect(eventDrafts).toEqual([
      {
        type: "workspace.invitation.created",
        payload: {
          invitationId: "i-1",
          workspaceId: WORKSPACE,
          email: entity.email,
          role: "editor",
        },
        occurredAt: T0,
        aggregateId: WORKSPACE,
      },
    ]);
  });

  it("rejects an unknown role", () => {
    expect(
      codeOf(() =>
        Invitation.issue(
          {
            id: "i-1",
            workspaceId: WORKSPACE,
            email: "invitee@example.com",
            role: "admin",
            invitedBy: INVITER,
            tokenHash: HASH,
          },
          T0,
        ),
      ),
    ).toBe(WorkspaceErrorCode.InvalidRole);
  });
});

describe("Invitation.isExpired", () => {
  it("treats the expiry instant itself as expired", () => {
    const invitation = issue();
    expect(
      Invitation.isExpired(invitation, new Date(EXPIRES_AT.getTime() - 1)),
    ).toBe(false);
    expect(Invitation.isExpired(invitation, EXPIRES_AT)).toBe(true);
    expect(
      Invitation.isExpired(invitation, new Date(EXPIRES_AT.getTime() + 1)),
    ).toBe(true);
  });
});

describe("Invitation.resend", () => {
  it("swaps the token, restarts the window and re-emits invitation.created", () => {
    const later = new Date(T0.getTime() + DAY_MS);
    const result = Invitation.resend(issue(), NEW_HASH, later);

    expect(result.entity).toMatchObject({
      status: "pending",
      tokenHash: NEW_HASH,
      version: 1,
      createdAt: T0,
      expiresAt: new Date(later.getTime() + TTL_MS),
    });
    expect(result.eventDrafts).toEqual([
      {
        type: "workspace.invitation.created",
        payload: {
          invitationId: "i-1",
          workspaceId: WORKSPACE,
          email: result.entity.email,
          role: "editor",
        },
        occurredAt: later,
        aggregateId: WORKSPACE,
      },
    ]);
  });
});

describe("Invitation.accept", () => {
  it("records who accepted and when, and emits invitation.accepted", () => {
    const at = new Date(T0.getTime() + DAY_MS);
    const result = Invitation.accept(issue(), INVITEE, at);

    expect(result.entity).toMatchObject({
      status: "accepted",
      acceptedAt: at,
      acceptedBy: INVITEE,
      version: 1,
    });
    expect(result.eventDrafts).toEqual([
      {
        type: "workspace.invitation.accepted",
        payload: {
          invitationId: "i-1",
          workspaceId: WORKSPACE,
          userId: INVITEE,
        },
        occurredAt: at,
        aggregateId: WORKSPACE,
      },
    ]);
  });

  it("accepts one millisecond before the window closes", () => {
    const result = Invitation.accept(
      issue(),
      INVITEE,
      new Date(EXPIRES_AT.getTime() - 1),
    );
    expect(result.entity.status).toBe("accepted");
  });

  it("refuses at the expiry instant with InvitationExpired", () => {
    expect(codeOf(() => Invitation.accept(issue(), INVITEE, EXPIRES_AT))).toBe(
      WorkspaceErrorCode.InvitationExpired,
    );
  });
});

describe("Invitation.revoke", () => {
  it("stamps revokedAt and emits invitation.revoked", () => {
    const at = new Date(T0.getTime() + DAY_MS);
    const result = Invitation.revoke(issue(), at);

    expect(result.entity).toMatchObject({
      status: "revoked",
      revokedAt: at,
      version: 1,
    });
    expect(Invitation.isPending(result.entity)).toBe(false);
    expect(result.eventDrafts).toEqual([
      {
        type: "workspace.invitation.revoked",
        payload: { invitationId: "i-1", workspaceId: WORKSPACE },
        occurredAt: at,
        aggregateId: WORKSPACE,
      },
    ]);
  });
});

describe("Invitation.reconstruct", () => {
  const base = {
    id: "i-1",
    workspaceId: "ws-1",
    email: "invitee@example.com",
    role: "editor",
    invitedBy: "owner-1",
    tokenHash: "hash-1",
    version: 2,
    createdAt: T0,
    expiresAt: EXPIRES_AT,
  } as const;

  it("round-trips each of the three statuses", () => {
    expect(Invitation.reconstruct({ ...base, status: "pending" }).status).toBe(
      "pending",
    );
    expect(
      Invitation.reconstruct({
        ...base,
        status: "accepted",
        acceptedAt: T0,
        acceptedBy: "invitee-1",
      }),
    ).toMatchObject({ status: "accepted", acceptedBy: "invitee-1" });
    expect(
      Invitation.reconstruct({ ...base, status: "revoked", revokedAt: T0 }),
    ).toMatchObject({ status: "revoked", revokedAt: T0 });
  });

  it("refuses an accepted row missing acceptedAt or acceptedBy", () => {
    expect(() =>
      Invitation.reconstruct({
        ...base,
        status: "accepted",
        acceptedBy: "invitee-1",
      }),
    ).toThrow(RehydrationError);
    expect(() =>
      Invitation.reconstruct({ ...base, status: "accepted", acceptedAt: T0 }),
    ).toThrow(RehydrationError);
  });

  it("refuses a revoked row missing revokedAt", () => {
    expect(() =>
      Invitation.reconstruct({ ...base, status: "revoked" }),
    ).toThrow(RehydrationError);
  });

  it("refuses an unknown status", () => {
    expect(() =>
      Invitation.reconstruct({ ...base, status: "expired" }),
    ).toThrow(RehydrationError);
  });
});
