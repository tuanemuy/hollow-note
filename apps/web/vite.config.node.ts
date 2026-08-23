import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import rsc from "@vitejs/plugin-rsc";
import { defineConfig, loadEnv } from "vite";

const DEFAULT_APP_URL = "http://localhost:3000";

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL(".", import.meta.url));
  const env = loadEnv(mode, envDir, "");
  const appUrl = new URL(env.APP_URL || DEFAULT_APP_URL);
  const port = Number.parseInt(appUrl.port || "3000", 10);

  return {
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [
      tailwindcss(),
      tanstackStart({
        srcDirectory: "app",
        // Path is resolved relative to `srcDirectory`; an `app/` prefix
        // makes the plugin silently fall back to the default CF entry.
        server: { entry: "server.node.ts" },
        rsc: { enabled: true },
      }),
      rsc(),
      viteReact(),
    ],
    server: {
      port,
      strictPort: true,
      host: true,
      watch: {
        ignored: ["**/.direnv/**"],
      },
    },
  };
});
