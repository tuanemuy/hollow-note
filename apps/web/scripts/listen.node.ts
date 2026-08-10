// Loads the bundled server entry from `dist/server/server.node.js` and
// serves its fetch handler via `@hono/node-server`, with `dist/client`
// (vite's browser build) in front of it. Kept separate from
// `app/server.node.ts` so vite dev doesn't double-listen on a port —
// and because `vite dev` serves the client build itself, so the static
// layer below is production-only.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { config as loadEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../.env"), quiet: true });

type BuildLayout = Readonly<{ serverEntry: string; clientRoot: string }>;

const candidates: ReadonlyArray<BuildLayout> = [
  {
    serverEntry: path.resolve(here, "../dist/server/server.node.js"),
    clientRoot: path.resolve(here, "../dist/client"),
  },
  {
    serverEntry: path.resolve(here, "../server/server.node.js"),
    clientRoot: path.resolve(here, "../client"),
  },
  {
    serverEntry: path.resolve(process.cwd(), "dist/server/server.node.js"),
    clientRoot: path.resolve(process.cwd(), "dist/client"),
  },
];

type BootedServer = Readonly<{
  fetch: (request: Request) => Promise<Response>;
  port: number;
  hostname: string;
  shutdown: () => Promise<void>;
}>;

type BundledServerModule = Readonly<{
  boot: () => Promise<BootedServer>;
}>;

type LoadedBundle = Readonly<{
  module: BundledServerModule;
  layout: BuildLayout;
}>;

async function loadBundled(): Promise<LoadedBundle> {
  for (const layout of candidates) {
    try {
      const mod = (await import(
        pathToFileURL(layout.serverEntry).toString()
      )) as BundledServerModule | { default?: BundledServerModule };
      const resolved =
        "boot" in mod
          ? (mod as BundledServerModule)
          : (mod.default as BundledServerModule | undefined);
      if (resolved && typeof resolved.boot === "function") {
        return { module: resolved, layout };
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `[listen.node] could not locate the bundled server entry. Tried:\n  - ${candidates.map((c) => c.serverEntry).join("\n  - ")}\nDid you run \`pnpm build:node\`?`,
  );
}

const MIME_TYPES: ReadonlyMap<string, string> = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

// Vite content-hashes everything it writes under `assetsDir`, so those
// URLs are safe to pin forever; anything copied verbatim from `public/`
// keeps its name across deploys and must be revalidated.
const IMMUTABLE_PREFIX = "/assets/";

function resolveStaticFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const resolved = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function createStaticHandler(root: string) {
  return async (request: Request): Promise<Response | null> => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;

    const { pathname } = new URL(request.url);
    const filePath = resolveStaticFile(root, pathname);
    if (filePath === null) return null;

    const stats = await stat(filePath).catch(() => null);
    if (stats === null || !stats.isFile()) return null;

    const body = request.method === "HEAD" ? null : await readFile(filePath);
    return new Response(body, {
      headers: {
        "Content-Type":
          MIME_TYPES.get(path.extname(filePath).toLowerCase()) ??
          "application/octet-stream",
        "Content-Length": String(stats.size),
        "Cache-Control": pathname.startsWith(IMMUTABLE_PREFIX)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

async function main(): Promise<void> {
  const {
    module: { boot },
    layout,
  } = await loadBundled();
  const booted = await boot();

  const serveStatic = createStaticHandler(layout.clientRoot);
  const fetch = async (request: Request): Promise<Response> =>
    (await serveStatic(request)) ?? (await booted.fetch(request));

  const server = serve(
    {
      fetch,
      port: booted.port,
      hostname: booted.hostname,
    },
    (info) => {
      console.log(
        `[listen.node] listening on http://${info.address}:${info.port}`,
      );
    },
  );

  // These signal handlers run before `server.node.ts`'s own (which act
  // as a safety net) because `process.once` fires in registration order.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`[listen.node] received ${signal}, draining`);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await booted.shutdown();
    process.exit(0);
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((cause) => {
  console.error("[listen.node] failed to start", cause);
  process.exit(1);
});
