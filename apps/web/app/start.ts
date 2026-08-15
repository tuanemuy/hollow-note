import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { appServerErrorAdapter } from "@/presentation/appServerErrorAdapter";

/**
 * Creating a Start instance replaces the framework's default
 * `requestMiddleware`, and the default is the CSRF middleware — so it has to
 * be re-registered here explicitly. Without it every server function accepts
 * `multipart/form-data` / `application/x-www-form-urlencoded` (both CORS
 * safelisted, so reachable from a cross-site `<form>` with no preflight),
 * which is what the CSRF rule in `spec/presentation/index.md` requires an
 * `Origin` check for.
 *
 * `createCsrfMiddleware` is server-only and folds to `undefined` in the
 * client bundle; only `serializationAdapters` is read there.
 */
export const startInstance = createStart(() => ({
  serializationAdapters: [appServerErrorAdapter],
  requestMiddleware: [
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
  ],
}));
