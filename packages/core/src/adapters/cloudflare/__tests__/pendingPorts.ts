/**
 * Which Cloudflare ports do not exist yet, and what stands in for them.
 *
 * The conformance factory has to hand back a whole `ConformanceBackend`
 * from the first day, long before all 35 port implementations land. Rather
 * than stub the missing ones with something that quietly returns
 * plausible values — which would let a suite pass against nothing — each
 * one is a proxy that throws on every call, naming itself and the way
 * out. A red suite is then unambiguous: either the message says
 * "not implemented", or the adapter really does violate its contract.
 *
 * ## Turning a port on
 *
 * Two edits, both local to one bundle:
 *
 * 1. Delete the port's line from `PENDING_PORTS` below.
 * 2. Pass the real factory as the second argument of the matching
 *    `port(...)` call in `./ports/{bundle}.ts`.
 *
 * Doing (1) without (2) fails loudly at backend construction rather than
 * silently handing back a stub, so the pair cannot drift.
 */

const PORT_NOT_WIRED = (name: string): string =>
  `Cloudflare port "${name}" was removed from PENDING_PORTS but no factory is wired for it in __tests__/ports/. Pass the adapter factory as the second argument of port("${name}", …).`;

/**
 * Ports with no Cloudflare implementation yet. One name per line, so a
 * bundle's owner deletes only their own lines and six of them can work
 * in parallel without touching the same hunk.
 */
export const PENDING_PORTS: readonly string[] = [
  // Step 5 — D1 Identity
  "UserRepository",
  "IdentityRepository",
  "SessionRepository",
  "AuthTokenRepository",
  "IdentityRemovalReceiptStore",
  "UserBatchReader",
  "LoginAttemptStore",
  "OAuthStateStore",

  // Step 6 — D1 directory / operation
  "IdentityUniqueDirectory",
  "DistributedOperationStore",
  "AccountDeletionManifestStore",
  "GlobalMaintenanceRunStore",

  // Step 7 — D1 route / infrastructure / cross-plane
  "NoteRouteStore",
  "NoteRouteFanOutReader",
  "OutboxRepository",
  "IdempotencyStore",
  "ScopeRouter",
  "ScopeTaskQueue",

  // Step 8 — scope DO business
  "NoteRepository",
  "NoteRevisionRepository",
  "StoredFileRepository",
  "StorageQuotaRepository",
  "LlmUsageRepository",
  "AppliedOperationStore",

  // Step 9 — scope DO infrastructure
  "ScopeTaskScheduler",
  "ScopeCleanupAdmissionStore",

  // Step 10 — projection / search / R2
  "LocalNoteProjectionWriter",
  "NoteProjectionSnapshotReader",
  "NoteProjectionRevisionStore",
  "LocalNoteQueryService",
  "PublicNoteProjectionWriter",
  "PublicNoteQueryService",
  "ObjectStorage",
];

export const isPendingPort = (name: string): boolean =>
  PENDING_PORTS.includes(name);

/**
 * Stand-in for a port that has no implementation yet: every method
 * throws, naming the port, the method, and the one line to delete.
 *
 * `then` and symbol keys resolve to `undefined` so the object stays
 * inert when a test framework probes it for thenability or for a
 * custom inspection hook — probing must not be mistaken for a call.
 */
export function notImplementedPort<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, property): unknown {
      if (typeof property === "symbol" || property === "then") {
        return undefined;
      }
      return (): never => {
        throw new Error(
          `not implemented: ${name}.${property} — no Cloudflare adapter for this port yet (see PENDING_PORTS in __tests__/pendingPorts.ts)`,
        );
      };
    },
  });
}

/**
 * Resolves one port: the real adapter once its name has left
 * `PENDING_PORTS`, the throwing stand-in until then.
 */
export function port<T extends object>(name: string, build?: () => T): T {
  if (isPendingPort(name)) {
    return notImplementedPort<T>(name);
  }
  if (build === undefined) {
    throw new Error(PORT_NOT_WIRED(name));
  }
  return build();
}
