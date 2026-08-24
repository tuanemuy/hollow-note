import { createMemoryOAuthStateStore } from "@repo/core/adapters/memory/repositories/oauthStateStore";
import { isSystemError } from "@repo/core/application/errors";
import type { OAuthFlowState } from "@repo/core/application/ports/oauthStateStore";
import { AuthToken } from "@repo/core/domain/identity/authToken";
import { LoginThrottlePolicy } from "@repo/core/domain/identity/services/loginThrottlePolicy";
import { Session } from "@repo/core/domain/identity/session";
import { IdentityId, UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import type { AuthStateTable, ExpirySweep } from "../../di/types";
import { authenticateSession } from "../authenticateSession";
import {
  PRUNE_LEASE_OWNER,
  pruneExpiredAuthState,
} from "../pruneExpiredAuthState";
import { signUpVerified } from "./authFlowHelpers";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

let seedCounter = 0;
const nextSeedId = (): string => {
  seedCounter += 1;
  return `seed-${String(seedCounter).padStart(6, "0")}`;
};

function seedSession(h: TestHarness, expiresAt: Date): string {
  const id = nextSeedId();
  h.backend.sessions.set(
    id,
    Session.reconstruct({
      id,
      userId: "user-1",
      tokenHash: `hash-${id}`,
      authEpoch: 0,
      createdAt: new Date(expiresAt.getTime() - 30 * DAY_MS),
      expiresAt,
    }),
  );
  return id;
}

function seedAuthToken(
  h: TestHarness,
  expiresAt: Date,
  options: Readonly<{
    purpose?: "email_verification" | "password_reset";
    consumedAt?: Date | null;
  }> = {},
): string {
  const id = nextSeedId();
  h.backend.authTokens.set(
    id,
    AuthToken.reconstruct({
      id,
      userId: "user-1",
      purpose: options.purpose ?? "email_verification",
      tokenHash: `hash-${id}`,
      authEpoch: 0,
      status: options.consumedAt != null ? "consumed" : "pending",
      createdAt: new Date(expiresAt.getTime() - HOUR_MS),
      expiresAt,
      consumedAt: options.consumedAt ?? null,
    }),
  );
  return id;
}

function seedLoginAttempt(
  h: TestHarness,
  expiresAt: Date,
  options: Readonly<{
    failureCount?: number;
    lastFailedAt?: Date;
    key?: string;
  }> = {},
): string {
  const key = options.key ?? `attempt-${nextSeedId()}`;
  h.backend.loginAttempts.set(key, {
    key,
    failureCount: options.failureCount ?? 1,
    lastFailedAt:
      options.lastFailedAt ?? new Date(expiresAt.getTime() - DAY_MS),
    expiresAt,
  });
  return key;
}

function seedOAuthState(
  h: TestHarness,
  expiresAt: Date,
  intent: OAuthFlowState["intent"] = "signIn",
): string {
  const state = `state-${nextSeedId()}`;
  h.backend.oauthStates.set(state, {
    state,
    value: {
      provider: "google",
      codeVerifier: "verifier",
      redirectTo: null,
      intent,
      userId: intent === "signIn" ? null : UserId.create("user-1"),
      userAuthEpoch: intent === "signIn" ? null : 0,
      stateBindingHash: h.container.secureTokenGenerator.hashOf(
        `${state}-binding`,
      ),
    },
    expiresAt,
  });
  return state;
}

function seedRemovalReceipt(h: TestHarness, expiresAt: Date): string {
  const id = nextSeedId();
  h.backend.identityRemovalReceipts.set(id, {
    operationId: `removeIdentity:${id}`,
    identityId: IdentityId.create(id),
    userId: UserId.create("user-1"),
    kind: "oauth",
    providerAccountKey: `google:${id}`,
    expiresAt,
  });
  return id;
}

const cron = (h: TestHarness) =>
  pruneExpiredAuthState({
    container: h.workerContainer,
    input: { type: "cron" },
  });

const failingSweep: ExpirySweep = {
  deleteExpired: async () => {
    throw new Error("sweep down");
  },
};

const withSweepOverride = (
  h: TestHarness,
  table: AuthStateTable,
  sweep: ExpirySweep,
) => ({
  ...h.workerContainer,
  authStateSweeps: { ...h.workerContainer.authStateSweeps, [table]: sweep },
});

describe("pruneExpiredAuthState", () => {
  it("TC-identity-150: deletes only the 3 expired sessions and reports sessions: 3", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    seedSession(h, new Date(now.getTime() - 1));
    seedSession(h, new Date(now.getTime() - MINUTE_MS));
    seedSession(h, new Date(now.getTime() - HOUR_MS));
    const kept1 = seedSession(h, new Date(now.getTime() + HOUR_MS));
    const kept2 = seedSession(h, new Date(now.getTime() + DAY_MS));

    const view = await cron(h);
    expect(view.sessions).toBe(3);
    expect([...h.backend.sessions.keys()].sort()).toEqual(
      [kept1, kept2].sort(),
    );
  });

  it("TC-identity-151: a session whose expiresAt equals the base time is deleted (expiresAt <= now)", async () => {
    const h = createTestHarness();
    seedSession(h, h.clock.now());
    const view = await cron(h);
    expect(view.sessions).toBe(1);
    expect(h.backend.sessions.size).toBe(0);
  });

  it("TC-identity-152: a session expiring 1ms after the base time survives", async () => {
    const h = createTestHarness();
    seedSession(h, new Date(h.clock.now().getTime() + 1));
    const view = await cron(h);
    expect(view.sessions).toBe(0);
    expect(h.backend.sessions.size).toBe(1);
  });

  it("TC-identity-153: authenticateSession is UNAUTHENTICATED both before and after pruning an expired session", async () => {
    const h = createTestHarness();
    const { sessionToken } = await signUpVerified(h);
    h.clock.advance(31 * DAY_MS);

    await expect(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    ).rejects.toSatisfy(
      (error) => (error as { code?: string }).code === "UNAUTHENTICATED",
    );
    await cron(h);
    await expect(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    ).rejects.toSatisfy(
      (error) => (error as { code?: string }).code === "UNAUTHENTICATED",
    );
  });

  it("TC-identity-154: expired email_verification / password_reset tokens are deleted and counted", async () => {
    const h = createTestHarness();
    const past = new Date(h.clock.now().getTime() - 1);
    seedAuthToken(h, past, { purpose: "email_verification" });
    seedAuthToken(h, past, { purpose: "password_reset" });
    const view = await cron(h);
    expect(view.authTokens).toBe(2);
    expect(h.backend.authTokens.size).toBe(0);
  });

  it("TC-identity-155: a consumed token past its expiry is deleted", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    seedAuthToken(h, new Date(now.getTime() - 1), {
      consumedAt: new Date(now.getTime() - HOUR_MS),
    });
    const view = await cron(h);
    expect(view.authTokens).toBe(1);
  });

  it("TC-identity-156: a consumed token still inside its expiry window is kept", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    seedAuthToken(h, new Date(now.getTime() + HOUR_MS), {
      consumedAt: new Date(now.getTime() - MINUTE_MS),
    });
    const view = await cron(h);
    expect(view.authTokens).toBe(0);
    expect(h.backend.authTokens.size).toBe(1);
  });

  it("TC-identity-157: expired login attempts are deleted and counted", async () => {
    const h = createTestHarness();
    seedLoginAttempt(h, new Date(h.clock.now().getTime() - 1));
    const view = await cron(h);
    expect(view.loginAttempts).toBe(1);
    expect(h.backend.loginAttempts.size).toBe(0);
  });

  it("TC-identity-158: an in-lock record is never reclaimed before its lock lapses (24h TTL > 15min lock)", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    const lastFailedAt = new Date(now.getTime() - 5 * MINUTE_MS);
    const key = seedLoginAttempt(
      h,
      new Date(lastFailedAt.getTime() + LoginThrottlePolicy.attemptTtlMs),
      { failureCount: 10, lastFailedAt },
    );
    const view = await cron(h);
    expect(view.loginAttempts).toBe(0);
    const kept = h.backend.loginAttempts.get(key);
    expect(kept).toBeDefined();
    // The lock is still derivable from the surviving record.
    expect(
      LoginThrottlePolicy.evaluate({ key, failureCount: 10, lastFailedAt }, now)
        .kind,
    ).toBe("locked");
  });

  it("TC-identity-159: an abandoned sign-in authorization flow state is deleted and counted", async () => {
    const h = createTestHarness();
    seedOAuthState(h, new Date(h.clock.now().getTime() - 1), "signIn");
    const view = await cron(h);
    expect(view.oauthFlowStates).toBe(1);
  });

  it("TC-identity-160: integration-intent flow states share the store and are swept together", async () => {
    const h = createTestHarness();
    const past = new Date(h.clock.now().getTime() - 1);
    seedOAuthState(h, past, "signIn");
    seedOAuthState(h, past, "integration");
    const view = await cron(h);
    expect(view.oauthFlowStates).toBe(2);
    expect(h.backend.oauthStates.size).toBe(0);
  });

  it("TC-identity-161: an unexpired flow state survives and can still be taken", async () => {
    const h = createTestHarness();
    const state = seedOAuthState(
      h,
      new Date(h.clock.now().getTime() + 9 * MINUTE_MS),
    );
    const view = await cron(h);
    expect(view.oauthFlowStates).toBe(0);
    const store = createMemoryOAuthStateStore(h.backend);
    expect(
      await store.take(
        state,
        h.container.secureTokenGenerator.hashOf(`${state}-binding`),
      ),
    ).not.toBeNull();
  });

  it("an identity removal receipt past its retention is deleted while one inside it survives", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    seedRemovalReceipt(h, new Date(now.getTime() - 1));
    const kept = seedRemovalReceipt(h, new Date(now.getTime() + DAY_MS));

    const view = await cron(h);
    expect(view.identityRemovalReceipts).toBe(1);
    expect([...h.backend.identityRemovalReceipts.keys()]).toEqual([kept]);
  });

  it("TC-identity-162: every sweep target empty succeeds with zeros", async () => {
    const h = createTestHarness();
    const view = await cron(h);
    expect(view).toEqual({
      sessions: 0,
      authTokens: 0,
      loginAttempts: 0,
      oauthFlowStates: 0,
      identityRemovalReceipts: 0,
      continued: false,
    });
  });

  it("TC-identity-163: an immediate second run is idempotent (all zeros)", async () => {
    const h = createTestHarness();
    const past = new Date(h.clock.now().getTime() - 1);
    seedSession(h, past);
    seedAuthToken(h, past);
    seedLoginAttempt(h, past);
    seedOAuthState(h, past);
    const first = await cron(h);
    expect(first.sessions + first.authTokens).toBe(2);

    const second = await cron(h);
    expect(second).toEqual({
      sessions: 0,
      authTokens: 0,
      loginAttempts: 0,
      oauthFlowStates: 0,
      identityRemovalReceipts: 0,
      continued: false,
    });
  });

  it("TC-identity-164 / TC-identity-166: a failing command backs off its lane alone; other lanes proceed outside any shared transaction", async () => {
    const h = createTestHarness({
      maintenanceShardIds: ["shard-0", "shard-1"],
    });
    const past = new Date(h.clock.now().getTime() - 1);
    seedSession(h, past);
    seedLoginAttempt(h, past);
    // shard-0's auth_tokens command fails; every later command succeeds.
    let failOnce = true;
    const flaky: ExpirySweep = {
      deleteExpired: async (...args) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("sweep down");
        }
        return h.workerContainer.authStateSweeps.auth_tokens.deleteExpired(
          ...args,
        );
      },
    };
    const container = withSweepOverride(h, "auth_tokens", flaky);

    const view = await pruneExpiredAuthState({
      container,
      input: { type: "cron" },
    });
    // The failing command neither rolled back nor blocked the other
    // lane's sweeps — deletions share no cross-cutting transaction.
    expect(view.sessions).toBe(1);
    expect(view.loginAttempts).toBe(1);
    expect(
      h.logger
        .byLevel("error")
        .some((entry) => entry.message.includes("table sweep failed")),
    ).toBe(true);
  });

  it("TC-identity-165: when every sweep of the invocation fails the cursor survives and SystemError(DatabaseError) is thrown", async () => {
    const h = createTestHarness();
    const past = new Date(h.clock.now().getTime() - 1);
    seedAuthToken(h, past);
    // Single shard: the lane starts (and stays) on auth_tokens, so a
    // failing auth_tokens sweep fails every operation this run attempts.
    const container = withSweepOverride(h, "auth_tokens", failingSweep);

    await expect(
      pruneExpiredAuthState({ container, input: { type: "cron" } }),
    ).rejects.toSatisfy(
      (error) => isSystemError(error) && error.code === "DATABASE_ERROR",
    );
    expect(h.backend.authTokens.size).toBe(1);

    // A later healthy invocation resumes from the released lane.
    const view = await cron(h);
    expect(view.authTokens).toBe(1);
  });

  it("TC-identity-167: the base time comes from the clock, not from the input", async () => {
    const h = createTestHarness();
    h.clock.set(new Date("2026-03-01T05:00:00.000Z"));
    seedSession(h, new Date("2026-03-01T05:00:00.000Z"));
    const view = await cron(h);
    expect(view.sessions).toBe(1);
  });

  it("TC-identity-168: 250 expired rows per table are reclaimed in 100-row commands with keyset continuation", async () => {
    const h = createTestHarness();
    const past = new Date(h.clock.now().getTime() - 1);
    for (let i = 0; i < 250; i += 1) {
      seedSession(h, past);
      seedAuthToken(h, past);
      seedLoginAttempt(h, past);
      seedOAuthState(h, past);
    }
    const view = await cron(h);
    expect(view).toMatchObject({
      sessions: 250,
      authTokens: 250,
      loginAttempts: 250,
      oauthFlowStates: 250,
    });
    expect(h.backend.sessions.size).toBe(0);
    expect(h.backend.oauthStates.size).toBe(0);
  });

  it("TC-identity-169 / TC-identity-170: a continuation re-run from the same cursor after a lost response loses nothing", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    const past = new Date(now.getTime() - 1);
    for (let i = 0; i < 150; i += 1) {
      seedAuthToken(h, past);
    }
    const store = h.workerContainer.maintenanceRunStore;
    const begin = await store.beginOrResumeKind({
      candidateRunId: "run-tc169",
      kind: "authStatePrune",
      candidateAsOf: now,
      generations: ["gen-1"],
      leaseOwner: PRUNE_LEASE_OWNER,
      leaseUntil: new Date(now.getTime() + 10 * MINUTE_MS),
    });
    const [lane] = await store.claimLanes(begin.runId, PRUNE_LEASE_OWNER, 1);
    if (lane === undefined || lane.table !== "auth_tokens") {
      throw new Error("expected the auth_tokens lane");
    }

    const continuation = {
      type: "identity.authStatePruneContinued" as const,
      runId: begin.runId,
      generation: lane.generation,
      shardId: lane.shardId,
      table: "auth_tokens" as const,
      cursor: null,
      asOf: now,
    };
    const first = await pruneExpiredAuthState({
      container: h.workerContainer,
      input: continuation,
    });
    expect(first.authTokens).toBe(100);
    expect(first.continued).toBe(true);

    // Response lost after the DELETE: re-run with the same input cursor.
    const second = await pruneExpiredAuthState({
      container: h.workerContainer,
      input: continuation,
    });
    expect(second.authTokens).toBe(50);
    expect(h.backend.authTokens.size).toBe(0);
  });

  it("TC-identity-171: resharded generations are processed with at most 6 active lanes and no cursor mixing", async () => {
    const h = createTestHarness({
      // The spec's maximum reshard shape: old + new generations over 16
      // shards each = 32 lanes total.
      maintenanceShardIds: Array.from({ length: 16 }, (_, i) => `shard-${i}`),
      routingGenerations: ["gen-old", "gen-new"],
    });
    const past = new Date(h.clock.now().getTime() - 1);
    for (let i = 0; i < 5; i += 1) {
      seedSession(h, past);
    }

    // Observe the claimed-lane high-water mark and every requested claim
    // limit across the whole run.
    const realStore = h.workerContainer.maintenanceRunStore;
    const claimLimits: number[] = [];
    let peakActiveLanes = 0;
    const measure = (): void => {
      for (const run of h.backend.maintenanceRuns.values()) {
        const active = run.lanes.filter(
          (lane) => lane.status === "claimed",
        ).length;
        peakActiveLanes = Math.max(peakActiveLanes, active);
      }
    };
    const spyingStore: typeof realStore = {
      ...realStore,
      async claimLanes(runId, leaseOwner, limit) {
        claimLimits.push(limit);
        const claimed = await realStore.claimLanes(runId, leaseOwner, limit);
        measure();
        return claimed;
      },
      async advanceOrAck(input) {
        const result = await realStore.advanceOrAck(input);
        measure();
        return result;
      },
    };
    const container = {
      ...h.workerContainer,
      maintenanceRunStore: spyingStore,
    };

    // 32 lanes exceed one invocation's command budget: keep invoking the
    // same hour's cron until the run reports no remaining work.
    let sessionsDeleted = 0;
    for (let invocations = 0; ; invocations += 1) {
      expect(invocations).toBeLessThan(10);
      const view = await pruneExpiredAuthState({
        container,
        input: { type: "cron" },
      });
      sessionsDeleted += view.sessions;
      if (!view.continued) {
        break;
      }
    }

    expect(sessionsDeleted).toBe(5);
    const run = h.backend.maintenanceRuns.values()[0];
    expect(run?.status).toBe("completed");
    expect(new Set(run?.lanes.map((lane) => lane.generation))).toEqual(
      new Set(["gen-old", "gen-new"]),
    );
    expect(run?.lanes).toHaveLength(32);
    // Concurrency caps from the spec: never more than 6 active lanes,
    // and no single claim asks for more than 6.
    expect(peakActiveLanes).toBeGreaterThan(0);
    expect(peakActiveLanes).toBeLessThanOrEqual(6);
    expect(claimLimits.length).toBeGreaterThan(0);
    expect(Math.max(...claimLimits)).toBeLessThanOrEqual(6);
  });

  it("a budget-exhausted cron releases every claimed lane before returning", async () => {
    // 32 lanes x 4 tables = 128 commands exceed the 100-command budget,
    // so the first cron must break mid-run. Its claimed lanes have to be
    // released on the way out: `claimLanes` never returns claimed lanes
    // and the same-owner cron renews the lease each run, so a lane left
    // claimed would be stuck forever.
    const h = createTestHarness({
      maintenanceShardIds: Array.from({ length: 16 }, (_, i) => `shard-${i}`),
      routingGenerations: ["gen-old", "gen-new"],
    });
    const view = await cron(h);
    expect(view.continued).toBe(true);
    for (const run of h.backend.maintenanceRuns.values()) {
      expect(
        run.lanes.filter((lane) => lane.status === "claimed"),
      ).toHaveLength(0);
    }
  });

  it("a lane operation that throws still releases the in-flight and queued lanes", async () => {
    const h = createTestHarness({
      maintenanceShardIds: ["shard-0", "shard-1", "shard-2", "shard-3"],
    });
    const past = new Date(h.clock.now().getTime() - 1);
    // More than one page, so the first lane reaches `checkpointLane`.
    for (let i = 0; i < 150; i += 1) {
      seedAuthToken(h, past);
    }
    const realStore = h.workerContainer.maintenanceRunStore;
    const container = {
      ...h.workerContainer,
      maintenanceRunStore: {
        ...realStore,
        async checkpointLane(): Promise<void> {
          // What a lapsed lease looks like from the usecase's side.
          throw new Error("checkpoint down");
        },
      },
    };

    await expect(
      pruneExpiredAuthState({ container, input: { type: "cron" } }),
    ).rejects.toThrow("checkpoint down");
    for (const run of h.backend.maintenanceRuns.values()) {
      expect(
        run.lanes.filter((lane) => lane.status === "claimed"),
      ).toHaveLength(0);
    }
  });

  it("TC-identity-347: a run whose table set differs from this deployment's order still completes in one cron", async () => {
    // A run snapshotted under a table order this deployment no longer
    // uses — what a table-set change looks like across a deploy
    // boundary. Every position comes from the run itself, so the order
    // difference cannot stall the walk.
    const h = createTestHarness({
      maintenanceTablesByKind: {
        authStatePrune: ["identity_removal_receipts", "sessions"],
      },
    });
    seedSession(h, new Date(h.clock.now().getTime() - 1));

    const view = await cron(h);
    expect(view.sessions).toBe(1);
    expect(view.continued).toBe(false);
    expect(h.backend.sessions.size).toBe(0);
    expect(h.backend.maintenanceRuns.values()[0]?.status).toBe("completed");
    for (const run of h.backend.maintenanceRuns.values()) {
      expect(
        run.lanes.filter((lane) => lane.status === "claimed"),
      ).toHaveLength(0);
    }
  });

  it("TC-identity-348: more shards than the concurrent-claim cap are drained from the ack's next lane, without a release round-trip", async () => {
    const h = createTestHarness({
      maintenanceShardIds: Array.from({ length: 8 }, (_, i) => `shard-${i}`),
    });
    const realStore = h.workerContainer.maintenanceRunStore;
    let releases = 0;
    const container = {
      ...h.workerContainer,
      maintenanceRunStore: {
        ...realStore,
        async advanceOrAck(
          input: Parameters<typeof realStore.advanceOrAck>[0],
        ) {
          if (!input.completed) {
            releases += 1;
          }
          return realStore.advanceOrAck(input);
        },
      },
    };

    const view = await pruneExpiredAuthState({
      container,
      input: { type: "cron" },
    });
    expect(view.continued).toBe(false);
    expect(h.backend.maintenanceRuns.values()[0]?.status).toBe("completed");
    // The shards past the cap arrive through the ack itself, so nothing
    // is ever handed back to be claimed again.
    expect(releases).toBe(0);
  });

  it("TC-identity-349: a table this deployment cannot sweep is skipped so the run still completes", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    seedSession(h, new Date(now.getTime() - 1));
    // A run created before this deployment dropped the sweep for one of
    // its tables, its lease already lapsed so this cron resumes it. The
    // stored `asOf` is what the resumed sweep uses as its boundary, so
    // it has to sit at or after the rows seeded above.
    h.backend.maintenanceRuns.set("stale-run", {
      runId: "stale-run",
      kind: "authStatePrune",
      status: "running",
      asOf: now,
      leaseOwner: "gone",
      leaseUntil: new Date(now.getTime() - 1),
      tables: ["job_tombstones", "sessions"],
      lanes: [
        {
          generation: "gen-1",
          shardId: "shard-0",
          status: "pending",
          tableIndex: 0,
          cursor: null,
          commandKey: "stale-run:gen-1:shard-0:job_tombstones:",
        },
      ],
      expiresAt: null,
    });

    const view = await cron(h);
    expect(view.sessions).toBe(1);
    expect(h.backend.sessions.size).toBe(0);
    expect(h.backend.maintenanceRuns.get("stale-run")?.status).toBe(
      "completed",
    );
    // The skip left nothing behind: the single cron drove the resumed run
    // to the end rather than deferring the table it could not sweep.
    expect(view.continued).toBe(false);
    const skipped = h.logger
      .byLevel("error")
      .find((entry) => entry.message.includes("unknown sweep table"));
    expect(skipped?.meta).toMatchObject({
      table: "job_tombstones",
      runId: "stale-run",
      generation: "gen-1",
      shardId: "shard-0",
    });

    // Skipping is not a delete failure. The run above still swept
    // `sessions`, so only a run whose tables are *all* unknown can
    // observe that: with no successful delete to offset a counted skip,
    // the invocation would throw `SystemError(DatabaseError)` and an
    // older table set would be indistinguishable from a database outage.
    h.backend.maintenanceRuns.set("all-unknown-run", {
      runId: "all-unknown-run",
      kind: "authStatePrune",
      status: "running",
      asOf: now,
      leaseOwner: "gone",
      leaseUntil: new Date(now.getTime() - 1),
      tables: ["job_tombstones"],
      lanes: [
        {
          generation: "gen-1",
          shardId: "shard-0",
          status: "pending",
          tableIndex: 0,
          cursor: null,
          commandKey: "all-unknown-run:gen-1:shard-0:job_tombstones:",
        },
      ],
      expiresAt: null,
    });

    await expect(cron(h)).resolves.toMatchObject({ continued: false });
    expect(h.backend.maintenanceRuns.get("all-unknown-run")?.status).toBe(
      "completed",
    );
  });

  it("a failing lane release is logged rather than thrown, and leaves the lanes claimed with the run still unfinished", async () => {
    // The release runs on the way out, including out of a throw whose own
    // cause makes the release fail too, so it must not rethrow — the
    // original failure is what has to reach the caller. What it must not
    // do is hide the consequence: the lanes stay `claimed`, and
    // `PRUNE_LEASE_OWNER` being a process constant means this process's
    // next cron renews its own lease, so the lapsed-lease reclaim never
    // fires for them. `releaseLane`'s `workRemains = true` cannot be
    // observed here because the usecase throws instead of returning a
    // view; it is kept for a future call site that returns one.
    const h = createTestHarness({
      maintenanceShardIds: ["shard-0", "shard-1", "shard-2", "shard-3"],
    });
    const past = new Date(h.clock.now().getTime() - 1);
    // More than one page, so the first lane reaches `checkpointLane`.
    for (let i = 0; i < 150; i += 1) {
      seedAuthToken(h, past);
    }
    const realStore = h.workerContainer.maintenanceRunStore;
    const container = {
      ...h.workerContainer,
      maintenanceRunStore: {
        ...realStore,
        async checkpointLane(): Promise<void> {
          throw new Error("checkpoint down");
        },
        async advanceOrAck(
          input: Parameters<typeof realStore.advanceOrAck>[0],
        ) {
          if (!input.completed) {
            throw new Error("release down");
          }
          return realStore.advanceOrAck(input);
        },
      },
    };

    await expect(
      pruneExpiredAuthState({ container, input: { type: "cron" } }),
    ).rejects.toThrow("checkpoint down");
    expect(
      h.logger
        .byLevel("error")
        .some((entry) =>
          entry.message.includes("[pruneExpiredAuthState] lane release failed"),
        ),
    ).toBe(true);
    // The lanes really are stuck — the report is what has to stay honest.
    expect(
      h.backend.maintenanceRuns
        .values()
        .flatMap((run) => run.lanes)
        .filter((lane) => lane.status === "claimed"),
    ).toHaveLength(4);
  });

  it("TC-identity-172: a second cron against a live foreign lease is a no-op", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    seedSession(h, new Date(now.getTime() - 1));
    await h.workerContainer.maintenanceRunStore.beginOrResumeKind({
      candidateRunId: "foreign-run",
      kind: "authStatePrune",
      candidateAsOf: now,
      generations: ["gen-1"],
      leaseOwner: "other-owner",
      leaseUntil: new Date(now.getTime() + 10 * MINUTE_MS),
    });

    const view = await cron(h);
    expect(view.sessions).toBe(0);
    expect(view.continued).toBe(true);
    expect(h.backend.sessions.size).toBe(1);
  });

  it("TC-identity-173: the next hour's cron resumes the oldest running run with its fixed asOf", async () => {
    const h = createTestHarness();
    const t0 = h.clock.now();
    seedAuthToken(h, new Date(t0.getTime() - 1));
    // A session that expires after this run's asOf but before the next
    // hour: the resumed run must NOT delete it (asOf stays fixed at t0).
    seedSession(h, new Date(t0.getTime() + 30 * MINUTE_MS));

    // The first hour's invocation fails outright (its only command
    // failed → SystemError), leaving the run running with its asOf.
    await expect(
      pruneExpiredAuthState({
        container: withSweepOverride(h, "auth_tokens", failingSweep),
        input: { type: "cron" },
      }),
    ).rejects.toSatisfy(isSystemError);
    expect(h.backend.maintenanceRuns.values()[0]?.status).toBe("running");

    h.clock.advance(HOUR_MS);
    const second = await cron(h);
    expect(second.authTokens).toBe(1);
    // The fixed asOf kept the mid-hour-expiring session alive.
    expect(h.backend.sessions.size).toBe(1);
    expect(h.backend.maintenanceRuns.values()[0]?.status).toBe("completed");
  });

  it("TC-identity-174: after a lapsed lease the next cron reclaims the abandoned lane at its position and completes the run", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    for (let i = 0; i < 150; i += 1) {
      seedAuthToken(h, new Date(now.getTime() - 1));
    }
    const store = h.workerContainer.maintenanceRunStore;
    // A dead invocation began the run, claimed the lane, swept one page,
    // then vanished with the lane still claimed at its cursor.
    const begin = await store.beginOrResumeKind({
      candidateRunId: "run-tc174",
      kind: "authStatePrune",
      candidateAsOf: now,
      generations: ["gen-1"],
      leaseOwner: PRUNE_LEASE_OWNER,
      leaseUntil: new Date(now.getTime() + 10 * MINUTE_MS),
    });
    const [lane] = await store.claimLanes(begin.runId, PRUNE_LEASE_OWNER, 1);
    if (lane === undefined || lane.table !== "auth_tokens") {
      throw new Error("expected the auth_tokens lane");
    }
    const swept = await pruneExpiredAuthState({
      container: h.workerContainer,
      input: {
        type: "identity.authStatePruneContinued",
        runId: begin.runId,
        generation: lane.generation,
        shardId: lane.shardId,
        table: "auth_tokens",
        cursor: lane.cursor,
        asOf: begin.asOf,
      },
    });
    expect(swept.authTokens).toBe(100);
    expect(
      h.backend.maintenanceRuns
        .get(begin.runId)
        ?.lanes.filter((row) => row.status === "claimed"),
    ).toHaveLength(1);

    h.clock.advance(11 * MINUTE_MS);
    // The next cron re-leases the lapsed run (no duplicate run) and takes
    // the abandoned lane back at its stored table and cursor.
    const view = await cron(h);
    expect(
      h.backend.maintenanceRuns
        .values()
        .filter((run) => run.kind === "authStatePrune"),
    ).toHaveLength(1);
    expect(view.authTokens).toBe(50);
    expect(h.backend.authTokens.size).toBe(0);
    expect(view.continued).toBe(false);
    expect(h.backend.maintenanceRuns.get(begin.runId)?.status).toBe(
      "completed",
    );
  });

  it("TC-identity-175: completed maintenance runs past retention are reclaimed 100 per page and running runs survive", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    for (let i = 0; i < 250; i += 1) {
      const runId = `old-run-${String(i).padStart(3, "0")}`;
      h.backend.maintenanceRuns.set(runId, {
        runId,
        kind: "authStatePrune",
        status: "completed",
        asOf: new Date(now.getTime() - 40 * DAY_MS),
        leaseOwner: "gone",
        leaseUntil: new Date(now.getTime() - 40 * DAY_MS),
        tables: ["auth_tokens"],
        lanes: [],
        expiresAt: new Date(now.getTime() - 1),
      });
    }
    h.backend.maintenanceRuns.set("running-run", {
      runId: "running-run",
      kind: "jobTombstonePrune",
      status: "running",
      asOf: now,
      leaseOwner: "live",
      leaseUntil: new Date(now.getTime() + 10 * MINUTE_MS),
      tables: ["job_tombstones"],
      lanes: [],
      expiresAt: null,
    });

    let passes = 0;
    let continued = true;
    while (continued) {
      passes += 1;
      const view = await pruneExpiredAuthState({
        container: h.workerContainer,
        input: {
          type: "global.maintenanceRunPruneContinued",
          cursor: null,
          asOf: now,
        },
      });
      continued = view.continued;
    }
    expect(passes).toBe(3);
    expect(h.backend.maintenanceRuns.get("running-run")?.status).toBe(
      "running",
    );
    expect(
      h.backend.maintenanceRuns
        .values()
        .filter((run) => run.runId.startsWith("old-run-")),
    ).toHaveLength(0);
  });

  it("TC-identity-176: a completed run expiring exactly at asOf is reclaimed; 1ms later survives", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    const completed = (runId: string, expiresAt: Date) => {
      h.backend.maintenanceRuns.set(runId, {
        runId,
        kind: "authStatePrune",
        status: "completed",
        asOf: now,
        leaseOwner: "gone",
        leaseUntil: now,
        tables: ["auth_tokens"],
        lanes: [],
        expiresAt,
      });
    };
    completed("boundary-run", now);
    completed("future-run", new Date(now.getTime() + 1));

    await pruneExpiredAuthState({
      container: h.workerContainer,
      input: {
        type: "global.maintenanceRunPruneContinued",
        cursor: null,
        asOf: now,
      },
    });
    expect(h.backend.maintenanceRuns.get("boundary-run")).toBeUndefined();
    expect(h.backend.maintenanceRuns.get("future-run")).toBeDefined();
  });

  it("TC-identity-177: 101 completed runs survive a lost response between pages without loss", async () => {
    const h = createTestHarness();
    const now = h.clock.now();
    for (let i = 0; i < 101; i += 1) {
      const runId = `old-run-${String(i).padStart(3, "0")}`;
      h.backend.maintenanceRuns.set(runId, {
        runId,
        kind: "authStatePrune",
        status: "completed",
        asOf: now,
        leaseOwner: "gone",
        leaseUntil: now,
        tables: ["auth_tokens"],
        lanes: [],
        expiresAt: new Date(now.getTime() - 1),
      });
    }
    const input = {
      type: "global.maintenanceRunPruneContinued" as const,
      cursor: null,
      asOf: now,
    };
    const first = await pruneExpiredAuthState({
      container: h.workerContainer,
      input,
    });
    expect(first.continued).toBe(true);
    // Lost response: the retry re-runs from the same cursor.
    const second = await pruneExpiredAuthState({
      container: h.workerContainer,
      input,
    });
    expect(second.continued).toBe(false);
    expect(h.backend.maintenanceRuns.size).toBe(0);
  });

  it("TC-identity-178: 101 rows sharing one expiresAt are reclaimed exactly once via the key tie-break", async () => {
    const h = createTestHarness();
    const sameExpiry = new Date(h.clock.now().getTime() - 1);
    for (let i = 0; i < 101; i += 1) {
      seedLoginAttempt(h, sameExpiry);
      seedOAuthState(h, sameExpiry);
    }
    const view = await cron(h);
    expect(view.loginAttempts).toBe(101);
    expect(view.oauthFlowStates).toBe(101);
    expect(h.backend.loginAttempts.size).toBe(0);
    expect(h.backend.oauthStates.size).toBe(0);
  });
});
