import { getContainer } from "@repo/core/application/di/containerStore";
import type { SerializedError } from "./errorResponse";

// `containerStore` is client-graph safe (no node-only imports), so
// statically importing `getContainer` here doesn't pull `node:async_hooks`
// into client chunks. The fallback `console.error` only fires if
// container resolution or logger dispatch itself throws.
export async function logServerError(
  error: unknown,
  serialized: SerializedError,
): Promise<void> {
  try {
    const { logger } = await getContainer();
    logger.error("Server function failed", {
      kind: serialized.kind,
      code: serialized.code,
      message: serialized.message,
      cause: error,
    });
  } catch (logError) {
    console.error("Server function failed (logger unavailable)", {
      original: error,
      logError,
    });
  }
}
