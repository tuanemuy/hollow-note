import type { MailSender } from "@repo/core/application/ports/mailSender";
import { ScopeKey } from "@repo/core/application/scope";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { Membership } from "@repo/core/domain/workspace/membership";
import {
  InvitationId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { Workspace } from "@repo/core/domain/workspace/workspace";
import { describe, expect, it } from "vitest";
import {
  createTestHarness,
  type TestHarness,
  type TestHarnessOptions,
} from "../../__tests__/helpers";
import { getInvitationPreview } from "../getInvitationPreview";
import { inviteMember } from "../inviteMember";
import { resendInvitation } from "../resendInvitation";

/**
 * TC-workspace: what the invitation responses carry beyond the invitation
 * itself — the mail outcome (`spec/testcases/workspace/inviteMember.md`,
 * `resendInvitation.md`) and how far `workspaceId` is exposed
 * (`getInvitationPreview.md`). Both are read by P-32 / P-06 and neither is
 * observable from the persisted rows, so they are pinned here.
 */

const OWNER = "owner-1";
const MEMBER = "member-1";
const WORKSPACE = "workspace-1";
const INVITEE = "invitee@example.com";

const workspaceId = WorkspaceId.create(WORKSPACE);
const scope = ScopeKey.workspace(workspaceId);

const failingMailSender: MailSender = {
  async send() {
    throw new Error("mail provider unavailable");
  },
};

const tokenOf = (invitationUrl: string): string =>
  decodeURIComponent(invitationUrl.slice(invitationUrl.lastIndexOf("/") + 1));

async function seed(options: TestHarnessOptions = {}): Promise<TestHarness> {
  const h = createTestHarness(options);
  const now = h.clock.now();
  await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
    await ctx.workspaceRepository.insert(
      Workspace.create(
        {
          id: WORKSPACE,
          ownerId: UserId.create(OWNER),
          name: "Workspace",
          description: "",
          slug: "team-alpha",
        },
        now,
      ).entity,
    );
    await ctx.membershipRepository.insert(
      Membership.create(
        {
          id: "membership-owner",
          workspaceId,
          userId: UserId.create(OWNER),
          role: "owner",
        },
        now,
      ).entity,
    );
  });
  return h;
}

const invite = (h: TestHarness) =>
  inviteMember({
    container: h.container,
    input: {
      workspaceId: WORKSPACE,
      userId: OWNER,
      email: INVITEE,
      role: "editor",
    },
  });

describe("invitation mail outcome", () => {
  it("reports the mail as sent when the provider accepts it", async () => {
    const h = await seed();

    const issued = await invite(h);

    expect(issued.mailSent).toBe(true);
    expect(h.mailSender.sent()).toHaveLength(1);
  });

  it("issues the invitation anyway when the mail provider fails", async () => {
    const h = await seed({
      requestOverrides: { mailSender: failingMailSender },
    });

    const issued = await invite(h);

    expect(issued.mailSent).toBe(false);
    expect(issued.invitationUrl).toContain("/invitations/");
    expect(
      await h.container.scopeUnitOfWorkProvider.run(scope, (ctx) =>
        ctx.invitationRepository.findById(
          InvitationId.create(issued.invitationId),
        ),
      ),
    ).not.toBeNull();
  });

  it("reports the mail outcome of a resend, and through the tail call", async () => {
    const h = await seed({
      requestOverrides: { mailSender: failingMailSender },
    });
    const issued = await invite(h);

    const resent = await resendInvitation({
      container: h.container,
      input: {
        workspaceId: WORKSPACE,
        userId: OWNER,
        invitationId: issued.invitationId,
      },
    });
    expect(resent.mailSent).toBe(false);
    expect(resent.invitationUrl).not.toBe(issued.invitationUrl);

    const again = await invite(h);
    expect(again.mailSent).toBe(false);
  });
});

describe("invitation preview exposure", () => {
  it("withholds workspaceId from a visitor who is not a member", async () => {
    const h = await seed();
    const issued = await invite(h);

    const preview = await getInvitationPreview({
      container: h.container,
      input: { token: tokenOf(issued.invitationUrl), userId: null },
    });

    expect(preview.state).toBe("acceptable");
    expect(preview.workspaceId).toBeNull();
  });

  it("carries workspaceId for a member re-opening the link", async () => {
    const h = await seed();
    const issued = await invite(h);
    await h.container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.membershipRepository.insert(
        Membership.create(
          {
            id: "membership-member",
            workspaceId,
            userId: UserId.create(MEMBER),
            role: "editor",
          },
          h.clock.now(),
        ).entity,
      );
    });

    const preview = await getInvitationPreview({
      container: h.container,
      input: { token: tokenOf(issued.invitationUrl), userId: MEMBER },
    });

    expect(preview.state).toBe("alreadyMember");
    expect(preview.workspaceId).toBe(WORKSPACE);
  });
});
