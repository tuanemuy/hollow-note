import type { AppConfig } from "@repo/core/application/di/types";
import { createIsomorphicFn } from "@tanstack/react-start";

/**
 * ルーターコンテキスト。各ルートの `head` は `match.context?.config` で読む。
 *
 * `config?:` ではなく `config: AppConfig | undefined` にするのは
 * `exactOptionalPropertyTypes: true` のため（省略可能プロパティへ
 * `undefined` を代入できない）。
 */
export type RouterContext = { config: AppConfig | undefined };

/**
 * サーバーでは要求スコープの container から引く。クライアントは SSR
 * ペイロード（router の `dehydrate` / `hydrate`）から受け取るのでここでは
 * 何も返さない。
 *
 * `createIsomorphicFn` なのは `router.tsx` がクライアントバンドルにも入る
 * ため — `.server(...)` の本体はクライアントビルドから落ちるので、
 * `containerStore` 経由のサーバー DI グラフが漏れない。
 */
export const resolveAppConfig = createIsomorphicFn()
  .server(async (): Promise<AppConfig | undefined> => {
    const { getContainer } = await import(
      "@repo/core/application/di/containerStore"
    );
    return (await getContainer()).config;
  })
  .client(async (): Promise<AppConfig | undefined> => undefined);
