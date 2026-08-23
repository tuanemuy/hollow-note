# Frontend Implementation Example

Implementation example assuming TanStack Start (with React Server Components enabled). Every path and identifier below points at real code in `apps/web/`; the few patterns this repository does not (yet) use are marked as such where they appear.

Basic design principles:

- **Choose RSC with an awareness of its "owner".** An RSC is nothing more than a React Flight payload returned from `createServerFn`. Decide first where you call it from = who holds that payload.
- **Keep data fetching, authorization, and usecase invocation entirely inside server components.** Treat the loader as "a thin proxy for pulling a server component in as an RSC payload".
- **`throw` errors.** There is no need to convert them to status codes and return them via `data()`. Throwing `redirect({ to })` / `notFound()` lets the router pick them up, and any other exception falls back to the route's `errorComponent` (or the router-level default).
- **Carve out only the parts that need client state with `"use client"`.** Make only the parts that hold forms or interactions into client components.
- **When calling a server function from the client, wrap it with `useServerFn(fn)`.** This way, even when a handler does `throw redirect({ to })`, the router navigates automatically.

## RSC owner patterns

There are 4 ways to handle an RSC, distinguished by **who holds and invalidates the Flight payload**. The route loader is not the only correct answer.

### 1. Held by the route loader (the default in this template)

A fragment tied 1:1 to the URL. The router cache owns it and refetches it via `router.invalidate()`.

The smallest form `await`s the payload inside the bridge:

```tsx
// shape only — every route in this repository uses the streaming variant below
const renderFragment = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const { SomeFragment } = await import("@/components/some/SomeFragment");
    return { SomeFragment: await renderServerComponent(<SomeFragment />) };
  });

export const Route = createFileRoute("/some/")({
  // Cache the resolved RSC in prod so a revisit reuses it; keep `0` in DEV for HMR.
  // Freshness after a mutation is driven by an explicit `useRouter().invalidate()`,
  // not by re-running the loader on every navigation.
  staleTime: import.meta.env.DEV ? 0 : Number.POSITIVE_INFINITY,
  loader: () => renderFragment(),
  component: SomePage,
});
```

Since the route file also enters the client graph, do not statically import server-only DI or server components. Confine them to the `createServerFn` / dynamic-import side, and have the loader merely call that bridge.

**When to choose**: fragments uniquely determined by URL parameters, such as list and detail pages.

#### Streaming variant: defer the payload and show a skeleton

The awaited form above blocks navigation until the data is fully resolved (no fallback is ever shown). To make the shell appear instantly and stream the fragment in, have the bridge **return the unresolved promise** and let a client-side `<Suspense>` boundary render a skeleton until the React Flight payload arrives. **This is what every fragment route in this repository does** (`/notes`, `/notes/$noteId`, `/settings/auth`, `/settings/profile`, `/settings/usage`).

```tsx
// apps/web/app/routes/notes/-action.tsx
// bridge — resolve the session AND return the UNRESOLVED fragment promise
export const renderNoteList = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(
    validateInput(z.object({ redirect: z.string().min(1).max(REDIRECT_MAX_LENGTH) })),
  )
  .handler(async ({ data }) => {
    const [{ NoteList }, { requireSessionOrRedirect }] = await Promise.all([
      import("@/components/note/NoteList"),
      import("@/presentation/sessionGuard"),
    ]);
    // No session → throws `redirect({ to: "/signin", search: { redirect } })`.
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      user,
      NoteList: renderServerFragment(() => NoteList({ userId: user.userId })),
    };
  });
```

```tsx
// apps/web/app/routes/notes/index.tsx
// route — forward the inner promise, resolve it under <Suspense>
export const Route = createFileRoute("/notes/")({
  // MANDATORY once the loader carries the guard: `loader` (unlike `beforeLoad`)
  // is cache-gated, so without this the guard stops being re-evaluated per
  // navigation on any cached match. Function form, because `shouldReload: true`
  // fires a request on every hover; note that `cause !== "preload"` only filters
  // preloads of *cached* matches — a layout match that stays active across its
  // children (`/settings`) is preloaded with `cause: "stay"` and is not filtered.
  // The re-fetch runs in the background, so the navigation itself settles at
  // once; what keeps the resolved list from flashing back to the skeleton is
  // `Deferred` deferring the swap (see below), not the re-run being a
  // background one.
  shouldReload: ({ cause }) => cause !== "preload",
  // NoteList is still a Promise<ReactNode> — forwarded, never awaited.
  // `boundedRedirectSource` drops `location.href` for the default `/notes`
  // when it exceeds the ceiling the bridge's validator enforces — the return
  // path is discarded whole, never truncated — so a long query string cannot
  // turn the page into a 422.
  loader: ({ location }) =>
    renderNoteList({ data: { redirect: boundedRedirectSource(location.href) } }),
  component: NotesPage,
  errorComponent: () => <ServerErrorState />,
});

function NotesPage() {
  const { user, NoteList } = Route.useLoaderData();
  return (
    <AppShell displayName={user.displayName} avatarUrl={user.avatarUrl}>
      <Suspense fallback={<NoteListSkeleton />}>
        <Deferred promise={NoteList} />
      </Suspense>
    </AppShell>
  );
}
```

```tsx
// apps/web/app/components/ui/Deferred — generic, reusable client resolver
("use client");
export function Deferred<T extends ReactNode>({ promise }: { promise: Usable<T> }) {
  return use(useDeferredValue(promise));
}
```

`useDeferredValue` is what keeps a *successful* background re-run from tearing the list down. When the background loader completes, the router swaps `loaderData` wholesale for a fresh, still-unresolved fragment promise, and that store write reaches React through `useSyncExternalStore` — i.e. on SyncLane, regardless of the transition the router wrapped it in. A bare `use(promise)` would re-suspend on that urgent render and the already-mounted `<Suspense>` would drop back to its skeleton. Deferring holds the previous payload on screen and re-renders the swap on a transition lane, where suspending does not tear down visible content. On the first mount there is no previous value, so the skeleton still shows.

Note the wrapper the bridge calls: **`renderServerFragment`** (`apps/web/app/presentation/serverFragment.tsx`), not `renderServerComponent` directly. `errorResponseMiddleware` only covers throws that happen *before* the handler returns; a deferred fragment that rejects mid-stream has already left the middleware behind, so its raw error would be serialized straight onto the Flight wire and never reach the server log. `renderServerFragment` restores both halves: `system` / `unknown` errors are logged server-side with their raw payload, and only the `redactForClient(...)` form crosses to the client (`spec/adr/031-error-transport-across-rsc-boundary.md`). The fragment root is invoked as a plain async function rather than as a child element, because a parent server component can only catch errors from work it awaits itself.

**The authority on authorization is the handler side, never the route's `beforeLoad`** — a `beforeLoad` guard is reachable only through the router, while the bridge is callable directly, so a route guard can add a round trip but can never add a decision. Two shapes follow from that, chosen by where the guard and the fragment sit:

- **Guard and fragment in the same match** (`/notes`, `/notes/$noteId`): fold them together. The bridge resolves the session itself and throws `redirect({ to: "/signin", search: { redirect } })` when there is none, so the route drops its `beforeLoad` entirely — **one request, one leg**. The transition path arrives from the client, so it goes through `.validator(validateInput(...))` for shape/DoS and `safeRedirectPath` for value safety (open redirect).
- **Guard on a layout, fragment on its children** (`/settings`): these are separate matches and cannot be folded, so **parallelize** instead. Move the layout's guard from `beforeLoad` (run sequentially, match by match) to `loader` (run through `Promise.all`) and it fires alongside the children's fragment loaders — **two requests, one leg**.

Whenever a guard moves into a `loader`, pair it with `shouldReload` (see the comment in the snippet above). `beforeLoad` runs on every navigation unconditionally; `loader` is gated by `staleTime` and by the match surviving the navigation, so without `shouldReload` the guard silently stops being re-evaluated — on any match served from the cache, and in every environment for a layout match that stays alive across its children. Once `shouldReload` is present, do **not** also declare `staleTime` / `preloadStaleTime`: `shouldReload ?? staleMatchShouldReload` never falls through to the right-hand side, so both become dead configuration that the next reader will take for a live setting. That is why neither appears on the routes above.

A layout guard needs one more thing that a folded route does not: the **object form** of `loader`, with `staleReloadMode: "blocking"` (`apps/web/app/routes/settings/route.tsx`). A re-run that the router treats as non-blocking is detached into a background branch whose `catch` navigates on a redirect without checking whether the load was a preload — so with the function form, merely hovering a `/settings` tab while signed out navigates the user away. `staleReloadMode` is read only off the object form; the function form is treated as `undefined`.

A folded bridge has exactly one answer for a session it cannot resolve: `redirect`. `authenticateSession` collapses every reason — no cookie, expired session, superseded `authEpoch`, a subject being deleted or already deleted — into a single `ValidationError("UNAUTHENTICATED")`, and `sessionUserOrNull` turns exactly that code into `null` (anything else — a genuine infrastructure failure — still throws). 401 survives only where the caller is not a navigation and so has nowhere to redirect to: mutations that call `requireSession()` directly, and the `/settings` child fragments (`apps/web/app/routes/settings/-action.tsx`).

The skeleton (`apps/web/app/components/ui/Skeleton` for the generic bar, `apps/web/app/components/note/NoteListSkeleton` shaped to `NoteList`'s DOM, plus `NoteDetailSkeleton` / `IdentityListSkeleton` / `ProfileFormSkeleton` / `UsagePanelSkeleton`) carries one `role="status"` announcement; the individual bars are `aria-hidden` and respect `prefers-reduced-motion` via `motion-reduce:animate-none`.

This is the **per-fragment** loading mechanism, and it does not replace the router's navigation pending UI (`defaultPendingComponent` = `RoutePendingFallback`, with `defaultPendingMs` / `defaultPendingMinMs`, in `apps/web/app/router.tsx`). The two cover different legs of the same navigation and run in series: the loader still blocks for the one round trip that resolves the guard and returns the shell, and `defaultPendingComponent` is what covers that leg once it passes `defaultPendingMs`; the skeleton then covers the fragment streaming in afterwards. `/notes` and `/settings/*` are the same shape here — neither settles its loader without that round trip.

### 2. Held by TanStack Query

For widgets that are not route-shaped, or when you want to invalidate independently. `structuralSharing: false` is mandatory when putting RSC values into Query.

> **Current status**: not adopted. `@tanstack/react-query` is not a dependency of `@repo/web`, so the snippet below is a reference shape, not a file in this repository.

```tsx
const getPostRsc = createServerFn({ method: "GET" })
  .validator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    const post = await loadPost(data.postId);
    const src = await createCompositeComponent<{
      renderActions?: (args: { postId: string }) => ReactNode;
    }>((props) => (
      <article>
        <h1>{post.title}</h1>
        <footer>{props.renderActions?.({ postId: post.id })}</footer>
      </article>
    ));
    return { src };
  });

const postQueryOptions = (postId: string) => ({
  queryKey: ["post-rsc", postId],
  structuralSharing: false, // mandatory when putting RSC values into Query
  queryFn: () => getPostRsc({ data: { postId } }),
  staleTime: 5 * 60 * 1000,
});

function PostPage() {
  const { postId } = Route.useParams();
  const { data } = useSuspenseQuery(postQueryOptions(postId));
  return <CompositeComponent src={data.src} />;
}
```

**When to choose**: widgets you want to reuse across multiple routes, refetch in the background, or keep alive across routes.

### 3. Call directly from an event handler

Load an RSC triggered by a user action and push it into state.

> **Current status**: no fragment is loaded this way yet. The closest real code is `apps/web/app/components/note/CreateNoteButton/index.tsx`, which calls a **mutation** from an event handler inside `useTransition` and then navigates; the shape below is the read-side counterpart.

```tsx
"use client";

import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getActivityFragment } from "./action";

export function LoadMoreButton({ userId }: { userId: string }) {
  const loadFragment = useServerFn(getActivityFragment);
  const [fragment, setFragment] = useState<ReactNode>(null);

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const { Rendered } = await loadFragment({ data: { userId } });
          setFragment(Rendered);
        }}
      >
        Load more
      </button>
      {fragment}
    </>
  );
}
```

**When to choose**: when you don't want it included in the initial load and want to fetch it incrementally on user action.

### 4. Composite Component (embedding client slots)

> **Current status**: not adopted. Every screen so far is complete with a loader + a server component + an ordinary `"use client"` island — `NoteList` / `NoteDetail` render read-only markup, and the interactive parts (`IdentityBoard`, `ProfileEditor`, `CreateNoteButton`) are whole client components the server component renders as children. It is kept as a reference pattern for when you eventually need to inject client interactivity *into the middle of* server-rendered markup.

Use this when you want to inject client interactivity into server-rendered markup. Three kinds of slots are available: `children`, a render prop, and a component prop.

```tsx
// server side
import { createCompositeComponent } from "@tanstack/react-start/rsc";

const getPostCard = createServerFn({ method: "GET" })
  .validator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    const post = await loadPost(data.postId);
    const src = await createCompositeComponent<{
      renderActions?: (args: { postId: string }) => ReactNode;
    }>((props) => (
      <article>
        <h1>{post.title}</h1>
        <p>{post.body}</p>
        <footer>{props.renderActions?.({ postId: post.id })}</footer>
      </article>
    ));
    return { src };
  });
```

```tsx
// client side
import { CompositeComponent } from "@tanstack/react-start/rsc";

<CompositeComponent
  src={src}
  renderActions={({ postId }) => <LikeButton postId={postId} />}
/>;
```

**When to choose**: when you want to inject a client UI such as a "like button" into server-rendered output. When you find yourself wanting to peek into a server slot with `Children.map` / `cloneElement`, convert it to a render prop.

### Selection flow

| Condition | What to choose |
|---|---|
| Tied 1:1 to the URL | **loader** |
| Used across routes / independent invalidate | **Query** |
| Don't want it in the initial load, triggered by user action | **Direct call from an event handler** |
| Want to mix a client UI into server markup | **Composite Component** |
| Want immediate add/remove of list elements | **Client-owned** (below) |

**Bad pattern**: "dual ownership" where the same RSC is fetched by both the loader and Query and only one is invalidated.

### Held by the client (optimistic list updates)

A loader-owned RSC list can reflect within-element state immediately via `useOptimistic`, but **operations that change membership, such as add/remove, are changes to parent state**, so an item-local `useOptimistic` cannot reach them. Carve the list out into a `"use client"` island and own the entire list array with `useOptimistic(items, reducer)`, seeded by the server value the loader returns.

**Who calls the server function is determined by "the kind of operation"**:

- In-item operations (an inline field edit, a per-item toggle) have the leaf call the server function itself. Since membership doesn't change and the leaf survives, the item-local `useOptimistic` and error display can also live in the leaf. Example: the avatar in `apps/web/app/components/settings/ProfileForm/editor.tsx` — one `useOptimistic` over `profile.avatarUrl`, one `useTransition`, and its own `avatarError` state.
- Operations that change membership (add / remove) have the owner (the island) call the server function. In particular, **delete must be called by the owner**: with optimistic deletion the leaf unmounts before the request settles, so the error UI placed in the leaf would be discarded. Add is dispatched from the form's action (the form lives outside the list and survives the round trip).

Every operation calls `router.invalidate()` once it settles, and the optimistic list is re-based onto the refetched latest value (it reverts automatically on failure). Example: `apps/web/app/components/settings/IdentityList/board.tsx` (`IdentityBoard`) — `useOptimistic(identities, applyOptimistic)` with a `{ kind: "remove" } | { kind: "addPassword" }` action, the `MethodRow` leaves holding no server function of their own, and password change / sign-out-other-sessions living in their own leaves because they don't change the list.

One consequence worth copying: derived state has to be recomputed from the **optimistic** list, not from the server value. `IdentityBoard` recomputes `canRemove` from `optimistic.length` because the server's `removable` flag describes the set *before* the removal, and reading it directly would keep offering "remove" on the last remaining sign-in method for one frame.

**When to choose**: when you want to reflect additions/removals to a list within the page immediately. Keeping it loader-owned forces add/remove to always wait on a server round trip, making it feel sluggish.

## Canonical form of the server-only entry point

The template standard is to access usecase invocation on the server **via the helpers in `apps/web/app/presentation/serverAction.ts`**. Calling `getContainer()` directly does technically work, but in this template we consolidate on the helpers.

### The 2 helpers provided

| helper | Purpose |
|---|---|
| `serverData(loadModule, run)` | **Reads** from server components / loaders |
| `loadServerDeps(loadModule)` | Loads the DI + usecase module in parallel inside a server function handler |

Both run `getContainer()` and the **dynamic import** of the usecase module (see the JSDoc in `serverAction.ts` for the reason) in parallel.

### Declare the server function itself **inline** at the call site

A server function (mutation / GET loader bridge) must **always have the chain from `createServerFn(...)` through `.handler(...)` written directly at the call site**. Pre-applying common middleware in a separate module and exporting it is **NG**.

```ts
// ✅ correct — complete the chain at the call site
// apps/web/app/components/note/CreateNoteButton/action.ts
export const createBlankNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/createBlankNote"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const view = await module.createBlankNote({
      container,
      input: { userId: user.userId, ownerType: "user" },
    });
    return { noteId: view.noteId };
  });

// ❌ NG — importing a pre-built builder from a separate module
// breaks the build because TanStack Start's RSC plugin can't trace the chain root.
import { defineServerFn } from "@/presentation/serverFn";
export const createBlankNoteFn = defineServerFn.handler(/* ... */);
```

TanStack Start's RSC plugin separates the handler body into the RSC environment on the premise that **a literal `createServerFn(...)` call exists within the same module**. If you start the chain through a re-export, static analysis fails and the build falls over with `Errored while resolving ... Got Plugin driver is already dropped` (verified on real hardware). A bit of duplication (writing `.middleware([...])` with `errorResponseMiddleware` every time) is acceptable.

One registration detail that follows from the same static analysis: a server function reachable **only** from a `"use client"` component misses the RSC manifest, which is frozen before the client build phase. `apps/web/app/routes/__root.tsx` pulls those provider modules in with bare `import "@/components/.../action";` lines so they get registered.

### Division of transport-validation responsibility (serverData vs serverAction)

The fact that `serverData` **does not take a schema** is a deliberate design choice: it declares in the type signature "the precondition that the caller has already passed the transport boundary". In other words, the following usage split is the convention in this template:

| Input source | Validation point | wrapper |
|---|---|---|
| URL search params | route's `validateSearch: schema.parse` | `serverData` (receives the value trusting the type) |
| Forwarding from a parent server fn | parent fn's `.validator(schema)` | `serverData` (receives the value trusting the type) |
| Direct POST from the client | server fn's `.validator(validateInput(schema))` | `loadServerDeps` |

> **Convention**: `serverData` is **for internal calls only**. Any place that handles external input (URL / form / fetch) must **always finish transport validation with either `validateSearch` or a server function's `.validator(...)` before** passing arguments to a loader via `serverData`. Do not run Zod again right before the usecase (the VO factory re-validates the same constraints, so it would be a duplicate and would diverge from CLAUDE.md's "validate at the boundaries").

Example: `apps/web/app/routes/notes/$noteId.tsx` takes `noteId` from the path, `renderNoteDetail` (the bridge in `apps/web/app/routes/notes/-action.tsx`) re-validates the transport with `.validator(validateInput(noteDetailInputSchema))` → passes a typed value to the server component `NoteDetail`, and `loadNote(noteId, userId)` (wrapped with `cache(serverData(...))` in `components/note/NoteDetail/action.ts`) **merely trusts** that type. Of the three stages, validation is confined to **the transport boundary**, and the internal `serverData` is a noop.

The URL-search row of the table has its base ready but no consumer yet: `apps/web/app/presentation/pagination.ts` exports `paginationSearchSchema` (for a route's `validateSearch`, with `z.coerce` + `.catch(default)` so a hand-typed `?page=abc` never errors the route) and `paginationSchema` (strict numeric, for a server function's `.validator`), both `.pipe(...)`-derived from the same field-level validators so the ceilings cannot drift between a route and a server function. The first paginated screen wires it as `validateSearch: paginationSearchSchema.parse` → `.validator(validateInput(paginationSchema))` → `serverData`.

### Exception where reaching the container directly is allowed

A helper that **just hits a specific port** and needs no usecase module may reach `application/di/containerStore` directly without going through a wrapper. The real cases are `apps/web/app/presentation/serverErrorLog.ts` (reads `container.logger`), `apps/web/app/routes/storage.$.tsx` (`container.objectStorage`), `apps/web/app/routes/settings/-action.tsx` and `apps/web/app/routes/dev/-action.tsx` (`container.config.appUrl` / `container.oauthDevMode`, alongside their own usecase work), and `apps/web/app/presentation/appConfig.ts` (`container.config`, for the router context).

What keeps the server graph out of the client bundle here is the **dynamic import**: every one of those call sites reaches the store through `await import("@repo/core/application/di/containerStore")` inside the function that needs it, never a static top-level import. Two of them are shaped differently:

- `serverErrorLog.ts` is the one static import, and it is deliberate — `containerStore` itself pulls in no node-only module, and that file is only ever reached from server-side error paths.
- `appConfig.ts` is not a handler at all: the dynamic import sits inside `createIsomorphicFn().server(...)`, whose body is dropped from the client build. It also calls `getInstalledStore()?.getStore()?.config` rather than `getContainer()`, which throws when there is no request scope. No request reaches `getRouter()` outside one today — `apps/web/app/server.node.ts` wraps every request in `storage.run(container, ...)`, which is exactly why `storage.$.tsx` above can call `getContainer()` from inside a server route. The tolerant read is insurance for the day a prerender or SPA-shell pass builds the router with no request behind it, so that a config lookup cannot turn an unrelated file response into a 500. Note how many call sites that covers: the framework builds the router for every document request, for every server route (`handleServerRoutes`), **and** in `handleRedirectResponse` — so every `redirect` thrown by the folded `/notes` bridge builds a router tree and resolves the config too.

Where usecase invocation enters, switch over to going through `serverData` / `loadServerDeps` and graduate from this.

## Server component (with data fetching)

The server component itself is an `async` function that calls a loader wrapped with `serverData`. React's `cache()` suppresses duplicate data fetching within the same request.

```tsx
// apps/web/app/components/note/NoteDetail/action.ts

import { cache } from "react";
import { serverData } from "@/presentation/serverAction";

export const loadNote = cache(
  serverData(
    () => import("@repo/core/application/note/getNote"),
    ({ container }, { getNote }, noteId: string, userId: string) =>
      getNote({ container, input: { noteId, userId } }),
  ),
);
```

```tsx
// apps/web/app/components/note/NoteDetail/index.tsx (server component)

import type { NoteDetailView } from "@repo/core/application/note/view";
import { NotFoundState } from "@/components/ui/ErrorState";
import { serializeError } from "@/presentation/errorResponse";
import { NoteBody } from "../NoteBody";
import { loadNote } from "./action";

export async function NoteDetail({
  noteId,
  userId,
}: {
  noteId: string;
  userId: string;
}) {
  // The not-found verdict is resolved inside the fragment: an error
  // thrown here would cross the Flight stream as a plain Error and lose
  // its kind tag before the route error boundary could classify it.
  // Anything that is not the access verdict stays thrown (generic retry).
  let note: NoteDetailView;
  try {
    note = await loadNote(noteId, userId);
  } catch (error) {
    if (serializeError(error).kind === "notFound") {
      return <NotFoundState />;
    }
    throw error;
  }

  return (
    <main>
      <h1>{note.title}</h1>
      <NoteContentBlock note={note} />
    </main>
  );
}
```

### Points

- Because we `await` inside the server component, there is no need to assemble the data in the loader.
- For exception mapping after authentication/existence checks, `try/catch` is sufficient. Note the streaming twist above: inside a **deferred** fragment, rendering the terminal state (`<NotFoundState />`) is more reliable than `throw notFound()`, because the route's `notFoundComponent` sits outside the Flight stream the fragment is being written into.
- **The dedupe scope of `cache()` is the same request + the same arguments**. Calling `loadNote(id, userId)` multiple times within the same RSC tree executes only once, and a different `id` is evaluated independently with a separate cache. A loader called from more than one place should be wrapped with `cache(serverData(...))` and reached through **the same function reference** (e.g. `loadNotes` in `apps/web/app/components/note/NoteList/action.ts`, `loadIdentities` in `apps/web/app/components/settings/IdentityList/action.ts`).
- Consolidate the DI / module loading for usecase invocation on the `serverData` wrapper. Calling `getContainer()` directly means each call site has to own the dynamic-import discipline itself, and the moment someone adds a single static import line, the server graph risks leaking into the client; the wrapper's dynamic import structurally blocks this.

## Route definition (a thin proxy that pulls in an RSC)

The route's only responsibility is "pass URL parameters to the server component and send the rendered result to the client as an RSC payload".

```tsx
// apps/web/app/routes/notes/-action.tsx

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { REDIRECT_MAX_LENGTH } from "@/presentation/redirect";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

const noteDetailInputSchema = z.object({
  noteId: z.string().min(1).max(128),
  // The path to return to after signing in. A transport-boundary input, so it
  // is bounded here — the same `REDIRECT_MAX_LENGTH` the loader's
  // `boundedRedirectSource` measures against — and passed through
  // `safeRedirectPath` on the server side.
  redirect: z.string().min(1).max(REDIRECT_MAX_LENGTH),
});

export const renderNoteDetail = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(noteDetailInputSchema))
  .handler(async ({ data }) => {
    const [{ NoteDetail }, { requireSessionOrRedirect }] = await Promise.all([
      import("@/components/note/NoteDetail"),
      import("@/presentation/sessionGuard"),
    ]);
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      NoteDetail: renderServerFragment(() =>
        NoteDetail({ noteId: data.noteId, userId: user.userId }),
      ),
    };
  });
```

```tsx
// apps/web/app/routes/notes/$noteId.tsx

export const Route = createFileRoute("/notes/$noteId")({
  // The loader carries the guard, so keep it running per navigation.
  // No `staleTime` alongside it — it would never be consulted.
  shouldReload: ({ cause }) => cause !== "preload",
  loader: ({ params, location }) =>
    renderNoteDetail({
      data: {
        noteId: params.noteId,
        redirect: boundedRedirectSource(location.href),
      },
    }),
  head: ({ match }) => {
    const config = match.context?.config;
    if (!config) return {};
    const { meta, links } = buildHead(config, {
      title: `ノート — ${config.siteName}`,
      path: `/notes/${match.params.noteId}`,
    });
    return { meta, links };
  },
  component: NoteDetailPage,
  errorComponent: ({ error }) => {
    const serialized = extractSerializedError(error);
    return serialized.kind === "notFound" ? (
      <ReaderShell><NotFoundState /></ReaderShell>
    ) : (
      <ReaderShell><ServerErrorState /></ReaderShell>
    );
  },
});

function NoteDetailPage() {
  const { NoteDetail } = Route.useLoaderData();
  return (
    <ReaderShell>
      <Suspense fallback={<NoteDetailSkeleton />}>
        <Deferred promise={NoteDetail} />
      </Suspense>
    </ReaderShell>
  );
}
```

### Points

- The loader merely calls the server function bridge. Confine `renderServerFragment(...)` and server-only imports to the bridge's handler side.
- **Place the shared shell (Header / tab strip / Dialog mount, etc.) in the route `component` — for a group of screens, in the parent route's `component`. Do not include the shell in the fragment the bridge renders.** If you do, the shell gets swapped out along with the entire RSC tree and remounted on every transition, and client state such as menu open/close is lost and flickers. Pass only leaf-specific content into the RSC payload. Reference implementations: `apps/web/app/routes/settings/route.tsx` holds `AppShell` + `SettingsTabs` for all of `/settings/*` while `auth.tsx` / `profile.tsx` / `usage.tsx` contribute only their fragment; `apps/web/app/routes/notes/index.tsx` wraps its own `AppShell`; `apps/web/app/routes/notes/$noteId.tsx` defines a local `ReaderShell` and — this is the part that matters — reuses it in `errorComponent` too, so a failure keeps the shell instead of dropping the reader onto a bare page.
- Since `staleTime` remains in effect even after navigation, the cache can be reused when you return to the same URL — **unless the route declares `shouldReload`**, which takes precedence over `staleTime` / `preloadStaleTime` entirely. Routes whose loader carries an auth guard are in the second group.
- When you want to force a refetch, use `useRouter().invalidate()` on the client.
- Input validation uses **`.validator(...)`**. The `input`-prefixed alias from older TanStack Start releases is deprecated and is not used anywhere in this repository.

## Shared server logic (authentication helper)

Authentication retrieval used by multiple server functions is carved out as a function in the presentation layer. `apps/web/app/presentation/session.ts` owns the session cookie and resolves the user behind it; it is a **server-only module**, so every consumer reaches it through a dynamic `import("@/presentation/session")` inside a handler, which keeps `@tanstack/react-start/server` out of every client graph.

```typescript
// apps/web/app/presentation/session.ts (excerpt)

export function readSessionToken(): string | null {
  const value = getCookie(SESSION_COOKIE_NAME);
  return value !== undefined && value !== "" ? value : null;
}

/**
 * Resolves the authenticated user behind the session cookie, or throws
 * `ValidationError("UNAUTHENTICATED")` (→ 401 at the boundary). Purely
 * read-only: an invalid cookie is left in place — clearing it here would
 * make a GET path mutate auth state.
 */
export async function requireSession() {
  const token = readSessionToken();
  const { container, module } = await loadServerDeps(
    () => import("@repo/core/application/identity/authenticateSession"),
  );
  if (token === null) {
    const { ValidationError } = await import("@repo/core/application/errors");
    throw new ValidationError("UNAUTHENTICATED", "Not authenticated");
  }
  return module.authenticateSession({
    container,
    input: { sessionToken: token },
  });
}

/** Like `requireSession` but resolves to `null` when unauthenticated. */
export async function sessionUserOrNull() { /* ... */ }
```

Guards need the *other* shape — a redirect, not a 401 — and that is a routing decision, not cookie transport. The modules split along exactly that line, so reach for the one that matches what you need:

| Module | Role | Exports |
|---|---|---|
| `presentation/session.ts` | Cookie transport: read / write the session cookie and resolve the user behind it | `requireSession` (throws → 401), `sessionUserOrNull` (`null` when unauthenticated) |
| `presentation/auth.ts` | Session **probe** that a route may call — the only one that enters a client graph, hence a server function | `sessionUserFn` |
| `presentation/sessionGuard.ts` | The **redirect decision**: no session → `/signin`, carrying the path to return to | `requireSessionOrRedirect` |
| `presentation/redirect.ts` | Pure functions the decision is made of — no framework import, so unit tests reach them without the server-function runtime | `REDIRECT_MAX_LENGTH` (the transport ceiling both the bridge's validator and `/signin`'s `validateSearch` import), `safeRedirectPath`, `signInRedirectOptions`, `boundedRedirectSource` |

```typescript
// apps/web/app/presentation/sessionGuard.ts

export async function requireSessionOrRedirect(redirectTo: string) {
  const { sessionUserOrNull } = await import("./session");
  const user = await sessionUserOrNull();
  if (user === null) {
    // The options are assembled by a pure function that always runs
    // `safeRedirectPath` over a value that came off the wire — the predicate
    // itself lives in the domain (`SameOriginPolicy.isSameOriginPath`) and
    // only the fallback destination is decided here. Assembling them there
    // rather than inline is what lets a unit test pin the guard's behaviour.
    throw redirect(signInRedirectOptions(redirectTo));
  }
  return user;
}
```

Instead of using `createMiddleware`, aligning on simple helpers pairs better with RSC. Which helper a screen uses follows the two shapes described under the streaming variant: a bridge that owns both the guard and the fragment calls `requireSessionOrRedirect` and needs no route guard at all, while a layout that guards children owning their own fragments calls `sessionUserFn` from its `loader` (plus `shouldReload`) so the guard runs in parallel with them. `requireSession` stays the in-handler check for mutations, where there is no navigation to redirect.

## Server Function (mutation)

Consolidate state-changing operations into `createServerFn({ method: "POST" })`. For reads, use `createServerFn({ method: "GET" })`, expressing whether there are side effects via the method. For both, always prepend `.middleware([errorResponseMiddleware])`, and have the same middleware catch throws from **both** `validator` and the handler and convert them into the `AppServerError` envelope and an HTTP status. The client wraps it with `useServerFn(fn)` and then passes it directly to React 19's **`useActionState` / `useTransition` / `useOptimistic`**. A generic hook (a `useServerAction`-style wrapper) is intentionally not provided — abstract only when a second concrete pattern appears.

Same-origin enforcement is not the individual handler's job: `apps/web/app/start.ts` registers `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })` as the app's `requestMiddleware`, and it runs before any handler. This has to be explicit — creating a Start instance **replaces** the framework's default `requestMiddleware`, and the default *is* the CSRF middleware. Without it every server function would accept `multipart/form-data` / `application/x-www-form-urlencoded` (both CORS-safelisted, so reachable from a cross-site `<form>` with no preflight). That is what lets `uploadAvatarFn` take a `FormData` body without hand-rolling an `Origin` check.

### Division of input-validation responsibility

Input validation happens in **only 2 places**. The usecase is not involved.

| Layer | Responsibility |
|---|---|
| Transport boundary (`.validator`) | shape / DoS check. Only whether the JSON matches the expected signature |
| Domain VO factory (`NoteTitle.create`, `Handle.create`, …) | The final gate for business invariants |

The usecase **trusts the static type of the input and focuses on applying domain logic**. When the VO factory throws a `BusinessRuleError`, it reaches the client as-is in the envelope (`{ kind: "business" }`).

Why not run Zod in the usecase:

- The VO factory re-validates the same constraints, so it would be a duplicate.
- Placing validation in the usecase mixes Zod / domain modules into the application layer, creating friction with CLAUDE.md's dependency direction (application → domain).
- Shape checking is the transport's responsibility. Once it arrives as a type, the usecase may trust it.

Because `createServerFn`'s `validator` runs on both client and server, the schema statically imported from it **must not pull in `@repo/core/domain/*` or `@repo/core/application/*`** beyond plain constants. Keep the schema presentation-independent in `apps/web/app/components/${domain}/schema.ts`.

```typescript
// apps/web/app/components/auth/schema.ts
import { PASSWORD_MAX_LENGTH } from "@repo/core/domain/identity/valueObject";
import { z } from "zod";

// Transport-boundary schemas — shape / DoS checks only. Business
// invariants (letter+digit rule, reserved handles, …) live in the
// domain value objects; this module stays importable from client code.
export const EMAIL_MAX_LENGTH = 254;
export const DISPLAY_NAME_MAX_LENGTH = 50;

export const signUpSchema = z.object({
  email: z.string().trim().min(1).max(EMAIL_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  termsAccepted: z.boolean(),
});
```

```typescript
// apps/web/app/presentation/validator.ts
import { CodedError, type FieldErrors } from "@repo/core/lib/error";
import type { ZodType, z } from "zod";
import {
  AppServerError,
  type SerializedValidationError,
} from "./errorResponse";

class InputValidationError extends CodedError {
  override readonly name = "InputValidationError";

  constructor(public readonly fieldErrors: FieldErrors) {
    super("INVALID_INPUT", "Invalid input");
  }

  override toSerialized(): SerializedValidationError {
    return {
      kind: "validation",
      code: this.code,
      message: this.message,
      retryable: false,
      fieldErrors: this.fieldErrors,
    };
  }
}

export function validateInput<T extends ZodType>(schema: T) {
  return (input: unknown): z.infer<T> => {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;
    const error = new InputValidationError(
      zodIssuesToFieldErrors(parsed.error.issues),
    );
    throw new AppServerError(error.toSerialized());
  };
}
```

```typescript
// apps/web/app/components/auth/SignUpForm/action.ts
import { createServerFn } from "@tanstack/react-start";

import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";
import { signUpSchema } from "../schema";

export const signUpFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(signUpSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, session] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/identity/signUpWithPassword"),
      ),
      import("@/presentation/session"),
    ]);
    const view = await module.signUpWithPassword({
      container,
      input: {
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        termsAccepted: data.termsAccepted,
      },
    });
    session.setPendingVerificationCookie(view.userId, container.clock.now());
    return { emailVerificationRequired: view.emailVerificationRequired };
  });
```

The subject of a mutation is the session, never the request body: none of `updateProfileFn` / `addPasswordFn` / `removeIdentityFn` / `uploadAvatarFn` in `apps/web/app/routes/settings/-action.tsx` accepts a `userId` field, because a transport-supplied identifier would be a path to editing somebody else's settings.

### Form submission uses `useActionState`

`<form action={formAction}>` + `useActionState` is the canonical React 19 approach. Fold `SerializedError | null` into the state, and branch on `kind` when a specific field needs the message.

```tsx
// apps/web/app/components/auth/SignUpForm/index.tsx (excerpt)
"use client";

import { useServerFn } from "@tanstack/react-start";
import { useActionState, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { displayError } from "@/presentation/errorDisplay";
import {
  extractSerializedError,
  type SerializedError,
} from "@/presentation/errorResponse";
import { signUpFn } from "./action";

type FormState = { error: SerializedError | null; done: boolean };

export function SignUpForm() {
  const signUp = useServerFn(signUpFn);
  const [fields, setFields] = useState<Fields>(initialFields);
  const doneHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (prev) => {
      try {
        await signUp({ data: { ...fields } });
        return { error: null, done: true };
      } catch (error) {
        return { error: extractSerializedError(error), done: prev.done };
      }
    },
    { error: null, done: false },
  );

  // The completion panel replaces the whole form, so the submit button that
  // had focus unmounts and focus falls to `<body>`. Screen-reader users would
  // hear nothing at all; moving focus to the new heading announces it and
  // keeps the next Tab in the right place (a live region can't do that here,
  // because the announcing container unmounts along with the form).
  useEffect(() => {
    if (state.done) doneHeadingRef.current?.focus();
  }, [state.done]);

  if (state.done) {
    return <h1 ref={doneHeadingRef} tabIndex={-1}>確認メールを送信しました</h1>;
  }

  return (
    <div>
      {state.error !== null ? (
        <Alert tone="error" title="登録できませんでした">
          {displayError(state.error)}
        </Alert>
      ) : null}
      <form action={formAction} noValidate>
        {/* fields … */}
        <button type="submit" disabled={isPending || hasFieldError}>
          {isPending ? "送信中..." : "アカウントを作る"}
        </button>
      </form>
    </div>
  );
}
```

Where a validation failure belongs to one specific field, keep the routing decision in the state rather than in the render: `apps/web/app/components/settings/ProfileForm/editor.tsx` stores `{ target: "handle" | "form", handle, message, suggestions }` so that a `HANDLE_ALREADY_USED` lands on the handle input with `aria-invalid`, while an expired session lands in the save bar's live region — and so that the message stops applying the moment the user edits the handle it was about (`useActionState` keeps the previous result until the next submit).

### Inline actions use `useTransition` + `useOptimistic`

For **immediate actions outside a form**, such as picking a new avatar or a delete button in a list, take a transition with `useTransition` and overlay `useOptimistic` on state the item owns. It is a necessary condition that the `useOptimistic` setter be called **from within a transition**.

```tsx
// apps/web/app/components/settings/ProfileForm/editor.tsx (excerpt)
"use client";

const [avatarUrl, setAvatarUrl] = useOptimistic(
  profile.avatarUrl,
  (_current: string | null, next: string | null) => next,
);
const [isAvatarPending, startAvatarTransition] = useTransition();
const [avatarError, setAvatarError] = useState<string | null>(null);

const onPickFile = (file: File) => {
  if (file.size > AVATAR_MAX_BYTES) {
    setAvatarError(OVERSIZE_MESSAGE);
    return;
  }
  const preview = URL.createObjectURL(file);
  startAvatarTransition(async () => {
    setAvatarUrl(preview);
    try {
      const body = new FormData();
      body.set("file", file);
      const { url } = await uploadAvatar({ data: body });
      // Second leg. Only after this does the avatar stick to the profile.
      await updateProfile({ data: { avatarUrl: url } });
    } catch (error) {
      setAvatarError(displayError(error));
      URL.revokeObjectURL(preview);
      return;
    }
    setAvatarError(null);
    await reconcile(); // router.invalidate()
    URL.revokeObjectURL(preview);
  });
};
```

Two things this leaf-owned example fixes in place: the optimistic value is a local `blob:` preview that is revoked on both paths, and the *pre-flight* size check reads its threshold and its message from the same domain source as the server-side verdict (`AVATAR_MAX_BYTES` / `StorageErrorCode.FileTooLarge`), so raising the domain limit moves both at once. The format check is deliberately **not** mirrored on the client — acceptance is decided from the byte signature, so `accept` is only a picker hint.

The membership-changing counterpart lives in the owner, not the leaf:

```tsx
// apps/web/app/components/settings/IdentityList/board.tsx (excerpt)
const [optimistic, dispatchOptimistic] = useOptimistic(
  identities,
  applyOptimistic,
);
const [isRemoving, startRemoving] = useTransition();

const onRemove = (identityId: string) => {
  setConfirming(null);
  startRemoving(async () => {
    setNotice(null);
    dispatchOptimistic({ kind: "remove", identityId });
    try {
      await removeIdentity({ data: { identityId } });
    } catch (error) {
      setListError(displayError(error));
      return;
    }
    setListError(null);
    setNotice("ログイン方法を解除しました。");
    // The "remove" button that had focus disappears with its row, so focus
    // has to be handed to the list heading or it falls to `document.body`.
    headingRef.current?.focus();
    await reconcile();
  });
};
```

### Failures such as Conflict

Failures such as `ConflictError` also ride the envelope and propagate to the client. On the UI side, `extractSerializedError(e)` in the action / transition `catch` and switch on `error.kind` — or, for a user-facing string, hand it straight to `displayError` and let the dictionary in `apps/web/app/presentation/errorDisplay.ts` map `code` → message:

```tsx
try {
  await removeIdentity({ data: { identityId } });
} catch (e) {
  const error = extractSerializedError(e);
  if (error.kind === "notFound") setMessage("This sign-in method is already gone");
  else if (error.kind === "conflict") setMessage("Conflicted with another operation. Please try again");
  else setMessage(displayError(error));
}
```

`displayError` never puts a server-supplied string on screen: it reads only `kind` and `code`, looks the `code` up in a fixed dictionary, and falls back to a per-`kind` sentence when the code is unknown. That is what keeps raw messages, internal codes and Zod's default English out of the UI.

### Points

- `useServerFn(fn)` auto-detects `isRedirect` and converts it into a router navigation. This avoids falling through the client's try/catch when a handler does `throw redirect({ to: "/signin" })`. In this repository the redirects are decided in `presentation/sessionGuard.ts` and in the route guards of `routes/index.tsx` / `routes/settings/route.tsx`, and mutations navigate explicitly afterwards (`CreateNoteButton`, `VerifyEmailPanel`), so the automatic path is a safety net rather than the main road. The folded bridges (`routes/notes/-action.tsx`) also throw redirects, but those never touch this path either: a loader calls them, and the router unwraps the redirect there.
- A `useActionState` action may be async. State updates both before and after `await` enter the same transition. Passing it to `<form action={formAction}>` lets it progressively enhance even on a client where JS has not yet arrived.
- When you want to update a loader-owned RSC on success, explicitly do `await router.invalidate()` inside the action / transition. Since the generic hook was abandoned, "when to invalidate" is the caller's responsibility. Do it **outside** the `try` that reports failure: in `CreateNoteButton` the note already exists by then, so a reconcile failure must not read as "creation failed" and invite a retry that creates a second note.
- An item-local `useOptimistic` only works on **state that the item owns** — `ProfileEditor`'s avatar is item-owned, so it is complete within the leaf with `useOptimistic` + a server function (the new image shows immediately and reverts automatically if the upload throws). On the other hand, operations that **change the list's membership**, such as add/remove, are parent state changes, so item-local cannot reach them. Carve the list out into a client island, hold the entire list array with `useOptimistic` seeded by the server value, and **have the owner call the server function** (the "Held by the client" section above / `apps/web/app/components/settings/IdentityList/board.tsx`). Add optimistically appends, remove filters, and `router.invalidate()` re-bases onto the settled value. Delete cannot be placed in the leaf because optimistic deletion unmounts the leaf before settlement, erasing the error UI along with it.
- Keep the live region **mounted** while empty rather than rendering it conditionally: a region that appears together with its text is not announced by most screen readers. `CreateNoteButton`, `SignUpForm` and `IdentityBoard` all keep the element and swap only its content (`not-empty:mt-*` handles the spacing).

## Client validation with Conform

An example combining Conform's client validation + `useServerFn`.

> **Current status**: not adopted. `@conform-to/react` / `@conform-to/zod` / `sonner` are not dependencies of `@repo/web` — the forms in this repository do their per-field checks with plain state (`components/auth/fieldValidation.ts`, `components/auth/passwordStrength.ts`) and surface failures through `displayError`. Keep this as the reference shape for when a form outgrows that.

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  getFormProps,
  getInputProps,
  getTextareaProps,
  useForm,
} from "@conform-to/react";
import { getZodConstraint, parseWithZod } from "@conform-to/zod/v4";
import { createPostFn, createPostSchema } from "./actions";

function NewPostPage() {
  const router = useRouter();
  const createPost = useServerFn(createPostFn);
  const [isPending, startTransition] = useTransition();

  const [form, fields] = useForm({
    id: "create-post",
    constraint: getZodConstraint(createPostSchema),
    shouldValidate: "onSubmit",
    shouldRevalidate: "onBlur",
    onValidate: ({ formData }) =>
      parseWithZod(formData, { schema: createPostSchema }),
    onSubmit: (event, { submission }) => {
      event.preventDefault();
      if (submission?.status !== "success") return;
      startTransition(async () => {
        const { postId } = await createPost({ data: submission.value });
        await router.navigate({ to: "/posts/$postId", params: { postId } });
      });
    },
  });

  return (
    <form {...getFormProps(form)}>
      <input {...getInputProps(fields.title, { type: "text" })} />
      <div>{fields.title.errors}</div>
      <textarea {...getTextareaProps(fields.content)} />
      <div>{fields.content.errors}</div>
      <button type="submit" disabled={isPending}>
        {isPending ? "Creating..." : "Create"}
      </button>
    </form>
  );
}
```

## Error / Not Found

Exceptions thrown inside a loader or a server component bubble to an error boundary. This repository sets the **router-level defaults** in `apps/web/app/router.tsx` and overrides them per route only where the shell has to be preserved:

```tsx
// apps/web/app/router.tsx (excerpt)
export async function getRouter() {
  const config = await resolveAppConfig();
  const router = createRouter({
    routeTree,
    // Every route's `head` reads this as `match.context?.config`.
    context: { config } satisfies RouterContext,
    // Deployment-scoped, so ship it once in the SSR payload...
    dehydrate: () => ({ config }),
    // ...and restore it before `matchRoutes`, so the first client-side
    // navigation already has it.
    hydrate: (dehydrated) => {
      router.update({ context: { config: dehydrated.config } });
    },
    defaultPendingComponent: RoutePendingFallback,
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
    defaultErrorComponent: ({ error }) => {
      sanitizeRouteError(error);
      return <ServerErrorState />;
    },
    defaultNotFoundComponent: () => <NotFoundState />,
  });
  return router;
}
```

`getRouter` is `async` because of that first line: `resolveAppConfig` (`apps/web/app/presentation/appConfig.ts`) is an isomorphic function whose server half reads the container and whose client half returns `undefined`, leaving the client to take the value out of the dehydrated payload. Two consequences follow. Every `head` must keep an `if (!config)` early return, because the server half yields `undefined` outside a request scope — the invariant is *never read `config` when it is `undefined`*, not *return `{}`*. What that branch returns is the route's own call: the sixteen leaf routes return `{}`, while `__root.tsx` returns `{ links: baseLinks }` so the stylesheet and the favicons survive a config-less render. And nothing secret may ever be added to `AppConfig`: `dehydrate` puts the whole object into the SSR payload of every document, public pages viewed while signed out included.

The defaults are not optional decoration. **SSR renders `route.errorComponent ?? defaultErrorComponent` at the matched route and does not bubble to the root boundary** (only client-side rendering bubbles). Without a router default, a route that omits `errorComponent` falls back to TanStack's built-in English error screen — with the raw `message` in it — on the server-rendered pass. The same reasoning applies to `defaultNotFoundComponent`.

`apps/web/app/routes/__root.tsx` still defines the site-wide `errorComponent` / `notFoundComponent`, wrapped in `RootDocument` so the `<html>` shell survives. The hierarchy is:

```
Exception source (loader / server component / server function)
    ↓ throw
Matched child route .errorComponent  ←  stops here if defined
    ↓ if undefined
router defaultErrorComponent         ←  applies at the matched route, incl. SSR
    ↓ (client rendering only) bubble up
__root.tsx .errorComponent           ←  final fallback (sanitizeRouteError)
```

`redirect()` / `notFound()` are caught by the router itself rather than the errorComponent, and are routed to navigation / `notFoundComponent` respectively.

### Propagating server function exceptions in structured form

An exception thrown by `createServerFn`'s `handler` reaches the client, but if it stays a plain `Error`, the `cause` chain and stack trace break during serialization, and branching by `kind` becomes impossible. So, in the presentation layer, we provide

- `AppServerError` — an exception class dedicated to propagation (holds `serialized` as an enumerable own property and survives a JSON round trip; it deletes its own `.stack` so an adapter-bypassed transport can't leak one)
- `appServerErrorAdapter` (registered with `createStart` in `apps/web/app/start.ts`) — a serialization adapter that preserves the class identity of `AppServerError` across a Seroval roundtrip. **It runs only at boundaries via `createServerFn(...).middleware([errorResponseMiddleware])`**. Via direct `fetch` / an RSC error frame / a custom transport, the adapter does not run, and the client receives a plain Error/object (a remnant) that holds `serialized` as an own property
- `serializeError(error)` — folds Business / NotFound / Validation, etc. into a `SerializedError` (`{ kind, code, message, retryable?, fieldErrors? }`). Deliberately **un-redacted**, so server-side observers see the original `code` / `message`
- `redactForClient(serialized)` — strips `code` / `message` from `system` and `unknown` before they cross the wire. Applied exactly once, at the boundary
- `extractSerializedError(error)` — extracts the `SerializedError` on the client side. Three-stage detection: (1) `isAppServerErrorShaped` (structural stand-in for `instanceof`) → (2) structural `serialized` remnant detection → (3) `serializeError` fallback. **UI code must always go through this function. Using `instanceof AppServerError` for branching becomes false whenever the value crossed a different module graph — dev serves ssr / rsc / server-fn graphs each with their own copy of the class — and breaks silently**
- `errorResponseMiddleware` (`apps/web/app/presentation/errorResponseMiddleware.ts`) — wraps the entire server function (both `validator` and the handler) to apply the above, log `system` / `unknown` through the container's `Logger`, and set the HTTP status from `SerializedErrorKind` (with a closed list of code-level exceptions: `UNAUTHENTICATED` → 401, `THROTTLED` / `LOCKED` / `RATE_LIMITED` → 429, `NOTE_GONE` → 410). TanStack Router's `redirect()` / `notFound()` sentinels are rethrown as-is. **Write `createServerFn(...).middleware([errorResponseMiddleware])` directly at the call site** (pre-applying via a separate module is not allowed because it breaks the RSC plugin's static rewrite)
- `renderServerFragment` (`apps/web/app/presentation/serverFragment.tsx`) — the same redaction + logging contract for the **streamed** half, where the middleware has already returned by the time the fragment rejects

(`apps/web/app/presentation/errorResponse.ts`.)

The side that raw-`await`s in a client action / transition / loader, etc. branches by kind with `extractSerializedError`:

```tsx
import { extractSerializedError } from "@/presentation/errorResponse";

try {
  await removeIdentity({ data: { identityId } });
} catch (e) {
  const { kind } = extractSerializedError(e);
  if (kind === "notFound") setErrorMessage("This sign-in method is already gone");
  else setErrorMessage(displayError(e));
}
```

`renderErrorMessage` / `displayError` / `sanitizeRouteError` dispatch through a `Record<SerializedErrorKind, string>`-typed table, so adding a new variant to `SerializedError.kind` produces a compile error. The aim is to guarantee exhaustiveness at the type level.

## Summary: must-haves for the current `@tanstack/react-start`

- Vite: the three-plugin setup of `tanstackStart({ srcDirectory: "app", server: { entry: "server.node.ts" }, rsc: { enabled: true } })` + `rsc()` (`@vitejs/plugin-rsc`) + `viteReact()` — see `apps/web/vite.config.node.ts`
- Start instance: `createStart` in `apps/web/app/start.ts` must re-register `createCsrfMiddleware` (creating an instance replaces the framework default) alongside `serializationAdapters: [appServerErrorAdapter]`
- Server function validation: **`.validator(...)`** (the `input`-prefixed alias from older releases is deprecated)
- RSC high-level APIs: `renderServerComponent` / `createCompositeComponent` / `CompositeComponent`. Reach `renderServerComponent` through `renderServerFragment` so mid-stream rejections stay redacted and logged
- server-only boundary: reach server-only modules (`presentation/session.ts`, the DI container, usecase modules) through a **dynamic import inside the handler**. Do not statically import them from a module a client component pulls in
- Server functions reachable only from `"use client"` components must be imported once from a server-rendered route (`routes/__root.tsx`) so the RSC manifest registers them
- Calling a server function from the client: **wrap it with `useServerFn(fn)`** (with automatic redirect handling)
- Consolidate the server-side entry points that call usecases on the **`serverData` / `loadServerDeps` wrappers**. Only helpers that hit a single port directly call `getContainer()` (escape hatch)
- `structuralSharing: false` is mandatory when putting RSC values into Query
- Low-level APIs (`renderToReadableStream` / `createFromReadableStream` / `createFromFetch`) only when a custom transport is needed
