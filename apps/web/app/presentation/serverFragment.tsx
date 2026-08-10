import { isNotFound, isRedirect } from "@tanstack/react-router";
import { renderServerComponent } from "@tanstack/react-start/rsc";
import type { ReactNode } from "react";
import {
  AppServerError,
  extractSerializedError,
  redactForClient,
} from "./errorResponse";
import { logServerError } from "./serverErrorLog";

/**
 * Redaction boundary for streamed RSC fragments.
 *
 * `errorResponseMiddleware` covers throws that happen before the handler
 * returns, but a streaming handler returns an UNRESOLVED
 * `renderServerComponent(...)` promise — a fragment that rejects mid-stream
 * has already left the middleware behind, so its raw error (internal
 * message included) would be serialized straight onto the Flight wire and
 * never reach the server log. Rendering fragments through this wrapper
 * restores both halves of the contract: system/unknown errors are logged
 * server-side with their raw payload, and only the `redactForClient(...)`
 * form crosses to the client.
 *
 * The fragment root is invoked as a plain async function (not a child
 * element) because a parent server component cannot catch errors thrown by
 * its children — only by work it awaits itself.
 */
export function renderServerFragment(
  render: () => Promise<ReactNode> | ReactNode,
) {
  return renderServerComponent(<RedactionBoundary render={render} />);
}

async function RedactionBoundary({
  render,
}: {
  render: () => Promise<ReactNode> | ReactNode;
}): Promise<ReactNode> {
  try {
    return await render();
  } catch (error) {
    if (isRedirect(error) || isNotFound(error)) throw error;
    const rawSerialized = extractSerializedError(error);
    if (rawSerialized.kind === "system" || rawSerialized.kind === "unknown") {
      await logServerError(error, rawSerialized);
    }
    throw new AppServerError(redactForClient(rawSerialized));
  }
}
