import { createRouter } from "@tanstack/react-router";
import { NotFoundState, ServerErrorState } from "./components/ui/ErrorState";
import { RoutePendingFallback } from "./components/ui/RoutePendingFallback";
import { type RouterContext, resolveAppConfig } from "./presentation/appConfig";
import { sanitizeRouteError } from "./presentation/errorDisplay";
import { routeTree } from "./routeTree.gen";

export async function getRouter() {
  const config = await resolveAppConfig();
  const router = createRouter({
    routeTree,
    context: { config } satisfies RouterContext,
    // 配備ごとにしか変わらない値なので、SSR ペイロードに 1 回だけ載せる。
    // クライアントは以降これを要求しない。
    dehydrate: () => ({ config }),
    // `matchRoutes` より前に走るので、最初のクライアント遷移から効く。
    hydrate: (dehydrated) => {
      router.update({ context: { config: dehydrated.config } });
    },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingComponent: RoutePendingFallback,
    // Skip the fallback for sub-200ms navigations so it doesn't flash...
    defaultPendingMs: 200,
    // ...and once shown, keep it up for at least 300ms to avoid a flicker.
    defaultPendingMinMs: 300,
    // P-46 の共通表示はルーター既定として持つ。ルート個別の
    // errorComponent を置かない書き方は、これがあって初めて成立する:
    // SSR は match ごとに `route.errorComponent ?? defaultErrorComponent`
    // をその場で描画し、root の境界までバブルしない（バブルするのは
    // クライアント描画だけ）。既定が無いと SSR だけ TanStack 組み込みの
    // 英語エラー画面（原文 message 付き）に落ちる。
    defaultErrorComponent: ({ error }) => {
      sanitizeRouteError(error);
      return <ServerErrorState />;
    },
    // 同じ理由の notFound 版。SSR は notFound を親へバブルさせず、
    // 既定が無いと組み込みの `Not Found` だけが出る。
    defaultNotFoundComponent: () => <NotFoundState />,
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>;
  }
}
