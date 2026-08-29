import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";
import { NotFoundState, ServerErrorState } from "@/components/ui/ErrorState";
import type { RouterContext } from "@/presentation/appConfig";
import { sanitizeRouteError } from "@/presentation/errorDisplay";
import { buildHead } from "@/presentation/head";
import appCss from "../styles/index.css?url";

// Server fns only reachable from `"use client"` components miss the
// rsc manifest (frozen before the client build phase). Pull their
// provider modules into a server-rendered route to register them.
import "@/components/auth/SignUpForm/action";
import "@/components/auth/SignInForm/action";
import "@/components/auth/VerifyEmailPanel/action";
import "@/components/auth/ResendVerificationForm/action";
import "@/components/auth/ResetPasswordPanel/action";
import "@/components/layout/AccountMenu/action";
import "@/components/layout/ScopeToken/action";
import "@/components/note/CreateNoteButton/action";
import "@/routes/auth/-action";
import "@/routes/dev/-action";
import "@/routes/settings/-action";
import "@/routes/workspaces/-action";
import "@/routes/workspaces/$workspaceId/settings/-action";

const SITE_ASSET_LINKS = [
  { rel: "icon", href: "/favicon.ico", sizes: "any" },
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];

export const Route = createRootRouteWithContext<RouterContext>()({
  head: ({ match }) => {
    const stylesheet = { rel: "stylesheet", href: appCss };
    const baseLinks = [...SITE_ASSET_LINKS, stylesheet];
    const config = match.context?.config;
    if (!config) return { links: baseLinks };
    const { meta, links } = buildHead(config);
    return { meta, links: [...baseLinks, ...links] };
  },
  component: RootComponent,
  // P-46: 到達できない URL と想定外の失敗の共通表示。存在の有無・権限の
  // 有無を区別しない（spec/pages/index.md#P-46）。原文 message は UI に
  // 出さず、ログ側にだけ残す。
  errorComponent: ({ error }) => {
    sanitizeRouteError(error);
    return (
      <RootDocument>
        <ServerErrorState />
      </RootDocument>
    );
  },
  notFoundComponent: () => (
    <RootDocument>
      <NotFoundState />
    </RootDocument>
  ),
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
        <Scripts />
      </body>
    </html>
  );
}
