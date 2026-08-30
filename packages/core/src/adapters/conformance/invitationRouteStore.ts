import { beforeEach, describe, expect, it } from "vitest";
import { TokenHash } from "../../domain/identity/valueObject";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { invitationId, workspaceId } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 14 * DAY_MS;

const hash = (n: number): TokenHash => TokenHash.create(`route-hash-${n}`);

/**
 * Shared conformance suite for `InvitationRouteStore`
 * (ADP-workspace-025..032): the two-phase issue, the atomic resend
 * exchange, and the one-way close that `revoke` and `consume` share.
 */
export function describeInvitationRouteStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`InvitationRouteStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    const expiry = (): Date => new Date(backend.clock.now().getTime() + TTL_MS);

    const reserve = (
      operationId: string,
      token = 1,
      invitation = 1,
    ): Promise<void> =>
      backend.invitationRouteStore.reserve({
        tokenHash: hash(token),
        workspaceId: workspaceId(1),
        invitationId: invitationId(invitation),
        operationId,
        expiresAt: expiry(),
      });

    const activate = (operationId: string, token = 1): Promise<void> =>
      backend.invitationRouteStore.activate({
        tokenHash: hash(token),
        operationId,
      });

    const issue = async (
      operationId: string,
      token = 1,
      invitation = 1,
    ): Promise<void> => {
      await reserve(operationId, token, invitation);
      await activate(operationId, token);
    };

    it("ADP-workspace-025/026/027: a route resolves only once its reservation is activated", async () => {
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();

      await reserve("op-1");
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();

      await activate("op-1");
      expect(await backend.invitationRouteStore.resolveActive(hash(1))).toEqual(
        {
          workspaceId: workspaceId(1),
          invitationId: invitationId(1),
        },
      );
    });

    it("ADP-workspace-025: an expired active route keeps resolving, so the invitation can be judged expired", async () => {
      await issue("op-1");
      backend.clock.advance(TTL_MS);

      // The route carries no verdict: resolving to null here would make an
      // expired invitation indistinguishable from one that never existed,
      // and preview / accept could no longer say which it was.
      expect(await backend.invitationRouteStore.resolveActive(hash(1))).toEqual(
        {
          workspaceId: workspaceId(1),
          invitationId: invitationId(1),
        },
      );
    });

    it("ADP-workspace-027: a reservation that expired before activation is refused", async () => {
      await reserve("op-1");
      backend.clock.advance(TTL_MS);

      // Read-permissive, write-refusing: nothing turns an expired token
      // into a live one, so recovery has to abandon this row instead.
      await expectConflict(activate("op-1"));
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();

      await backend.invitationRouteStore.abandon({
        tokenHash: hash(1),
        operationId: "op-1",
      });
      await issue("op-2");
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).not.toBeNull();
    });

    it("ADP-workspace-026: a token hash held by another operation conflicts in every state", async () => {
      await reserve("op-1");
      await expectConflict(reserve("op-2"));

      await activate("op-1");
      await expectConflict(reserve("op-2"));

      await backend.invitationRouteStore.revoke({
        tokenHash: hash(1),
        invitationId: invitationId(1),
        operationId: "op-revoke",
      });
      await expectConflict(reserve("op-2"));
    });

    it("ADP-workspace-026/027: reserve and activate are idempotent per operation (lost response)", async () => {
      await reserve("op-1");
      await reserve("op-1");
      await activate("op-1");
      await activate("op-1");

      expect(await backend.invitationRouteStore.resolveActive(hash(1))).toEqual(
        {
          workspaceId: workspaceId(1),
          invitationId: invitationId(1),
        },
      );
    });

    it("ADP-workspace-027: activating a row that abandon already dropped conflicts", async () => {
      await reserve("op-1");
      await backend.invitationRouteStore.abandon({
        tokenHash: hash(1),
        operationId: "op-1",
      });

      await expectConflict(activate("op-1"));
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();
    });

    it("ADP-workspace-027/032: a duplicate activate after consume does not resurrect the token", async () => {
      await issue("op-1");
      await backend.invitationRouteStore.consume({
        tokenHash: hash(1),
        invitationId: invitationId(1),
        operationId: "op-accept",
      });

      await activate("op-1");
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();
    });

    it("ADP-workspace-030: abandon drops only this operation's reserved row", async () => {
      await issue("op-1");
      // An activated route survives its own operation's compensation.
      await backend.invitationRouteStore.abandon({
        tokenHash: hash(1),
        operationId: "op-1",
      });
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).not.toBeNull();

      await reserve("op-2", 2, 2);
      await backend.invitationRouteStore.abandon({
        tokenHash: hash(2),
        operationId: "op-other",
      });
      await expectConflict(reserve("op-3", 2, 2));

      await backend.invitationRouteStore.abandon({
        tokenHash: hash(2),
        operationId: "op-2",
      });
      await backend.invitationRouteStore.abandon({
        tokenHash: hash(2),
        operationId: "op-2",
      });
      // Freed, so an unrelated operation may take the token hash now.
      await issue("op-3", 2, 2);
      expect(
        await backend.invitationRouteStore.resolveActive(hash(2)),
      ).not.toBeNull();
    });

    it("ADP-workspace-031: revoke closes the route and is idempotent by target state", async () => {
      await issue("op-1");

      await backend.invitationRouteStore.revoke({
        tokenHash: hash(1),
        invitationId: invitationId(1),
        operationId: "op-revoke-1",
      });
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();

      // A fresh operation id per attempt is the contract, so a repeat is
      // never recognizable by operation and must still succeed.
      await backend.invitationRouteStore.revoke({
        tokenHash: hash(1),
        invitationId: invitationId(1),
        operationId: "op-revoke-2",
      });
      // An absent row succeeds too: the route already does not resolve.
      await backend.invitationRouteStore.revoke({
        tokenHash: hash(9),
        invitationId: invitationId(1),
        operationId: "op-revoke-3",
      });
    });

    it("ADP-workspace-031/032: closing a route bound to another invitation conflicts", async () => {
      await issue("op-1");

      await expectConflict(
        backend.invitationRouteStore.revoke({
          tokenHash: hash(1),
          invitationId: invitationId(2),
          operationId: "op-revoke",
        }),
      );
      await expectConflict(
        backend.invitationRouteStore.consume({
          tokenHash: hash(1),
          invitationId: invitationId(2),
          operationId: "op-accept",
        }),
      );
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).not.toBeNull();
    });

    it("ADP-workspace-031/032: revoke and consume accept each other's terminal state", async () => {
      await issue("op-1");
      await backend.invitationRouteStore.consume({
        tokenHash: hash(1),
        invitationId: invitationId(1),
        operationId: "op-accept",
      });
      await backend.invitationRouteStore.revoke({
        tokenHash: hash(1),
        invitationId: invitationId(1),
        operationId: "op-revoke",
      });

      await issue("op-2", 2, 2);
      await backend.invitationRouteStore.revoke({
        tokenHash: hash(2),
        invitationId: invitationId(2),
        operationId: "op-revoke",
      });
      await backend.invitationRouteStore.consume({
        tokenHash: hash(2),
        invitationId: invitationId(2),
        operationId: "op-accept",
      });

      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();
      expect(
        await backend.invitationRouteStore.resolveActive(hash(2)),
      ).toBeNull();
    });

    const reserveReplacement = (
      operationId: string,
      oldToken = 1,
      newToken = 2,
      invitation = 1,
    ): Promise<void> =>
      backend.invitationRouteStore.reserveReplacement({
        oldTokenHash: hash(oldToken),
        newTokenHash: hash(newToken),
        workspaceId: workspaceId(1),
        invitationId: invitationId(invitation),
        operationId,
        expiresAt: expiry(),
      });

    const activateReplacement = (
      operationId: string,
      oldToken = 1,
      newToken = 2,
      invitation = 1,
    ): Promise<void> =>
      backend.invitationRouteStore.activateReplacement({
        oldTokenHash: hash(oldToken),
        newTokenHash: hash(newToken),
        invitationId: invitationId(invitation),
        operationId,
      });

    it("ADP-workspace-028: the old token keeps resolving while the replacement is reserved", async () => {
      await issue("op-1");
      await reserveReplacement("op-resend");
      await reserveReplacement("op-resend");

      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).not.toBeNull();
      expect(
        await backend.invitationRouteStore.resolveActive(hash(2)),
      ).toBeNull();
    });

    it("ADP-workspace-028: a resend cannot be built on a closed or foreign old route", async () => {
      await issue("op-1");
      await expectConflict(reserveReplacement("op-resend", 1, 2, 2));

      await backend.invitationRouteStore.revoke({
        tokenHash: hash(1),
        invitationId: invitationId(1),
        operationId: "op-revoke",
      });
      await expectConflict(reserveReplacement("op-resend"));
      // An old route that never existed is the same refusal.
      await expectConflict(reserveReplacement("op-resend", 8, 9));
    });

    it("ADP-workspace-029: the exchange is atomic — the new token resolves and the old one stops", async () => {
      await issue("op-1");
      await reserveReplacement("op-resend");
      await activateReplacement("op-resend");

      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();
      expect(await backend.invitationRouteStore.resolveActive(hash(2))).toEqual(
        {
          workspaceId: workspaceId(1),
          invitationId: invitationId(1),
        },
      );
    });

    it("ADP-workspace-029: a replay of the exchange observes it applied and succeeds", async () => {
      await issue("op-1");
      await reserveReplacement("op-resend");
      await activateReplacement("op-resend");
      await activateReplacement("op-resend");
      // The reservation half replays too, after the old route is closed.
      await reserveReplacement("op-resend");

      expect(await backend.invitationRouteStore.resolveActive(hash(2))).toEqual(
        {
          workspaceId: workspaceId(1),
          invitationId: invitationId(1),
        },
      );
    });

    it("ADP-workspace-029: of two concurrent resends the first exchange wins", async () => {
      await issue("op-1");
      await reserveReplacement("op-resend-a", 1, 2);
      await reserveReplacement("op-resend-b", 1, 3);

      await activateReplacement("op-resend-a", 1, 2);
      await expectConflict(activateReplacement("op-resend-b", 1, 3));

      // The loser abandons the replacement it reserved; the winner stands.
      await backend.invitationRouteStore.abandon({
        tokenHash: hash(3),
        operationId: "op-resend-b",
      });
      expect(
        await backend.invitationRouteStore.resolveActive(hash(3)),
      ).toBeNull();
      expect(
        await backend.invitationRouteStore.resolveActive(hash(2)),
      ).not.toBeNull();
    });

    it("ADP-workspace-029: an exchange whose replacement was revoked still closes the old route", async () => {
      await issue("op-1");
      await reserveReplacement("op-resend");
      // The invitation is cancelled between the local commit and the
      // exchange, so the revoke lands on the token the resend minted.
      await backend.invitationRouteStore.revoke({
        tokenHash: hash(2),
        invitationId: invitationId(1),
        operationId: "op-revoke",
      });

      await activateReplacement("op-resend");

      // Nothing reopens the replacement, and leaving the old token live
      // would keep a route resolving to a cancelled invitation with no
      // expiry and no call able to take it back.
      expect(
        await backend.invitationRouteStore.resolveActive(hash(2)),
      ).toBeNull();
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();
      // A repeat of the whole exchange stays converged.
      await activateReplacement("op-resend");
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).toBeNull();
    });

    it("ADP-workspace-029: an exchange whose replacement was abandoned conflicts", async () => {
      await issue("op-1");
      await reserveReplacement("op-resend");
      await backend.invitationRouteStore.abandon({
        tokenHash: hash(2),
        operationId: "op-resend",
      });

      await expectConflict(activateReplacement("op-resend"));
      expect(
        await backend.invitationRouteStore.resolveActive(hash(1)),
      ).not.toBeNull();
    });
  });
}
