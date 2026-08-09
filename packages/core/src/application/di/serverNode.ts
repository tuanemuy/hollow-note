import { content } from "@repo/core/config";
import { z } from "zod";
import type { RelayTrigger } from "../ports/relayTrigger";
import type { TuningEnv } from "./env";
import { createMemoryRuntime, type MemoryRuntime } from "./memoryRuntime";
import type { AppConfig, RequestContainer, WorkerContainer } from "./types";

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

export type NodeRequestServerConfig = AppConfig;

export function readNodeRequestServerConfig(
  env: NodeServerEnv,
): NodeRequestServerConfig {
  return {
    ...content,
    appUrl: env.APP_URL,
  };
}

// One `MemoryBackend` per process (ADR-002): request and worker
// containers must observe the same tables, and the dev server keeps its
// data exactly as long as the process lives. Pinned on `globalThis` so
// the SSR and RSC module graphs (and HMR reloads of this module) share
// the same runtime instead of silently forking the store.
const RUNTIME_SYMBOL: unique symbol = Symbol.for(
  "@tanstack-start-template/memory-runtime",
) as never;
type RuntimeSlot = { [RUNTIME_SYMBOL]?: MemoryRuntime };

function memoryRuntime(): MemoryRuntime {
  const slot = globalThis as unknown as RuntimeSlot;
  slot[RUNTIME_SYMBOL] ??= createMemoryRuntime();
  return slot[RUNTIME_SYMBOL];
}

/**
 * Late-binds the worker runner's relay trigger so commits kick an
 * immediate relay tick. Called once from `server.node.ts` after the
 * runner is constructed; until then commits wait for the interval tick.
 */
export function bindNodeRelayTrigger(trigger: RelayTrigger): void {
  memoryRuntime().bindRelayTrigger(trigger);
}

/** Build the request-scoped container for the Node runtime. */
export function createNodeRequestContainer(
  config: NodeRequestServerConfig,
): RequestContainer {
  return memoryRuntime().createRequestContainer(config);
}

/** Build the worker-scoped container for the Node runtime. */
export function createNodeWorkerContainer(): WorkerContainer {
  return memoryRuntime().createWorkerContainer();
}
