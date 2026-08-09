import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";
import { installContainerStore } from "@repo/core/application/di/containerStore";
import {
  bindNodeRelayTrigger,
  createNodeRequestContainer,
  createNodeWorkerContainer,
  readNodeRequestServerConfig,
  readNodeServerEnv,
} from "@repo/core/application/di/serverNode";
import type { RequestContainer } from "@repo/core/application/di/types";
import { ConsoleLogger } from "@repo/core/application/ports/logger";
import { createNodeWorkerRunner } from "@/worker/node/runner";

// SSR and RSC are separate module graphs in the same process; pin the
// ALS on `globalThis` (and on `import.meta.hot.data` for HMR) so both
// resolve the same store.
const ALS_SYMBOL: unique symbol = Symbol.for(
  "@tanstack-start-template/request-als",
) as never;
type AlsHotData = { als?: AsyncLocalStorage<RequestContainer> };
type AlsGlobalSlot = { [ALS_SYMBOL]?: AsyncLocalStorage<RequestContainer> };
const alsHotData: AlsHotData = (import.meta.hot?.data ?? {}) as AlsHotData;
const alsGlobal = globalThis as unknown as AlsGlobalSlot;
const storage =
  alsGlobal[ALS_SYMBOL] ??
  alsHotData.als ??
  new AsyncLocalStorage<RequestContainer>();
alsGlobal[ALS_SYMBOL] = storage;
if (import.meta.hot) {
  (import.meta.hot.data as AlsHotData).als = storage;
}
installContainerStore({ getStore: () => storage.getStore() });

/**
 * Boots node-runtime resources (env → worker runner → request factory)
 * and returns a fetch handler plus a shutdown hook.
 *
 * Persistence is the in-memory reference backend (ADR-002): request and
 * worker containers share one process-wide store, and a restart starts
 * blank by design.
 */
export type NodeServerBoot = Readonly<{
  fetch: (request: Request) => Promise<Response>;
  port: number;
  hostname: string;
  shutdown: () => Promise<void>;
}>;

// サービス全体の応答の既定として敷くセキュリティヘッダー
// (spec/presentation/index.md#公開ページのセキュリティヘッダー)。
// CSP は本文由来の危険を抑える 4 指令の最小集合 — script-src / style-src
// の絞り込みはフレームワーク出力の形に依存するため公開閲覧スライスで
// 詰める。Referrer-Policy はクロスオリジンへパスを送らない方針の実現。
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  [
    "Content-Security-Policy",
    "frame-ancestors 'self'; form-action 'self'; object-src 'none'; base-uri 'self'",
  ],
];

function withSecurityHeaders(response: Response): Response {
  for (const [name, value] of SECURITY_HEADERS) {
    if (!response.headers.has(name)) {
      response.headers.set(name, value);
    }
  }
  return response;
}

export async function boot(): Promise<NodeServerBoot> {
  const env = readNodeServerEnv();
  const logger = ConsoleLogger;

  const workerContainer = createNodeWorkerContainer();

  const runner = createNodeWorkerRunner({
    container: workerContainer,
    logger,
    // No event subscriber exists in the walking-skeleton slice; the
    // consumer role stays a no-op until a projection consumer lands.
    consumerHandler: async () => {},
  });
  // Commits kick the relay immediately instead of waiting for the tick.
  bindNodeRelayTrigger(runner.relayTrigger);
  runner.start();

  const config = readNodeRequestServerConfig(env);

  // `@tanstack/react-start/server-entry` only resolves once the framework
  // bundle is ready; defer the import to the first request.
  const entryPromise = import("@tanstack/react-start/server-entry").then(
    (m) => m.default,
  );

  const fetch = async (request: Request): Promise<Response> => {
    const container = createNodeRequestContainer(config);
    const entry = await entryPromise;
    const response = await storage.run(container, async () =>
      entry.fetch(request),
    );
    return withSecurityHeaders(response);
  };

  const port = Number.parseInt(env.PORT ?? "3000", 10);
  const hostname = env.HOSTNAME ?? "0.0.0.0";

  let shuttingDown: Promise<void> | null = null;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown !== null) return shuttingDown;
    shuttingDown = (async () => {
      try {
        await runner.stop();
      } catch (cause) {
        logger.error("[server.node] worker runner stop threw", { cause });
      }
    })();
    return shuttingDown;
  };

  return { fetch, port, hostname, shutdown };
}

const defaultExport = {
  async fetch(request: Request): Promise<Response> {
    const booted = await getOrStartBoot();
    return booted.fetch(request);
  },
};

// Boot lazily so importing this module for type resolution (e.g. inside
// the vite plugin's server-entry probe) does not trigger side effects.
let bootPromise: Promise<NodeServerBoot> | null = null;
function getOrStartBoot(): Promise<NodeServerBoot> {
  if (bootPromise === null) {
    bootPromise = boot();
    const onSignal = (signal: NodeJS.Signals) => {
      ConsoleLogger.info(`[server.node] received ${signal}, shutting down`);
      void bootPromise?.then((b) => b.shutdown());
    };
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
  }
  return bootPromise;
}

export default defaultExport;
