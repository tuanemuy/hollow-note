import { isNotFound, isRedirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import {
  AppServerError,
  httpStatusFor,
  isAppServerErrorShaped,
  redactForClient,
  serializeError,
} from "./errorResponse";
import { logServerError } from "./serverErrorLog";

// Wraps the entire server-function pipeline so throws from `validator`
// and the handler land in the same catch. Setting the response status from
// inside the handler alone would miss validator throws (they fire before
// `.handler` runs), and the constructor of `AppServerError` can't touch the
// server-only status setter directly. The `.server(...)` body is stripped
// from client bundles by the TanStack Start compiler, so importing
// `@tanstack/react-start/server` at module top-level is safe.
//
// This is the single redaction boundary for outbound errors: the raw
// serialized form is handed to the injected `Logger` for ops triage, and
// the client receives only `redactForClient(...)`. Logger output policy
// (console, structured JSON, sink, …) is owned by the implementation that
// the container injects — the middleware just forwards the raw payload.
export const errorResponseMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (isRedirect(error) || isNotFound(error)) throw error;

    // Structural check, not `instanceof` — the validator may throw an
    // `AppServerError` built in a sibling module graph (see
    // `isAppServerErrorShaped`).
    const rawSerialized = isAppServerErrorShaped(error)
      ? error.serialized
      : serializeError(error);

    if (rawSerialized.kind === "system" || rawSerialized.kind === "unknown") {
      await logServerError(error, rawSerialized);
    }

    const clientSerialized = redactForClient(rawSerialized);
    const appError = new AppServerError(clientSerialized);
    setResponseStatus(httpStatusFor(clientSerialized));
    throw appError;
  }
});
