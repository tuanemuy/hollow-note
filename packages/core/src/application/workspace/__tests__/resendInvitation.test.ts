import { describe, expect, it } from "vitest";
import type { RequestContainer } from "../../di/types";
import type {
  ScopeUnitOfWorkContext,
  ScopeUnitOfWorkProvider,
} from "../../execution/unitOfWork";
import type { ScopeKey } from "../../scope";
import { getInvitationPreview } from "../getInvitationPreview";
import { resendInvitation } from "../resendInvitation";
import type { ResentInvitationView } from "../view";
import {
  createWorkspaceHarness,
  expectBusinessRule,
  expectNotFound,
  expectValidation,
  invitationRoutes,
  seedInvitation,
  seedWorkspace,
  storedInvitation,
  type TestHarness,
  tokenOfInvitationUrl,
  workspaceScope,
} from "./harness";

/**
 * spec/testcases/workspace/resendInvitation.md (TC-workspace-236〜244).
 *
 * The `mailSent: false` row is covered by `invitationResponse.test.ts`
 * alongside the `inviteMember` tail call that forwards it, and is not
 * repeated here.
 */

const WORKSPACE = "workspace-1";
const OTHER_WORKSPACE = "workspace-2";
const OWNER = "owner-1";
const INVITATION = "invitation-1";

const DAY_MS = 24 * 60 * 60 * 1000;
const INVITATION_TTL_MS = 14 * DAY_MS;

const NOT_PENDING = "INVITATION_NOT_PENDING";
const NOT_FOUND = "INVITATION_NOT_FOUND";

const resend = (
  h: TestHarness,
  overrides: Readonly<{
    workspaceId?: string;
    userId?: string;
    invitationId?: string;
  }> = {},
  container: RequestContainer = h.container,
): Promise<ResentInvitationView> =>
  resendInvitation({
    container,
    input: {
      workspaceId: overrides.workspaceId ?? WORKSPACE,
      userId: overrides.userId ?? OWNER,
      invitationId: overrides.invitationId ?? INVITATION,
    },
  });

const preview = (h: TestHarness, token: string) =>
  getInvitationPreview({
    container: h.container,
    input: { token, userId: null },
  });

const routeOf = (h: TestHarness, tokenHash: string) =>
  invitationRoutes(h).find((row) => row.tokenHash === tokenHash) ?? null;

const seedOwnedWorkspace = (h: TestHarness, workspaceId = WORKSPACE) =>
  seedWorkspace(h, {
    workspaceId,
    members: [{ userId: OWNER, role: "owner" }],
  });

/**
 * A provider that lets the read transaction through and fails the commit
 * that follows it — the window in which the replacement token is already
 * claimed globally but the scope has not adopted it.
 */
const failNthRun = (
  provider: ScopeUnitOfWorkProvider,
  nth: number,
  message: string,
): ScopeUnitOfWorkProvider => {
  let seen = 0;
  return {
    run<T>(
      scope: ScopeKey,
      fn: (ctx: ScopeUnitOfWorkContext) => Promise<T>,
    ): Promise<T> {
      seen += 1;
      if (seen === nth) {
        return Promise.reject(new Error(message));
      }
      return provider.run(scope, fn);
    },
  };
};

describe("resendInvitation", () => {
  it("TC-workspace-236: mints a fresh token and a fresh 14-day window, and mails it", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const seeded = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      email: "invitee@example.com",
      role: "viewer",
    });
    h.clock.advance(DAY_MS);
    const resentAt = h.clock.now();

    const resent = await resend(h);

    expect(resent.invitationId).toBe(INVITATION);
    expect(resent.expiresAt.getTime()).toBe(
      resentAt.getTime() + INVITATION_TTL_MS,
    );
    expect(resent.mailSent).toBe(true);
    const stored = storedInvitation(h, WORKSPACE, INVITATION);
    expect(stored).toMatchObject({ status: "pending", role: "viewer" });
    expect(stored?.tokenHash).not.toBe(seeded.tokenHash);
    expect(stored?.expiresAt.getTime()).toBe(resent.expiresAt.getTime());
    // `createdAt` does not move, so the resend keeps counting against the
    // 24h window the invitation was first issued in.
    expect(stored?.createdAt.getTime()).toBe(
      seeded.invitation.createdAt.getTime(),
    );
    expect(h.mailSender.sent()).toHaveLength(1);
    expect(h.mailSender.sent()[0]?.template).toMatchObject({
      kind: "workspaceInvitation",
      role: "viewer",
      acceptUrl: resent.invitationUrl,
    });
  });

  it("TC-workspace-237: the previous link stops resolving the moment the new one opens", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });

    const resent = await resend(h);

    await expectNotFound(preview(h, seeded.token), NOT_FOUND);
    await expect(
      preview(h, tokenOfInvitationUrl(resent.invitationUrl)),
    ).resolves.toMatchObject({ state: "acceptable" });
    expect(routeOf(h, seeded.tokenHash)?.state).toBe("revoked");
    expect(
      invitationRoutes(h).filter((row) => row.state === "active"),
    ).toHaveLength(1);
  });

  it("TC-workspace-238: an accepted invitation is INVITATION_NOT_PENDING", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      state: "accepted",
      acceptedBy: OWNER,
    });

    await expectValidation(resend(h), NOT_PENDING);
    expect(h.mailSender.sent()).toHaveLength(0);
  });

  it("TC-workspace-239: a revoked invitation is INVITATION_NOT_PENDING", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedInvitation(h, WORKSPACE, { invitedBy: OWNER, state: "revoked" });

    await expectValidation(resend(h), NOT_PENDING);
    expect(h.mailSender.sent()).toHaveLength(0);
  });

  it("TC-workspace-240: an expired invitation is resent with a window starting now", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const seeded = await seedInvitation(h, WORKSPACE, {
      invitedBy: OWNER,
      state: "expired",
    });
    expect(seeded.invitation.expiresAt.getTime()).toBeLessThan(
      h.clock.now().getTime(),
    );

    const resent = await resend(h);

    expect(resent.expiresAt.getTime()).toBe(
      h.clock.now().getTime() + INVITATION_TTL_MS,
    );
    await expect(
      preview(h, tokenOfInvitationUrl(resent.invitationUrl)),
    ).resolves.toMatchObject({ state: "acceptable" });
  });

  it("TC-workspace-241: an invitation id from another workspace is INVITATION_NOT_FOUND", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    await seedOwnedWorkspace(h, OTHER_WORKSPACE);
    await seedInvitation(h, OTHER_WORKSPACE, {
      invitationId: "foreign-invitation",
      invitedBy: OWNER,
    });

    await expectNotFound(
      resend(h, { invitationId: "foreign-invitation" }),
      NOT_FOUND,
    );
    await expectNotFound(resend(h, { invitationId: "no-such-id" }), NOT_FOUND);
    expect(
      storedInvitation(h, OTHER_WORKSPACE, "foreign-invitation"),
    ).toMatchObject({ status: "pending" });
  });

  it("TC-workspace-242: a member below manageMembers is refused", async () => {
    const h = createWorkspaceHarness();
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [
        { userId: OWNER, role: "owner" },
        { userId: "editor-1", role: "editor" },
      ],
    });
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });

    await expectBusinessRule(
      resend(h, { userId: "editor-1" }),
      "WORKSPACE_INSUFFICIENT_ROLE",
    );
    expect(storedInvitation(h, WORKSPACE, INVITATION)?.tokenHash).toBe(
      seeded.tokenHash,
    );
    expect(invitationRoutes(h)).toHaveLength(1);
  });

  it("TC-workspace-243: a commit that never lands abandons the replacement and leaves the old token live", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    const container: RequestContainer = {
      ...h.container,
      // Run 1 is the read that fixes the OCC token; run 2 is the commit.
      scopeUnitOfWorkProvider: failNthRun(
        h.container.scopeUnitOfWorkProvider,
        2,
        "scope commit lost",
      ),
    };

    await expect(resend(h, {}, container)).rejects.toThrow("scope commit lost");

    expect(invitationRoutes(h)).toHaveLength(1);
    expect(routeOf(h, seeded.tokenHash)?.state).toBe("active");
    expect(storedInvitation(h, WORKSPACE, INVITATION)?.tokenHash).toBe(
      seeded.tokenHash,
    );
    await expect(preview(h, seeded.token)).resolves.toMatchObject({
      state: "acceptable",
    });
    expect(h.mailSender.sent()).toHaveLength(0);
  });

  it("TC-workspace-244: a lost activateReplacement response converges atomically on the new token alone", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });
    const routes = h.container.invitationRouteStore;
    const operationIds: string[] = [];
    let dropped = false;
    const container: RequestContainer = {
      ...h.container,
      invitationRouteStore: {
        ...routes,
        activateReplacement: async (input) => {
          operationIds.push(input.operationId);
          await routes.activateReplacement(input);
          if (!dropped) {
            dropped = true;
            throw new Error("activateReplacement response lost");
          }
        },
      },
    };

    const resent = await resend(h, {}, container);

    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(routeOf(h, seeded.tokenHash)?.state).toBe("revoked");
    expect(
      invitationRoutes(h)
        .filter((row) => row.state === "active")
        .map((row) => row.tokenHash),
    ).toEqual([storedInvitation(h, WORKSPACE, INVITATION)?.tokenHash]);
    await expectNotFound(preview(h, seeded.token), NOT_FOUND);
    await expect(
      preview(h, tokenOfInvitationUrl(resent.invitationUrl)),
    ).resolves.toMatchObject({ state: "acceptable" });
    expect(h.logger.entries.map((entry) => entry.message)).toContain(
      "[resendInvitation] activateReplacement response lost; retrying once",
    );
  });

  it("TC-workspace-244: two concurrent resends leave exactly one live token", async () => {
    const h = createWorkspaceHarness();
    await seedOwnedWorkspace(h);
    const seeded = await seedInvitation(h, WORKSPACE, { invitedBy: OWNER });

    const outcomes = await Promise.allSettled([resend(h), resend(h)]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const live = invitationRoutes(h).filter((row) => row.state === "active");
    expect(live).toHaveLength(1);
    expect(live[0]?.tokenHash).toBe(
      storedInvitation(h, WORKSPACE, INVITATION)?.tokenHash,
    );
    expect(routeOf(h, seeded.tokenHash)?.state).toBe("revoked");
    expect(
      await h.container.scopeUnitOfWorkProvider.run(
        workspaceScope(WORKSPACE),
        (ctx) => ctx.invitationRepository.findByTokenHash(seeded.tokenHash),
      ),
    ).toBeNull();
  });
});
