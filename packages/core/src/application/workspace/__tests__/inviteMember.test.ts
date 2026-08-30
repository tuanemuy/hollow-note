import { Email } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import type { ScopeUnitOfWorkProvider } from "../../execution/unitOfWork";
import type { MailMessage } from "../../ports/mailSender";
import { acceptInvitation } from "../acceptInvitation";
import { inviteMember } from "../inviteMember";
import type { IssuedInvitationView } from "../view";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectConflict,
  expectValidation,
  invitationRoutes,
  seedInvitation,
  seedUser,
  seedWorkspace,
  storedInvitation,
  type TestHarness,
  tokenOfInvitationUrl,
  workspaceScope,
} from "./harness";

/**
 * spec/testcases/workspace/inviteMember.md (TC-workspace-131〜146).
 *
 * TC-workspace-142 (a failing mail provider) lives in
 * `invitationResponse.test.ts` together with the resend / tail-call forms
 * of the same flag, and is deliberately not repeated here.
 */

const WORKSPACE = "workspace-1";
const OWNER = "owner-1";
const INVITEE = "invitee@example.com";

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITATION_TTL_MS = 14 * DAY_MS;
const QUOTA = 50;

const INSUFFICIENT_ROLE = "WORKSPACE_INSUFFICIENT_ROLE";

type InviteOverrides = Readonly<{
  userId?: string;
  email?: string;
  role?: string;
}>;

const invite = (
  h: TestHarness,
  overrides: InviteOverrides = {},
  container: RequestContainer = h.container,
): Promise<IssuedInvitationView> =>
  inviteMember({
    container,
    input: {
      workspaceId: WORKSPACE,
      userId: overrides.userId ?? OWNER,
      email: overrides.email ?? INVITEE,
      role: overrides.role ?? "editor",
    },
  });

/** Every invitation row of the workspace scope, seeded ones included. */
const storedInvitations = (h: TestHarness) =>
  h.backend.scope(workspaceScope(WORKSPACE)).invitations.values();

const seedOwnedWorkspace = (h: TestHarness, name = "Team Alpha") =>
  seedWorkspace(h, {
    workspaceId: WORKSPACE,
    name,
    members: [{ userId: OWNER, role: "owner", displayName: "Owner One" }],
  });

/**
 * Publishes the durable email claim of an already-seeded user.
 * `seedUser` writes the identity row only, and "the address already
 * belongs to a member" is answerable solely through the global claim.
 */
async function claimEmail(
  h: TestHarness,
  userId: string,
  email: string,
): Promise<void> {
  const user = h.backend.users.get(userId);
  if (user === undefined) {
    throw new Error(`no user row for ${userId}`);
  }
  const operationId = `email-claim-${userId}`;
  await h.container.identityUniqueDirectory.reserve({
    kind: "email",
    normalizedKey: Email.create(email),
    userId: user.id,
    operationId,
    expiresAt: new Date(h.clock.now().getTime() + 600_000),
  });
  await h.container.identityUniqueDirectory.activate(operationId, user.version);
}

/** `count` outstanding invitations issued at the clock's current instant. */
async function seedOutstanding(
  h: TestHarness,
  count: number,
  prefix = "stock",
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await seedInvitation(h, WORKSPACE, {
      invitationId: `${prefix}-${i}`,
      email: `${prefix}-${i}@example.com`,
      invitedBy: OWNER,
    });
  }
}

describe("inviteMember", () => {
  it("TC-workspace-131: issues a pending invitation, mails the link and answers its URL", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);

    const issued = await invite(h);

    expect(storedInvitation(h, WORKSPACE, issued.invitationId)).toMatchObject({
      status: "pending",
      workspaceId: WORKSPACE,
      email: INVITEE,
      role: "editor",
      invitedBy: OWNER,
    });
    expect(issued.invitationUrl).toBe(
      `${h.config.appUrl}/invitations/${encodeURIComponent(
        tokenOfInvitationUrl(issued.invitationUrl),
      )}`,
    );
    expect(h.mailSender.sent()).toEqual([
      {
        to: INVITEE,
        template: {
          kind: "workspaceInvitation",
          workspaceName: "Team Alpha",
          role: "editor",
          inviterName: "Owner One",
          acceptUrl: issued.invitationUrl,
          expiresAt: issued.expiresAt,
        },
        locale: "ja",
      },
    ]);
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["active"]);
  });

  it("TC-workspace-132: owner is an invitable role", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);

    const issued = await invite(h, { role: "owner" });

    expect(issued.role).toBe("owner");
    expect(storedInvitation(h, WORKSPACE, issued.invitationId)).toMatchObject({
      role: "owner",
      status: "pending",
    });
  });

  it("TC-workspace-133: everyone below manageMembers is refused, and nothing is claimed", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner" },
        { userId: "editor-1", role: "editor" },
        { userId: "viewer-1", role: "viewer" },
      ],
    });

    await expectBusinessRule(
      invite(h, { userId: "editor-1" }),
      INSUFFICIENT_ROLE,
    );
    await expectBusinessRule(
      invite(h, { userId: "viewer-1" }),
      INSUFFICIENT_ROLE,
    );
    await expectBusinessRule(
      invite(h, { userId: "outsider-1" }),
      INSUFFICIENT_ROLE,
    );

    expect(storedInvitations(h)).toHaveLength(0);
    expect(invitationRoutes(h)).toHaveLength(0);
    expect(h.mailSender.sent()).toHaveLength(0);
  });

  it("TC-workspace-134: an address that already belongs to a member is ALREADY_MEMBER", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner" },
        { userId: "member-1", role: "editor", email: "member@example.com" },
      ],
    });
    await claimEmail(h, "member-1", "member@example.com");

    // Normalization is the Email value object's, so the cased form has to
    // resolve the same global claim.
    await expectConflict(
      invite(h, { email: "Member@Example.com" }),
      "ALREADY_MEMBER",
    );
    expect(storedInvitations(h)).toHaveLength(0);
  });

  it("TC-workspace-134: an address whose account is not in this workspace is invitable", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    seedUser(h, { userId: "outsider-1", email: "outsider@example.com" });
    await claimEmail(h, "outsider-1", "outsider@example.com");

    const issued = await invite(h, { email: "outsider@example.com" });

    expect(storedInvitation(h, WORKSPACE, issued.invitationId)).toMatchObject({
      status: "pending",
      email: "outsider@example.com",
    });
  });

  it("TC-workspace-135: a second invite to a pending address resends rather than issuing a second row", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const first = await invite(h);
    h.clock.advance(60_000);

    const second = await invite(h);

    expect(second.invitationId).toBe(first.invitationId);
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime() + 60_000);
    expect(tokenOfInvitationUrl(second.invitationUrl)).not.toBe(
      tokenOfInvitationUrl(first.invitationUrl),
    );
    expect(storedInvitations(h)).toHaveLength(1);
    // The route table records the exchange: one live token per address.
    expect(
      invitationRoutes(h)
        .map((row) => row.state)
        .sort(),
    ).toEqual(["active", "revoked"]);
  });

  it("TC-workspace-136: the pending invitation's role wins over the one asked for again", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const first = await invite(h, { role: "editor" });

    const second = await invite(h, { role: "owner" });

    expect(second.role).toBe("editor");
    expect(second.email).toBe(INVITEE);
    expect(storedInvitation(h, WORKSPACE, first.invitationId)).toMatchObject({
      role: "editor",
    });
  });

  it("TC-workspace-137: a malformed address is InvalidEmail", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);

    await expectBusinessRule(
      invite(h, { email: "not-an-address" }),
      "IDENTITY_INVALID_EMAIL",
    );
    expect(storedInvitations(h)).toHaveLength(0);
  });

  it("TC-workspace-138: an unknown role is InvalidRole", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);

    await expectBusinessRule(
      invite(h, { role: "admin" }),
      "WORKSPACE_INVALID_ROLE",
    );
    expect(storedInvitations(h)).toHaveLength(0);
  });

  it("TC-workspace-139: the 50th outstanding invitation is still admitted", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedOutstanding(h, QUOTA - 1);

    const issued = await invite(h);

    expect(storedInvitation(h, WORKSPACE, issued.invitationId)).toMatchObject({
      status: "pending",
    });
    expect(storedInvitations(h)).toHaveLength(QUOTA);
  });

  it("TC-workspace-140: the 51st is INVITATION_LIMIT_REACHED, with no retry-after to give", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedOutstanding(h, QUOTA);

    await expectValidation(invite(h), "INVITATION_LIMIT_REACHED");
    expect(storedInvitations(h)).toHaveLength(QUOTA);
    expect(h.mailSender.sent()).toHaveLength(0);
  });

  it("TC-workspace-140: the quota counts only the last 24 hours, inclusive of the boundary", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const start = h.clock.now();

    // Exactly 24h back is inside the window (`createdAt >= now - 24h`).
    h.clock.set(new Date(start.getTime() - DAY_MS));
    await seedOutstanding(h, QUOTA, "onBoundary");
    h.clock.set(start);
    await expectValidation(invite(h), "INVITATION_LIMIT_REACHED");

    // One millisecond earlier and the same stock is out of the window.
    const older = createWorkspaceHarness();
    await seedOwnedWorkspace(older);
    older.clock.set(new Date(start.getTime() - DAY_MS - 1));
    await seedOutstanding(older, QUOTA, "beforeBoundary");
    older.clock.set(start);

    const issued = await invite(older);
    expect(
      storedInvitation(older, WORKSPACE, issued.invitationId),
    ).toMatchObject({ status: "pending" });
  });

  it("TC-workspace-313: an invitation that lands after the pre-checks still fills the last slot", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedOutstanding(h, QUOTA - 1);

    // A concurrent issue commits between this request's reads and the
    // transaction that writes its invitation, which is why the quota has
    // to be decided inside that transaction.
    const inner = h.container.scopeUnitOfWorkProvider;
    let interfered = false;
    const racing: ScopeUnitOfWorkProvider = {
      run: async (scope, callback) => {
        if (!interfered) {
          interfered = true;
          await seedOutstanding(h, 1, "concurrent");
        }
        return inner.run(scope, callback);
      },
    };
    const container: RequestContainer = {
      ...h.container,
      scopeUnitOfWorkProvider: racing,
    };

    await expectValidation(
      invite(h, {}, container),
      "INVITATION_LIMIT_REACHED",
    );
    expect(interfered).toBe(true);
    expect(storedInvitations(h)).toHaveLength(QUOTA);
    // The refused attempt leaves neither a token route nor a mail behind:
    // every route still standing belongs to one of the seeded stock.
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(
      new Array(QUOTA).fill("active"),
    );
    expect(h.mailSender.sent()).toHaveLength(0);
  });

  it("TC-workspace-141: accepting one frees its slot at once, without waiting for the window", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    seedUser(h, { userId: "joiner-1" });
    const held = await seedInvitation(h, WORKSPACE, {
      invitationId: "stock-held",
      email: "held@example.com",
      invitedBy: OWNER,
    });
    await seedOutstanding(h, QUOTA - 1);

    await expectValidation(invite(h), "INVITATION_LIMIT_REACHED");

    await acceptInvitation({
      container: h.container,
      input: { token: held.token, userId: "joiner-1" },
    });

    const issued = await invite(h);
    expect(storedInvitation(h, WORKSPACE, issued.invitationId)).toMatchObject({
      status: "pending",
    });
  });

  it("TC-workspace-143: the invitation and its route both expire 14 days after issue", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const issuedAt = h.clock.now();

    const issued = await invite(h);

    expect(issued.expiresAt.getTime()).toBe(
      issuedAt.getTime() + INVITATION_TTL_MS,
    );
    expect(
      storedInvitation(h, WORKSPACE, issued.invitationId)?.expiresAt.getTime(),
    ).toBe(issuedAt.getTime() + INVITATION_TTL_MS);
    // The route's single expiry is the invitation's own, so the link keeps
    // resolving for the whole window rather than a reservation TTL.
    expect(invitationRoutes(h).map((row) => row.expiresAt.getTime())).toEqual([
      issuedAt.getTime() + INVITATION_TTL_MS,
    ]);
  });

  it("TC-workspace-144: the token is reserved before the commit, activated after it, and mailed last", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const trace: string[] = [];
    const routes = h.container.invitationRouteStore;
    const routeState = (): string =>
      invitationRoutes(h)
        .map((row) => row.state)
        .join(",");
    const container: RequestContainer = {
      ...h.container,
      invitationRouteStore: {
        ...routes,
        reserve: async (input) => {
          trace.push(`reserve rows=${storedInvitations(h).length}`);
          await routes.reserve(input);
          trace.push(`reserved state=${routeState()}`);
        },
        activate: async (input) => {
          trace.push(`activate rows=${storedInvitations(h).length}`);
          await routes.activate(input);
        },
      },
      mailSender: {
        send: async (message: MailMessage) => {
          trace.push(`mail state=${routeState()}`);
          await h.container.mailSender.send(message);
        },
      },
    };

    await invite(h, {}, container);

    expect(trace).toEqual([
      "reserve rows=0",
      "reserved state=reserved",
      "activate rows=1",
      "mail state=active",
    ]);
  });

  it("TC-workspace-145: a commit that never lands abandons the reservation, leaving no invitation and no mail", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    // The single UoW `inviteMember` opens is the invitation commit; the
    // reads ahead of it go through the scope readers.
    const failing: ScopeUnitOfWorkProvider = {
      run: async () => {
        throw new Error("scope commit lost");
      },
    };
    const container: RequestContainer = {
      ...h.container,
      scopeUnitOfWorkProvider: failing,
    };

    await expect(invite(h, {}, container)).rejects.toThrow("scope commit lost");

    expect(invitationRoutes(h)).toHaveLength(0);
    expect(storedInvitations(h)).toHaveLength(0);
    expect(h.mailSender.sent()).toHaveLength(0);
  });

  it("TC-workspace-146: a lost activate response is repaired under the same operation id, without a second invitation", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const routes = h.container.invitationRouteStore;
    const operationIds: string[] = [];
    let dropped = false;
    const container: RequestContainer = {
      ...h.container,
      invitationRouteStore: {
        ...routes,
        activate: async (input) => {
          operationIds.push(input.operationId);
          await routes.activate(input);
          if (!dropped) {
            dropped = true;
            throw new Error("activate response lost");
          }
        },
      },
    };

    const issued = await invite(h, {}, container);

    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(storedInvitations(h)).toHaveLength(1);
    expect(invitationRoutes(h).map((row) => row.state)).toEqual(["active"]);
    expect(h.mailSender.sent()).toHaveLength(1);
    expect(h.logger.entries.map((entry) => entry.message)).toContain(
      "[inviteMember] activate response lost; retrying once",
    );
    expect(issued.mailSent).toBe(true);
  });
});
