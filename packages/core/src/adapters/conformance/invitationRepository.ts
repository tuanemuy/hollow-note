import { beforeEach, describe, expect, it } from "vitest";
import { isSystemError } from "../../application/errors";
import { Email, TokenHash } from "../../domain/identity/valueObject";
import { Invitation } from "../../domain/workspace/invitation";
import { expectConflict } from "./asserts";
import type {
  ConformanceBackend,
  MakeConformanceBackend,
  ScopedConformancePorts,
} from "./backend";
import {
  invitationId,
  makeInvitation,
  userId,
  workspaceId,
  workspaceScopeOf,
} from "./fixtures";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Shared conformance suite for `InvitationRepository` (ADP-workspace-016..024). */
export function describeInvitationRepositoryContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`InvitationRepository conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    let scoped: ScopedConformancePorts;

    beforeEach(async () => {
      backend = await makeBackend();
      scoped = backend.forScope(workspaceScopeOf(1));
    });

    const seed = async (
      n: number,
      now: Date,
      overrides: Readonly<{ email?: string }> = {},
    ): Promise<void> => {
      await scoped.invitationRepository.insert(
        makeInvitation(n, workspaceId(1), userId(1), now, overrides),
      );
    };

    const read = async (n: number) => {
      const found = await scoped.invitationRepository.findById(invitationId(n));
      if (found === null || !Invitation.isPending(found.entity)) {
        throw new Error(`pending invitation ${n} missing`);
      }
      return { pending: found.entity, expectedVersion: found.expectedVersion };
    };

    it("ADP-workspace-016/017: insert then findById round-trips with a version token", async () => {
      const now = backend.clock.now();
      const invitation = makeInvitation(1, workspaceId(1), userId(1), now);
      await scoped.invitationRepository.insert(invitation);

      const found = await scoped.invitationRepository.findById(invitationId(1));
      expect(found?.entity).toEqual(invitation);
      expect(found?.expectedVersion).toBe(0);
    });

    it("ADP-workspace-018/019: save and delete enforce OCC", async () => {
      const now = backend.clock.now();
      await seed(1, now);

      const first = await read(1);
      const revoked = Invitation.revoke(first.pending, now).entity;
      await scoped.invitationRepository.save(revoked, first.expectedVersion);

      await expectConflict(
        scoped.invitationRepository.save(revoked, first.expectedVersion),
        "OPTIMISTIC_LOCK_FAILURE",
      );
      await expectConflict(
        scoped.invitationRepository.delete(
          invitationId(1),
          first.expectedVersion,
        ),
        "OPTIMISTIC_LOCK_FAILURE",
      );

      const fresh = await scoped.invitationRepository.findById(invitationId(1));
      if (fresh === null) {
        throw new Error("seeded invitation missing");
      }
      expect(fresh.entity.status).toBe("revoked");
      await scoped.invitationRepository.delete(
        invitationId(1),
        fresh.expectedVersion,
      );
      expect(
        await scoped.invitationRepository.findById(invitationId(1)),
      ).toBeNull();
    });

    it("ADP-workspace-020: findByTokenHash resolves in every status, and a resent token retires the old hash", async () => {
      const now = backend.clock.now();
      await seed(1, now);

      const issued = await scoped.invitationRepository.findByTokenHash(
        TokenHash.create("invitation-hash-1"),
      );
      expect(issued?.entity.id).toBe(invitationId(1));
      expect(issued?.expectedVersion).toBe(0);
      expect(
        await scoped.invitationRepository.findByTokenHash(
          TokenHash.create("never-issued"),
        ),
      ).toBeNull();

      const first = await read(1);
      const resent = Invitation.resend(
        first.pending,
        TokenHash.create("invitation-hash-1-resent"),
        now,
      ).entity;
      await scoped.invitationRepository.save(resent, first.expectedVersion);
      expect(
        await scoped.invitationRepository.findByTokenHash(
          TokenHash.create("invitation-hash-1"),
        ),
      ).toBeNull();
      expect(
        (
          await scoped.invitationRepository.findByTokenHash(
            TokenHash.create("invitation-hash-1-resent"),
          )
        )?.entity.id,
      ).toBe(invitationId(1));

      // A used link stays resolvable, so a caller can tell "already
      // accepted" from "never existed".
      const second = await read(1);
      await scoped.invitationRepository.save(
        Invitation.accept(second.pending, userId(2), now).entity,
        second.expectedVersion,
      );
      expect(
        (
          await scoped.invitationRepository.findByTokenHash(
            TokenHash.create("invitation-hash-1-resent"),
          )
        )?.entity.status,
      ).toBe("accepted");
    });

    it("ADP-workspace-021: findPendingByWorkspaceAndEmail matches the normalized address and only pending rows", async () => {
      const now = backend.clock.now();
      await seed(1, now, { email: "Invitee-1@Example.COM" });

      const found =
        await scoped.invitationRepository.findPendingByWorkspaceAndEmail(
          workspaceId(1),
          Email.create("invitee-1@example.com"),
        );
      expect(found?.entity.id).toBe(invitationId(1));

      expect(
        await scoped.invitationRepository.findPendingByWorkspaceAndEmail(
          workspaceId(1),
          Email.create("someone-else@example.com"),
        ),
      ).toBeNull();
      expect(
        await scoped.invitationRepository.findPendingByWorkspaceAndEmail(
          workspaceId(2),
          Email.create("invitee-1@example.com"),
        ),
      ).toBeNull();

      const pending = await read(1);
      await scoped.invitationRepository.save(
        Invitation.revoke(pending.pending, now).entity,
        pending.expectedVersion,
      );
      // Terminal rows never match: a revoked address is invitable again.
      expect(
        await scoped.invitationRepository.findPendingByWorkspaceAndEmail(
          workspaceId(1),
          Email.create("invitee-1@example.com"),
        ),
      ).toBeNull();
    });

    it("ADP-workspace-022: listByWorkspace pages a total createdAt DESC, id DESC order over every status", async () => {
      const now = backend.clock.now();
      // Invitations 2..4 share a createdAt, so only the id tiebreak orders
      // them; invitation 1 is older, so a pure id order would put it first.
      await seed(1, new Date(now.getTime() - MINUTE_MS));
      for (const n of [2, 3, 4]) {
        await seed(n, now);
      }
      const revoked = await read(2);
      await scoped.invitationRepository.save(
        Invitation.revoke(revoked.pending, now).entity,
        revoked.expectedVersion,
      );

      const first = await scoped.invitationRepository.listByWorkspace(
        workspaceId(1),
        { page: 1, limit: 2 },
      );
      // `count` spans every status, not just the pending ones.
      expect(first.count).toBe(4);
      expect(first.items.map((row) => row.id)).toEqual([
        invitationId(4),
        invitationId(3),
      ]);

      const second = await scoped.invitationRepository.listByWorkspace(
        workspaceId(1),
        { page: 2, limit: 2 },
      );
      expect(second.items.map((row) => row.id)).toEqual([
        invitationId(2),
        invitationId(1),
      ]);

      const foreign = await scoped.invitationRepository.listByWorkspace(
        workspaceId(2),
        { page: 1, limit: 10 },
      );
      expect(foreign.items).toEqual([]);
      expect(foreign.count).toBe(0);
    });

    it("ADP-workspace-023: countPendingIssuedSince counts outstanding stock from an inclusive boundary", async () => {
      const now = backend.clock.now();
      const older = new Date(now.getTime() - DAY_MS);
      await seed(1, older);
      await seed(2, now);
      await seed(3, now);

      expect(
        await scoped.invitationRepository.countPendingIssuedSince(
          workspaceId(1),
          now,
        ),
      ).toBe(2);
      // Inclusive: an invitation issued exactly at the boundary counts.
      expect(
        await scoped.invitationRepository.countPendingIssuedSince(
          workspaceId(1),
          older,
        ),
      ).toBe(3);
      expect(
        await scoped.invitationRepository.countPendingIssuedSince(
          workspaceId(1),
          new Date(now.getTime() + MINUTE_MS),
        ),
      ).toBe(0);
      expect(
        await scoped.invitationRepository.countPendingIssuedSince(
          workspaceId(2),
          older,
        ),
      ).toBe(0);

      // Accepting frees the slot immediately; a resend keeps counting
      // against the window the invitation was first issued in.
      const accepted = await read(2);
      await scoped.invitationRepository.save(
        Invitation.accept(accepted.pending, userId(2), now).entity,
        accepted.expectedVersion,
      );
      const resent = await read(1);
      await scoped.invitationRepository.save(
        Invitation.resend(
          resent.pending,
          TokenHash.create("invitation-hash-1-resent"),
          now,
        ).entity,
        resent.expectedVersion,
      );
      expect(
        await scoped.invitationRepository.countPendingIssuedSince(
          workspaceId(1),
          now,
        ),
      ).toBe(1);
      expect(
        await scoped.invitationRepository.countPendingIssuedSince(
          workspaceId(1),
          older,
        ),
      ).toBe(2);
    });

    it("ADP-workspace-024: deleteByIds is idempotent per page and answers how many rows it removed", async () => {
      const now = backend.clock.now();
      await seed(1, now);
      await seed(2, now);

      expect(
        await scoped.invitationRepository.deleteByIds([
          invitationId(1),
          invitationId(2),
          invitationId(9),
        ]),
      ).toBe(2);
      expect(
        await scoped.invitationRepository.deleteByIds([
          invitationId(1),
          invitationId(2),
        ]),
      ).toBe(0);
      expect(
        await scoped.invitationRepository.findById(invitationId(1)),
      ).toBeNull();
    });

    it("ADP-workspace-024: deleteByIds accepts exactly 100 ids and rejects 101", async () => {
      const now = backend.clock.now();
      await seed(1, now);

      expect(
        await scoped.invitationRepository.deleteByIds(
          Array.from({ length: 100 }, (_, i) => invitationId(i + 1)),
        ),
      ).toBe(1);
      await expect(
        scoped.invitationRepository.deleteByIds(
          Array.from({ length: 101 }, (_, i) => invitationId(i + 1)),
        ),
      ).rejects.toSatisfy(isSystemError);
    });
  });
}
