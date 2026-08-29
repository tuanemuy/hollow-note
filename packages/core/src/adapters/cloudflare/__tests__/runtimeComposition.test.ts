import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type CloudflareRuntime,
  createCloudflareRuntime,
  DEFAULT_MAINTENANCE_TABLES,
} from "../../../application/di/cloudflareRuntime";
import type { MemoryRuntime } from "../../../application/di/memoryRuntime";
import type { AppRuntime } from "../../../application/di/runtime";
import type {
  AppConfig,
  RequestContainer,
  WorkerContainer,
} from "../../../application/di/types";
import type { MailSender } from "../../../application/ports/mailSender";
import type { ScopeKey } from "../../../application/scope";
import { User } from "../../../domain/identity/user";
import { UserId } from "../../../domain/identity/valueObject";

/**
 * The Cloudflare composition root, built over the same real bindings the
 * conformance suites use.
 *
 * What is under test is the *wiring*, not the ports — those have their
 * own suites. So this asserts three things a type error alone would not
 * catch: that both containers are complete, that the ports they hand out
 * actually point at these bindings, and that the late-bound triggers
 * reach the providers the containers were built from.
 */

const asAppRuntime = (runtime: AppRuntime): AppRuntime => runtime;

/**
 * Type-level half of the two container tests below: a `satisfies` clause
 * only proves the listed names are keys, so without this a port added to
 * a container would leave the assertions green while going unchecked.
 * Instantiating it with a leftover key is a type error, not a runtime one.
 */
const assertNoUnlistedPort = <_Unlisted extends never>(): void => {};

const CONFIG: AppConfig = {
  appUrl: "https://hollow.test",
  siteName: "Hollow",
  defaultTitle: "Hollow",
  defaultDescription: "",
  themeColor: "#000000",
};

const REQUEST_PORTS = [
  "clock",
  "idGenerator",
  "logger",
  "config",
  "globalUnitOfWorkProvider",
  "scopeUnitOfWorkProvider",
  "scopeRouter",
  "noteRouteStore",
  "identityUniqueDirectory",
  "loginAttemptStore",
  "oauthStateStore",
  "objectStorage",
  "signInOAuthClient",
  "oauthDevMode",
  "userReader",
  "identityReader",
  "sessionReader",
  "authTokenReader",
  "deletionOperationReader",
  "noteReaderFor",
  "usageReaderFor",
  "workspaceReaderFor",
  "userBatchReader",
  "userWorkspaceDirectory",
  "workspaceDirectoryBatchReader",
  "publicWorkspaceDirectoryReader",
  "workspaceDirectoryProjectionWriter",
  "workspaceSlugReservationStore",
  "invitationRouteStore",
  "membershipDirectoryReservationStore",
  "mailSender",
  "passwordHasher",
  "secureTokenGenerator",
  "shareTokenProtector",
  "deletionTicketKeyRing",
] as const satisfies readonly (keyof RequestContainer)[];

const WORKER_PORTS = [
  "clock",
  "idGenerator",
  "logger",
  "globalUnitOfWorkProvider",
  "scopeUnitOfWorkProvider",
  "outboxRepository",
  "idempotencyStore",
  "maintenanceRunStore",
  "identityUniqueDirectory",
  "identityRemovalReceiptStore",
  "accountDeletionManifestStore",
  "noteRouteFanOutReader",
  "noteRouteResolver",
  "publicNoteProjectionWriter",
  "scopeTaskQueue",
  "objectStorage",
  "routingGenerations",
  "authStateSweeps",
] as const satisfies readonly (keyof WorkerContainer)[];

const mailSender: MailSender = { send: vi.fn(async () => {}) };

const keyRing = {
  currentVersion: 1,
  keys: new Map([[1, new Uint8Array(32)]]),
};

let seq = 0;

const makeRuntime = (): CloudflareRuntime => {
  seq += 1;
  const namespace = `di-${seq}`;
  return createCloudflareRuntime({
    bindings: {
      GLOBAL_DB: env.GLOBAL_DB,
      SCOPE_OBJECT: env.SCOPE_OBJECT,
      OBJECT_STORAGE: env.OBJECT_STORAGE,
    },
    oauth: { mode: "dev" },
    mailSender,
    shareTokenKeyRing: keyRing,
    deletionTicketKeyRing: keyRing,
    objectStoragePublicBaseUrl: "https://objects.hollow.test",
    objectNamespace: namespace,
    objectKeyPrefix: `${namespace}/`,
  });
};

describe("createCloudflareRuntime", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  it("satisfies the shared runtime interface, as the memory runtime does", () => {
    expect(asAppRuntime(makeRuntime())).toBeDefined();
    // `memoryRuntime.ts` does not declare `AppRuntime` itself, so this
    // call is what holds the two composition roots to one shape.
    const memoryRuntime = null as unknown as MemoryRuntime;
    expect(asAppRuntime(memoryRuntime)).toBeNull();
  });

  it("builds a request container carrying every port the type declares", () => {
    assertNoUnlistedPort<
      Exclude<keyof RequestContainer, (typeof REQUEST_PORTS)[number]>
    >();
    const container = makeRuntime().createRequestContainer(CONFIG);
    for (const port of REQUEST_PORTS) {
      expect(container[port], port).toBeDefined();
    }
    expect(container.config).toBe(CONFIG);
    expect(container.oauthDevMode).toBe(true);
  });

  it("builds a worker container carrying every port the type declares", () => {
    assertNoUnlistedPort<
      Exclude<keyof WorkerContainer, (typeof WORKER_PORTS)[number]>
    >();
    const container = makeRuntime().createWorkerContainer();
    for (const port of WORKER_PORTS) {
      expect(container[port], port).toBeDefined();
    }
    expect(container.routingGenerations).toEqual(["gen-1"]);
    expect(Object.keys(container.authStateSweeps).sort()).toEqual([
      "auth_tokens",
      "identity_removal_receipts",
      "login_attempts",
      "oauth_flow_states",
      "sessions",
    ]);
    // Every table a default `authStatePrune` run names is one this
    // deployment can actually sweep; the reverse would be skipped with a
    // single error log (ADR 062).
    expect(new Set(DEFAULT_MAINTENANCE_TABLES.authStatePrune)).toEqual(
      new Set(Object.keys(container.authStateSweeps)),
    );
  });

  it("wires the global plane to D1: a unit of work commits where the read views read", async () => {
    const runtime = makeRuntime();
    const container = runtime.createRequestContainer(CONFIG);
    const id = `di-user-${seq}`;
    const created = User.create(
      { id, email: `${id}@example.com`, displayName: "DI" },
      container.clock.now(),
    );

    await container.globalUnitOfWorkProvider.run(async (ctx) => {
      await ctx.userRepository.insert(created.entity);
      ctx.collectEvents(created.eventDrafts);
    });

    expect(
      await container.userReader.findById(UserId.create(id)),
    ).not.toBeNull();

    // The same bindings, reached from the other container: the worker's
    // outbox sees what the request's unit of work flushed.
    const worker = runtime.createWorkerContainer();
    const claimed = await worker.outboxRepository.claimPending({
      limit: 10,
      now: container.clock.now(),
      workerId: "di-test",
      leaseMs: 60_000,
    });
    expect(claimed.some((row) => row.aggregateId === id)).toBe(true);
  });

  it("routes both triggers to the providers the containers were built from", async () => {
    const runtime = makeRuntime();
    const relayKicks = vi.fn();
    const scopeTaskKicks = vi.fn();
    runtime.bindRelayTrigger({ kick: relayKicks });
    runtime.bindScopeTaskTrigger({ kick: scopeTaskKicks });

    const container = runtime.createRequestContainer(CONFIG);
    const scope: ScopeKey = {
      type: "user",
      userId: UserId.create(`di-scope-${seq}`),
    };
    const now = container.clock.now();

    await container.scopeUnitOfWorkProvider.run(scope, async (ctx) => {
      await ctx.scopeTaskScheduler.schedule({
        kind: "di.probe",
        operationId: `op-${seq}`,
        priority: 2,
        dueAt: now,
        payload: {},
      });
    });

    expect(scopeTaskKicks).toHaveBeenCalledTimes(1);
    expect(relayKicks).not.toHaveBeenCalled();

    // The scope object republished its slice of the due index inside the
    // commit RPC, so the worker plane can already see the scope's work.
    const due = await runtime
      .createWorkerContainer()
      .scopeTaskQueue.listDue(now, 10);
    expect(due.some((task) => task.operationId === `op-${seq}`)).toBe(true);
  });
});
