import { EventId } from "@repo/core/domain/common/event";
import { AuthToken } from "@repo/core/domain/identity/authToken";
import { Session } from "@repo/core/domain/identity/session";
import { TokenHash, UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { authResidueCleanup } from "../authResidueCleanup";
import type {
  AuthResidueTable,
  UserAuthResidueCleanupContinuedEvent,
} from "../continuations";
import { overwriteUser, signUpVerified } from "./authFlowHelpers";

const NOW = new Date("2026-05-01T00:00:00.000Z");

const event = (
  params: Readonly<{
    userId: string;
    authEpoch: number;
    table: AuthResidueTable;
    deletionOperationId?: string;
  }>,
): UserAuthResidueCleanupContinuedEvent => ({
  id: EventId.create(`event-${params.table}-${params.authEpoch}`),
  type: "identity.userAuthResidueCleanupContinued",
  payload: {
    userId: UserId.create(params.userId),
    authEpoch: params.authEpoch,
    table: params.table,
    deletionOperationId: params.deletionOperationId ?? null,
  },
  occurredAt: NOW,
  aggregateId: params.userId,
});

/** Drops the rows sign-up left behind so each case seeds its own. */
function clearAuthRows(h: TestHarness): void {
  for (const key of h.backend.sessions.keys()) {
    h.backend.sessions.delete(key);
  }
  for (const key of h.backend.authTokens.keys()) {
    h.backend.authTokens.delete(key);
  }
}

function seedRows(
  h: TestHarness,
  userId: string,
  count: number,
  authEpoch: number,
  prefix: string,
): void {
  for (let i = 0; i < count; i += 1) {
    const id = `${prefix}-${String(i).padStart(4, "0")}`;
    if (prefix.startsWith("session")) {
      h.backend.sessions.set(
        id,
        Session.create(
          {
            id,
            userId: UserId.create(userId),
            tokenHash: TokenHash.create(`hash-${id}`),
            authEpoch,
          },
          NOW,
        ),
      );
      continue;
    }
    h.backend.authTokens.set(
      id,
      AuthToken.issue(
        {
          id,
          userId: UserId.create(userId),
          purpose: "password_reset",
          tokenHash: TokenHash.create(`hash-${id}`),
          authEpoch,
        },
        NOW,
      ),
    );
  }
}

const continuations = (
  h: TestHarness,
): readonly UserAuthResidueCleanupContinuedEvent["payload"][] =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.userAuthResidueCleanupContinued")
    .map(
      (row) => row.payload as UserAuthResidueCleanupContinuedEvent["payload"],
    );

async function bumpEpochTo(
  h: TestHarness,
  userId: string,
  authEpoch: number,
): Promise<void> {
  overwriteUser(h, userId, (user) => ({ ...user, authEpoch }));
}

describe("authResidueCleanup", () => {
  it("TC-identity-041: pages sessions before switching to auth tokens, and only acknowledges after auth tokens are empty", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await bumpEpochTo(h, userId, 1);
    clearAuthRows(h);
    seedRows(h, userId, 101, 0, "session-old");
    seedRows(h, userId, 101, 0, "token-old");

    await h.workerContainer.accountDeletionManifestStore.begin(
      "deletion-1",
      UserId.create(userId),
    );

    const base = {
      userId,
      authEpoch: 1,
      deletionOperationId: "deletion-1",
    } as const;

    await authResidueCleanup(
      event({ ...base, table: "sessions" }),
      h.workerContainer,
    );
    expect(h.backend.sessions.size).toBe(1);
    expect(continuations(h).at(-1)?.table).toBe("sessions");

    await authResidueCleanup(
      event({ ...base, table: "sessions" }),
      h.workerContainer,
    );
    expect(h.backend.sessions.size).toBe(0);
    expect(continuations(h).at(-1)?.table).toBe("authTokens");
    expect(
      await h.workerContainer.accountDeletionManifestStore.allRequiredAcknowledged(
        "deletion-1",
      ),
    ).toBe(false);

    await authResidueCleanup(
      event({ ...base, table: "authTokens" }),
      h.workerContainer,
    );
    expect(h.backend.authTokens.size).toBe(1);

    await authResidueCleanup(
      event({ ...base, table: "authTokens" }),
      h.workerContainer,
    );
    expect(h.backend.authTokens.size).toBe(0);
    // The terminal turn is the only one that acknowledges the receipt.
    expect(h.backend.manifestHeaders.get("deletion-1")?.receipts).toContain(
      "authResidue",
    );
  });

  it("TC-identity-042: a lost phase-switch response resumes from the saved table and still satisfies finalize", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await bumpEpochTo(h, userId, 1);
    clearAuthRows(h);
    seedRows(h, userId, 3, 0, "session-old");
    seedRows(h, userId, 2, 0, "token-old");

    await h.workerContainer.accountDeletionManifestStore.begin(
      "deletion-1",
      UserId.create(userId),
    );
    const turn = {
      userId,
      authEpoch: 1,
      table: "authTokens",
      deletionOperationId: "deletion-1",
    } as const;

    // The turn resumes at the saved authTokens phase, so the sessions rows are
    // left alone, and re-delivering it enqueues no further continuation.
    await authResidueCleanup(event(turn), h.workerContainer);
    expect(h.backend.authTokens.size).toBe(0);
    expect(h.backend.sessions.size).toBe(3);

    await authResidueCleanup(event(turn), h.workerContainer);
    expect(h.backend.authTokens.size).toBe(0);
    expect(h.backend.sessions.size).toBe(3);
    expect(continuations(h)).toHaveLength(0);
    // Resuming from the saved phase is only half the claim: the terminal
    // turn must also earn the receipt finalize waits for.
    expect(h.backend.manifestHeaders.get("deletion-1")?.receipts).toContain(
      "authResidue",
    );
  });

  it("TC-identity-043: a turn whose epoch was overtaken deletes nothing and stops the chain", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await bumpEpochTo(h, userId, 2);
    clearAuthRows(h);
    seedRows(h, userId, 5, 0, "session-old");
    seedRows(h, userId, 4, 1, "session-mid");

    await authResidueCleanup(
      event({ userId, authEpoch: 1, table: "sessions" }),
      h.workerContainer,
    );

    expect(h.backend.sessions.size).toBe(9);
    expect(continuations(h)).toHaveLength(0);
    // The overtaken turn carries the older generation in its payload;
    // writing it back would revive every credential it names.
    expect(h.backend.users.get(userId)?.authEpoch).toBe(2);
  });

  it("never deletes rows of the current generation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await bumpEpochTo(h, userId, 1);
    clearAuthRows(h);
    seedRows(h, userId, 2, 0, "session-old");
    seedRows(h, userId, 3, 1, "session-current");

    await authResidueCleanup(
      event({ userId, authEpoch: 1, table: "sessions" }),
      h.workerContainer,
    );

    expect(h.backend.sessions.size).toBe(3);
  });

  it("stops without a continuation once both tables are empty", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    await bumpEpochTo(h, userId, 1);

    await authResidueCleanup(
      event({ userId, authEpoch: 1, table: "authTokens" }),
      h.workerContainer,
    );

    expect(continuations(h)).toHaveLength(0);
  });
});
