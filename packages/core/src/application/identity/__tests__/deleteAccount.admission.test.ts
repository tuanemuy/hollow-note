import type { RequestContainer } from "@repo/core/application/di/types";
import {
  isConflictError,
  isValidationError,
} from "@repo/core/application/errors";
import type { GlobalUnitOfWorkContext } from "@repo/core/application/execution/unitOfWork";
import { ScopeKey } from "@repo/core/application/scope";
import { AuthToken } from "@repo/core/domain/identity/authToken";
import { Session } from "@repo/core/domain/identity/session";
import { TokenHash, UserId } from "@repo/core/domain/identity/valueObject";
import {
  MembershipId,
  WorkspaceId,
} from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import {
  expectConflict,
  membershipEdges,
  seedInvitation,
  seedWorkspace,
} from "../../workspace/__tests__/harness";
import { acceptInvitation } from "../../workspace/acceptInvitation";
import { leaveWorkspace } from "../../workspace/leaveWorkspace";
import { authenticateSession } from "../authenticateSession";
import { deleteAccount } from "../deleteAccount";
import { readUniquenessKeys } from "../deleteAccount/input";
import { signUpVerified, signUpWithGoogle } from "./authFlowHelpers";
import { drainDeletion } from "./deletionHarness";

const EMAIL = "user@example.com";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE = "workspace-1";
const OWNER = "owner-1";

const request = (
  h: TestHarness,
  userId: string,
  overrides: Partial<{ confirmationEmail: string; requestId: string }> = {},
) =>
  deleteAccount({
    container: h.container,
    input: {
      type: "userRequest",
      userId,
      confirmationEmail: overrides.confirmationEmail ?? EMAIL,
      requestId: overrides.requestId ?? REQUEST_ID,
    },
  });

const storedUser = (h: TestHarness, userId: string) => {
  const user = h.backend.users.get(userId);
  if (user === undefined) {
    throw new Error(`no user row for ${userId}`);
  }
  return user;
};

const barrier = (h: TestHarness, userId: string) =>
  h.backend
    .scope(ScopeKey.user(UserId.create(userId)))
    .cleanupReceipts.values()[0];

/** Credentials of the live generation, planted at a given scale. */
const plantCredentials = (
  h: TestHarness,
  userId: string,
  count: number,
): void => {
  const owner = UserId.create(userId);
  const now = h.clock.now();
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(5, "0");
    const sessionId = `bulk-session-${suffix}`;
    h.backend.sessions.set(
      sessionId,
      Session.create(
        {
          id: sessionId,
          userId: owner,
          tokenHash: TokenHash.create(`hash-${sessionId}`),
          authEpoch: 0,
        },
        now,
      ),
    );
    const tokenId = `bulk-token-${suffix}`;
    h.backend.authTokens.set(
      tokenId,
      AuthToken.issue(
        {
          id: tokenId,
          userId: owner,
          purpose: "password_reset",
          tokenHash: TokenHash.create(`hash-${tokenId}`),
          authEpoch: 0,
        },
        now,
      ),
    );
  }
};

/**
 * Joins the user to a workspace through the real invitation flow, so the
 * global `membership_directory` edge is the one a join actually leaves.
 */
const joinWorkspace = async (h: TestHarness, userId: string): Promise<void> => {
  await seedWorkspace(h, {
    workspaceId: WORKSPACE,
    members: [{ userId: OWNER, role: "owner" }],
  });
  const { token } = await seedInvitation(h, WORKSPACE, {
    invitedBy: OWNER,
    email: EMAIL,
    role: "editor",
  });
  await acceptInvitation({ container: h.container, input: { token, userId } });
};

const JOIN_OPERATION = "join-operation-1";
const JOIN_MEMBERSHIP = "membership-join-1";

/**
 * The single global write a join makes before its workspace-local
 * commit: the edge is claimed `activating` and stays that way until
 * `activate` settles it.
 */
const claimJoinEdge = (h: TestHarness, userId: string): Promise<void> =>
  h.container.membershipDirectoryReservationStore.reserveAndClaimActivation({
    operationId: JOIN_OPERATION,
    userId: UserId.create(userId),
    workspaceId: WorkspaceId.create(WORKSPACE),
    membershipId: MembershipId.create(JOIN_MEMBERSHIP),
    role: "editor",
    expiresAt: new Date(h.clock.now().getTime() + 60_000),
  });

/**
 * Where inside the admission transaction the racing join is let in: just
 * after the operation is created, and just after the last read the
 * refusal decides on. Between them lies every step the decision has to
 * enclose, so a join let in at either end pins the ordering from one
 * side.
 */
type RaceSeam = "afterOperation" | "afterAdmissionRead";

/**
 * Lets a join claim its directory edge from inside the admission
 * transaction's lifetime, at a chosen seam.
 *
 * The claim runs in an async context created **before** the transaction
 * opened, so the memory backend does not enrol its write in the
 * transaction's undo log: the edge survives a rollback exactly as a
 * concurrent request's would.
 */
const withRacingJoin = (
  h: TestHarness,
  userId: string,
  seam: RaceSeam,
): Readonly<{ container: RequestContainer; joinOutcome: () => unknown }> => {
  let release = (): void => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let outcome: unknown = "not reached";
  const joined = (async (): Promise<void> => {
    await released;
    try {
      await claimJoinEdge(h, userId);
      outcome = "claimed";
    } catch (error) {
      outcome = error;
    }
  })();
  const raceAt = async (at: RaceSeam): Promise<void> => {
    if (at !== seam) {
      return;
    }
    release();
    await joined;
  };
  return {
    container: {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: <T>(fn: (ctx: GlobalUnitOfWorkContext) => Promise<T>) =>
          h.container.globalUnitOfWorkProvider.run((ctx) =>
            fn({
              ...ctx,
              distributedOperationStore: {
                ...ctx.distributedOperationStore,
                beginOrResume: async (input) => {
                  const begun =
                    await ctx.distributedOperationStore.beginOrResume(input);
                  await raceAt("afterOperation");
                  return begun;
                },
              },
              activatingMembershipReader: {
                listActivatingByUser: async (subject, limit) => {
                  const edges =
                    await ctx.activatingMembershipReader.listActivatingByUser(
                      subject,
                      limit,
                    );
                  await raceAt("afterAdmissionRead");
                  return edges;
                },
              },
            }),
          ),
      },
    },
    joinOutcome: () => outcome,
  };
};

/**
 * The class matters as much as the code: it is what the presentation
 * layer maps to a status (`ValidationError` → 400, `BusinessRuleError`
 * → 422), so a rejection that keeps the code but changes the class is a
 * transport-visible change.
 */
const expectCode = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => isValidationError(error) && error.code === code,
  );
};

describe("deleteAccount admission", () => {
  it("TC-identity-039: the request is accepted, the user turns deleting and the barrier closes the scope", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    const view = await request(h, userId);

    expect(view.status).toBe("accepted");
    const user = storedUser(h, userId);
    expect(user.status).toBe("deleting");
    expect(user.status === "deleting" && user.deletionOperationId).toBe(
      view.operationId,
    );
    expect(barrier(h, userId)).toMatchObject({
      operationId: view.operationId,
      status: "running",
      acknowledged: [],
      retainUntil: null,
    });
  });

  it("TC-identity-040: the epoch bump expires 10,000 sessions and tokens without touching their rows", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h, EMAIL);
    const sessionsBefore = h.backend.sessions.size;
    const tokensBefore = h.backend.authTokens.size;
    plantCredentials(h, userId, 10_000);
    const epochBefore = storedUser(h, userId).authEpoch;

    await request(h, userId);

    expect(storedUser(h, userId).authEpoch).toBe(epochBefore + 1);
    await expectCode(
      authenticateSession({ container: h.container, input: { sessionToken } }),
      "UNAUTHENTICATED",
    );
    // Revocation is the generation, not the rows: acceptance costs the
    // same at 10,000 credentials as at one. The rows are reclaimed 100 at
    // a time afterwards, and finalize waits for that acknowledgement.
    expect(h.backend.sessions.size).toBe(sessionsBefore + 10_000);
    expect(h.backend.authTokens.size).toBe(tokensBefore + 10_000);
  });

  it("TC-identity-049: a mismatched confirmation address creates no operation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    await expectCode(
      request(h, userId, { confirmationEmail: "typo@example.com" }),
      "CONFIRMATION_MISMATCH",
    );

    expect(h.backend.distributedOperations.values()).toHaveLength(0);
    expect(storedUser(h, userId).status).toBe("active");
  });

  it("TC-identity-054: a requestId that is not a UUID creates no operation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    await expectCode(
      request(h, userId, { requestId: "not-a-uuid" }),
      "INVALID_REQUEST_ID",
    );

    expect(h.backend.distributedOperations.values()).toHaveLength(0);
    expect(storedUser(h, userId).status).toBe("active");
  });

  it("TC-identity-050: re-requesting with the same requestId replays the same operation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    const first = await request(h, userId);
    const epochAfterFirst = storedUser(h, userId).authEpoch;
    const second = await request(h, userId);

    expect(second.operationId).toBe(first.operationId);
    expect(h.backend.distributedOperations.values()).toHaveLength(1);
    // The generation must not move again: the residue cleanup already
    // running for this operation would otherwise delete live credentials.
    expect(storedUser(h, userId).authEpoch).toBe(epochAfterFirst);
  });

  it("TC-identity-053: a different requestId joins the operation already running", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);

    const first = await request(h, userId);
    const second = await request(h, userId, { requestId: OTHER_REQUEST_ID });

    expect(second.operationId).toBe(first.operationId);
    expect(h.backend.distributedOperations.values()).toHaveLength(1);
  });

  it("TC-identity-350: a request from a workspace member is refused and leaves the account untouched", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await joinWorkspace(h, userId);

    await expectConflict(request(h, userId), "WORKSPACE_MEMBERSHIPS_REMAIN");

    // The refusal has to be free of residue: an operation row would burn
    // one of the retry window's attempts, and a `deleting` user would be
    // exactly the stuck state the refusal exists to prevent.
    expect(h.backend.distributedOperations.values()).toHaveLength(0);
    expect(storedUser(h, userId).status).toBe("active");
    expect(barrier(h, userId)).toBeUndefined();
    expect(h.backend.manifestHeaders.values()).toHaveLength(0);
  });

  it("TC-identity-352: a join that has claimed its edge but not settled it refuses the request", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [{ userId: OWNER, role: "owner" }],
    });
    // The whole of the join saga's [claim, activate] window: nothing has
    // settled yet, so the settled count alone reads zero here.
    await claimJoinEdge(h, userId);

    await expectConflict(request(h, userId), "WORKSPACE_MEMBERSHIPS_REMAIN");

    expect(membershipEdges(h, userId)).toHaveLength(1);
    expect(h.backend.distributedOperations.values()).toHaveLength(0);
    expect(storedUser(h, userId).status).toBe("active");
    expect(barrier(h, userId)).toBeUndefined();
    expect(h.backend.manifestHeaders.values()).toHaveLength(0);
  });

  it("TC-identity-353: a join landing inside the admission transaction is caught by it, not admitted behind it", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [{ userId: OWNER, role: "owner" }],
    });
    // The seam a judgement taken before the operation would miss: the
    // edge lands after the operation exists and before the transaction
    // ends, which is precisely the window in which an edge could settle
    // behind an admitted deletion.
    const race = withRacingJoin(h, userId, "afterOperation");

    await expectConflict(
      deleteAccount({
        container: race.container,
        input: {
          type: "userRequest",
          userId,
          confirmationEmail: EMAIL,
          requestId: REQUEST_ID,
        },
      }),
      "WORKSPACE_MEMBERSHIPS_REMAIN",
    );

    expect(race.joinOutcome()).toBe("claimed");
    // The join's own write is not part of the rolled-back transaction.
    expect(membershipEdges(h, userId)).toHaveLength(1);
    expect(h.backend.distributedOperations.values()).toHaveLength(0);
    expect(storedUser(h, userId).status).toBe("active");
    expect(barrier(h, userId)).toBeUndefined();
  });

  it("TC-identity-353: an admitted deletion never leaves an edge behind it, even when the join lands on the decision", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await seedWorkspace(h, {
      workspaceId: WORKSPACE,
      members: [{ userId: OWNER, role: "owner" }],
    });
    // The seam a judgement taken before the transition would miss: the
    // join arrives once the decision has been read and can only be
    // stopped by the `deleting` transition already being published.
    const race = withRacingJoin(h, userId, "afterAdmissionRead");

    const view = await deleteAccount({
      container: race.container,
      input: {
        type: "userRequest",
        userId,
        confirmationEmail: EMAIL,
        requestId: REQUEST_ID,
      },
    });

    expect(view.status).toBe("accepted");
    expect(race.joinOutcome()).toSatisfy(
      (error: unknown) =>
        isConflictError(error) && error.code === "MEMBERSHIP_EDGE_CONFLICT",
    );
    expect(membershipEdges(h, userId)).toEqual([]);
    expect(storedUser(h, userId).status).toBe("deleting");
  });

  it("TC-identity-351: the same request runs through to the tombstone once the workspace is left", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, EMAIL);
    await joinWorkspace(h, userId);

    await leaveWorkspace({
      container: h.container,
      input: { workspaceId: WORKSPACE, userId },
    });
    expect(membershipEdges(h, userId)).toEqual([]);

    const view = await request(h, userId);
    expect(view.status).toBe("accepted");
    await drainDeletion(h);

    expect(h.backend.users.get(userId)).toMatchObject({
      status: "deleted",
      id: userId,
    });
    expect(h.backend.users.get(userId)).not.toHaveProperty("email");
    expect(h.backend.manifestHeaders.get(view.operationId)?.status).toBe(
      "completed",
    );
  });

  it("freezes the uniqueness keys into the operation payload while the PII is alive", async () => {
    const h = createTestHarness();
    const { userId } = await signUpWithGoogle(h, {
      email: EMAIL,
      providerAccountId: "google-account-9",
    });

    const view = await request(h, userId);

    const operation = h.backend.distributedOperations.get(view.operationId);
    expect(operation).toBeDefined();
    if (operation === undefined) {
      return;
    }
    expect(readUniquenessKeys(operation.payload)).toEqual({
      email: EMAIL,
      handle: null,
      providerAccounts: ["google:google-account-9"],
    });
  });
});
