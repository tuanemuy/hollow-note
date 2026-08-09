// Transitional stub wiring (Issue #1 step 1): the libSQL adapter left with
// the reference implementation, and the in-memory adapters arrive in step 6.
// Until step 8 rewires this factory against `adapters/memory/`, the request
// container carries a unit-of-work provider that rejects on use and the
// worker container runs against an empty in-process outbox, so the app
// boots as an empty shell with the relay/prune loops idling harmlessly.

import { content } from "@repo/core/config";
import type { EventId } from "@repo/core/domain/common/event";
import { z } from "zod";
import type {
  GlobalUnitOfWorkProvider,
  ScopeUnitOfWorkProvider,
} from "../execution/unitOfWork";
import { SystemClock } from "../ports/clock";
import type { IdempotencyStore } from "../ports/idempotencyStore";
import { UuidV7Generator } from "../ports/idGenerator";
import { ConsoleLogger } from "../ports/logger";
import type {
  ClaimPendingArgs,
  OutboxEntry,
  OutboxRepository,
} from "../ports/outboxRepository";
import type { TuningEnv } from "./env";
import type {
  AppConfig,
  RequestContainer,
  SharedDeps,
  WorkerContainer,
} from "./types";

export type NodeServerEnv = Readonly<{
  APP_URL: string;
  PORT?: string | undefined;
  HOSTNAME?: string | undefined;
  OUTBOX_BATCH_SIZE?: string | undefined;
  OUTBOX_LEASE_MS?: string | undefined;
  OUTBOX_MAX_ATTEMPTS?: string | undefined;
  OUTBOX_RETENTION_MS?: string | undefined;
}>;

const nodeServerEnvSchema = z.object({
  APP_URL: z.string().min(1, "APP_URL is required"),
  PORT: z.string().optional(),
  HOSTNAME: z.string().optional(),
  OUTBOX_BATCH_SIZE: z.string().optional(),
  OUTBOX_LEASE_MS: z.string().optional(),
  OUTBOX_MAX_ATTEMPTS: z.string().optional(),
  OUTBOX_RETENTION_MS: z.string().optional(),
});

/**
 * Validates `process.env`-shaped input against the Node-runtime surface.
 */
export function readNodeServerEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeServerEnv {
  return nodeServerEnvSchema.parse(source);
}

/** Projection of {@link NodeServerEnv} to the runtime-agnostic tuning shape. */
export function nodeServerEnvToTuningEnv(env: NodeServerEnv): TuningEnv {
  return {
    ...(env.OUTBOX_BATCH_SIZE !== undefined
      ? { OUTBOX_BATCH_SIZE: env.OUTBOX_BATCH_SIZE }
      : {}),
    ...(env.OUTBOX_LEASE_MS !== undefined
      ? { OUTBOX_LEASE_MS: env.OUTBOX_LEASE_MS }
      : {}),
    ...(env.OUTBOX_MAX_ATTEMPTS !== undefined
      ? { OUTBOX_MAX_ATTEMPTS: env.OUTBOX_MAX_ATTEMPTS }
      : {}),
    ...(env.OUTBOX_RETENTION_MS !== undefined
      ? { OUTBOX_RETENTION_MS: env.OUTBOX_RETENTION_MS }
      : {}),
  };
}

function buildSharedDeps(): SharedDeps {
  return {
    clock: SystemClock,
    idGenerator: UuidV7Generator,
    logger: ConsoleLogger,
  };
}

const notWired = (name: string): Promise<never> =>
  Promise.reject(
    new Error(
      `${name} is not wired yet — replaced by the memory adapters in Issue #1 step 8`,
    ),
  );

const stubGlobalUnitOfWorkProvider: GlobalUnitOfWorkProvider = {
  run(): Promise<never> {
    return notWired("GlobalUnitOfWorkProvider");
  },
};

const stubScopeUnitOfWorkProvider: ScopeUnitOfWorkProvider = {
  run(): Promise<never> {
    return notWired("ScopeUnitOfWorkProvider");
  },
};

const stubOutboxRepository: OutboxRepository = {
  async save(): Promise<void> {},
  async claimPending(_args: ClaimPendingArgs): Promise<readonly OutboxEntry[]> {
    return [];
  },
  async finalize(): Promise<void> {},
  async pruneProcessed(): Promise<{ deleted: number }> {
    return { deleted: 0 };
  },
};

const stubIdempotencyStore: IdempotencyStore = {
  async markProcessed(_consumer: string, _eventId: EventId): Promise<boolean> {
    return true;
  },
};

export type NodeRequestServerConfig = AppConfig;

export function readNodeRequestServerConfig(
  env: NodeServerEnv,
): NodeRequestServerConfig {
  return {
    ...content,
    appUrl: env.APP_URL,
  };
}

/** Build the request-scoped container for the Node runtime. */
export function createNodeRequestContainer(
  config: NodeRequestServerConfig,
): RequestContainer {
  return {
    ...buildSharedDeps(),
    config,
    globalUnitOfWorkProvider: stubGlobalUnitOfWorkProvider,
    scopeUnitOfWorkProvider: stubScopeUnitOfWorkProvider,
  };
}

/** Build the worker-scoped container for the Node runtime. */
export function createNodeWorkerContainer(): WorkerContainer {
  return {
    ...buildSharedDeps(),
    outboxRepository: stubOutboxRepository,
    idempotencyStore: stubIdempotencyStore,
  };
}
