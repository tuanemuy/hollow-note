"use client";

import { type ReactNode, type Usable, use, useDeferredValue } from "react";

/**
 * Resolves a deferred RSC payload (or any promise) on the client.
 *
 * Pair with `<Suspense fallback={...}>`: the route loader forwards the
 * `renderServerComponent(...)` promise WITHOUT awaiting it, so navigation
 * settles immediately and the unresolved leaf streams in under the fallback.
 * `use(promise)` suspends until the Flight payload arrives.
 *
 * The promise goes through `useDeferredValue` first. A background loader
 * re-run swaps `loaderData` wholesale for a fresh, still-unresolved promise,
 * and that store write reaches React through `useSyncExternalStore` — i.e. on
 * SyncLane — so a mounted `<Suspense>` would drop back to its skeleton.
 * Deferring keeps the previous payload on screen and re-renders the swap on a
 * transition lane, where suspending does not tear down visible content. On the
 * first mount there is no previous value, so the fallback still shows. Holding
 * the previous value assumes the swap is a same-URL re-fetch: a params-only
 * navigation reuses the mounted component, so the old payload would stay on
 * screen until the new one arrives unless that route sets `remountDeps` (no
 * note-to-note link exists today).
 *
 * This is the per-fragment streaming mechanism. For whole-route navigation
 * pending UI, use the router's `defaultPendingComponent` instead.
 */
export function Deferred<T extends ReactNode>({
  promise,
}: {
  promise: Usable<T>;
}): ReactNode {
  return use(useDeferredValue(promise));
}
