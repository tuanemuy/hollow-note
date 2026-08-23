import type { OAuthRuntimeConfig } from "@repo/core/adapters/oauth/signInOAuthClient";
import { content } from "@repo/core/config";
import { z } from "zod";
import type { RelayTrigger } from "../ports/relayTrigger";
import type { ScopeTaskTrigger } from "../ports/scopeTaskTrigger";
import type { TuningEnv } from "./env";
import {
  createMemoryRuntime,
  type MemoryRuntime,
  type MemoryRuntimeOptions,
} from "./memoryRuntime";
import type { AppConfig, RequestContainer, WorkerContainer } from "./types";

export type NodeServerEnv = Readonly<{
  APP_URL: string;
  PORT?: string | undefined;
  HOSTNAME?: string | undefined;
  NODE_ENV?: string | undefined;
  OAUTH_DEV_MODE?: string | undefined;
  GOOGLE_OAUTH_CLIENT_ID?: string | undefined;
  GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined;
  DELETION_TICKET_KEY?: string | undefined;
  OUTBOX_BATCH_SIZE?: string | undefined;
  OUTBOX_LEASE_MS?: string | undefined;
  OUTBOX_MAX_ATTEMPTS?: string | undefined;
  OUTBOX_RETENTION_MS?: string | undefined;
  SCOPE_TASK_LEASE_MS?: string | undefined;
}>;

const isTrue = (value: string | undefined): boolean => value === "true";

const nonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0;

/**
 * Boot-time OAuth provider selection. Expressed as a refinement of the
 * env schema — not inside `createMemoryRuntime` — because the
 * runtime is also built by `createTestHarness`, which has no env and must
 * never be able to fail these rules.
 */
const OAUTH_SETUP_HINT =
  "add `OAUTH_DEV_MODE=true` to apps/web/.env and run `pnpm dev` (NODE_ENV=development), or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET";

// The one `NODE_ENV` the dev identity provider may run under. Stated as
// an allowlist rather than a `production` denylist because every value
// we cannot classify — unset, empty, `staging`, a typo — would otherwise
// serve a consent screen that signs in whoever is typed into it. Only
// `vite dev` sets `development`; `pnpm start` declares `production`, so
// a production bundle is refused whatever the deployment passes.
const DEV_IDP_NODE_ENV = "development";

const TICKET_KEY_BYTES = 32;

const decodeKeyMaterial = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, "base64url"));

const isKeyMaterial = (value: string): boolean =>
  decodeKeyMaterial(value).length === TICKET_KEY_BYTES;

const nodeServerEnvSchema = z
  .object({
    APP_URL: z.string().min(1, "APP_URL is required"),
    PORT: z.string().optional(),
    HOSTNAME: z.string().optional(),
    NODE_ENV: z.string().optional(),
    OAUTH_DEV_MODE: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    // Optional: unset means a per-process key, which only costs
    // outstanding tickets their validity across a restart. Set but
    // malformed is refused instead of silently falling back — a
    // deployment that meant to pin the key must not boot without it.
    DELETION_TICKET_KEY: z
      .string()
      .optional()
      .refine(
        (value) => value === undefined || value === "" || isKeyMaterial(value),
        "DELETION_TICKET_KEY must be 32 bytes encoded as base64url",
      ),
    OUTBOX_BATCH_SIZE: z.string().optional(),
    OUTBOX_LEASE_MS: z.string().optional(),
    OUTBOX_MAX_ATTEMPTS: z.string().optional(),
    OUTBOX_RETENTION_MS: z.string().optional(),
    SCOPE_TASK_LEASE_MS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (isTrue(env.OAUTH_DEV_MODE)) {
      if (env.NODE_ENV !== DEV_IDP_NODE_ENV) {
        ctx.addIssue({
          code: "custom",
          path: ["OAUTH_DEV_MODE"],
          message: `OAUTH_DEV_MODE=true is accepted only under NODE_ENV=${DEV_IDP_NODE_ENV} (got ${JSON.stringify(env.NODE_ENV)}): the dev identity provider signs anyone in`,
        });
      }
      return;
    }
    if (
      !nonEmpty(env.GOOGLE_OAUTH_CLIENT_ID) ||
      !nonEmpty(env.GOOGLE_OAUTH_CLIENT_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["OAUTH_DEV_MODE"],
        message: `No OAuth identity provider is configured: ${OAUTH_SETUP_HINT}`,
      });
    }
  });

/**
 * Validates `process.env`-shaped input against the Node-runtime surface.
 */
export function readNodeServerEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeServerEnv {
  return nodeServerEnvSchema.parse(source);
}

/**
 * Projection of {@link NodeServerEnv} to the runtime-agnostic tuning shape.
 *
 * An empty value among these five is dropped rather than forwarded — a
 * reading this projection takes, not one the whole env surface shares.
 * Empty values are ordinary in container manifests
 * (`OUTBOX_LEASE_MS=$UNSET_VAR`), so they mean "unset" here, the same
 * reading `DELETION_TICKET_KEY` takes. Forwarding `""` would instead
 * coerce to `0` and refuse the boot.
 */
export function nodeServerEnvToTuningEnv(env: NodeServerEnv): TuningEnv {
  return {
    ...(nonEmpty(env.OUTBOX_BATCH_SIZE)
      ? { OUTBOX_BATCH_SIZE: env.OUTBOX_BATCH_SIZE }
      : {}),
    ...(nonEmpty(env.OUTBOX_LEASE_MS)
      ? { OUTBOX_LEASE_MS: env.OUTBOX_LEASE_MS }
      : {}),
    ...(nonEmpty(env.OUTBOX_MAX_ATTEMPTS)
      ? { OUTBOX_MAX_ATTEMPTS: env.OUTBOX_MAX_ATTEMPTS }
      : {}),
    ...(nonEmpty(env.OUTBOX_RETENTION_MS)
      ? { OUTBOX_RETENTION_MS: env.OUTBOX_RETENTION_MS }
      : {}),
    ...(nonEmpty(env.SCOPE_TASK_LEASE_MS)
      ? { SCOPE_TASK_LEASE_MS: env.SCOPE_TASK_LEASE_MS }
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

// One `MemoryBackend` per process (spec/adr/024): request and worker
// containers must observe the same tables, and the dev server keeps its
// data exactly as long as the process lives. Pinned on `globalThis` so
// the SSR and RSC module graphs (and HMR reloads of this module) share
// the same runtime instead of silently forking the store. Filling and
// reading the slot are both guarded: an env-less default would decide
// the sign-in provider by omission.
const RUNTIME_SYMBOL: unique symbol = Symbol.for(
  "@tanstack-start-template/memory-runtime",
) as never;
type HeldRuntime = Readonly<{ runtime: MemoryRuntime; envDigest: string }>;
type RuntimeSlot = { [RUNTIME_SYMBOL]?: HeldRuntime };

const INIT_ORDER_HINT =
  "`initNodeRuntime(readNodeServerEnv())` runs once at the top of `boot()`, before any container is built";

function memoryRuntime(): MemoryRuntime {
  const held = (globalThis as unknown as RuntimeSlot)[RUNTIME_SYMBOL];
  if (held === undefined) {
    throw new Error(
      `[serverNode] the process runtime is not initialized: ${INIT_ORDER_HINT}`,
    );
  }
  return held.runtime;
}

/** Projection of {@link NodeServerEnv} to the runtime's construction options. */
export function nodeServerEnvToRuntimeOptions(
  env: NodeServerEnv,
): MemoryRuntimeOptions {
  const ticketKey = env.DELETION_TICKET_KEY;
  return {
    oauth: readOAuthRuntimeConfig(env),
    ...(nonEmpty(ticketKey)
      ? {
          deletionTicketKeyRing: {
            currentVersion: 1,
            keys: new Map([[1, decodeKeyMaterial(ticketKey)]]),
          },
        }
      : {}),
  };
}

function readOAuthRuntimeConfig(env: NodeServerEnv): OAuthRuntimeConfig {
  if (isTrue(env.OAUTH_DEV_MODE)) {
    return { mode: "dev" };
  }
  // The schema already refused every env that reaches here without both
  // credentials, so the fallbacks are unreachable rather than lenient.
  return {
    mode: "google",
    clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
  };
}

const envDigestOf = (env: NodeServerEnv): string =>
  JSON.stringify(
    Object.entries(env).sort(([left], [right]) => left.localeCompare(right)),
  );

/**
 * Builds the process-wide runtime from validated env. Called once at the
 * very top of `server.node.ts#boot`, before any container is created.
 *
 * A filled slot is kept only when this env is the one it was built from
 * — that is `vite dev` re-running `boot()` after a program reload, where
 * keeping the singleton also keeps the process's data. Any other env is
 * refused rather than dropped: the singleton carries the sign-in
 * provider selection, so serving under settings that were validated but
 * never applied is exactly the failure this guards.
 */
export function initNodeRuntime(env: NodeServerEnv): void {
  const slot = globalThis as unknown as RuntimeSlot;
  const envDigest = envDigestOf(env);
  const held = slot[RUNTIME_SYMBOL];
  if (held !== undefined) {
    if (held.envDigest === envDigest) {
      return;
    }
    throw new Error(
      `[serverNode] the process runtime is already initialized from a different environment: ${INIT_ORDER_HINT}`,
    );
  }
  slot[RUNTIME_SYMBOL] = {
    runtime: createMemoryRuntime(nodeServerEnvToRuntimeOptions(env)),
    envDigest,
  };
}

/**
 * Late-binds the worker runner's relay trigger so commits kick an
 * immediate relay tick. Called once from `server.node.ts` after the
 * runner is constructed; until then commits wait for the interval tick.
 */
export function bindNodeRelayTrigger(trigger: RelayTrigger): void {
  memoryRuntime().bindRelayTrigger(trigger);
}

/**
 * Late-binds the runner's scope-task trigger so a committed continuation
 * is resumed within the same second instead of waiting for the interval
 * tick.
 */
export function bindNodeScopeTaskTrigger(trigger: ScopeTaskTrigger): void {
  memoryRuntime().bindScopeTaskTrigger(trigger);
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
