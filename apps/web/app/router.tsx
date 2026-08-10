import { createRouter } from "@tanstack/react-router";
import { NotFoundState, ServerErrorState } from "./components/ui/ErrorState";
import { RoutePendingFallback } from "./components/ui/RoutePendingFallback";
import { sanitizeRouteError } from "./presentation/errorDisplay";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
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
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
