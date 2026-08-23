import type { AppConfig } from "@repo/core/application/di/types";
import { createIsomorphicFn } from "@tanstack/react-start";

/**
 * ルーターコンテキスト。各ルートの `head` は `match.context?.config` で読む。
 *
 * `config?:` ではなく `config: AppConfig | undefined` にするのは
 * `exactOptionalPropertyTypes: true` のため（省略可能プロパティへ
 * `undefined` を代入できない）。
 *
 * `router.tsx` の `dehydrate` により、`AppConfig` は未サインインの公開
 * ページを含む全ページの SSR ペイロードへ丸ごと載る。署名鍵・暗号鍵を
 * `AppConfig` に足さないこと。
 */
export type RouterContext = { config: AppConfig | undefined };

/**
 * サーバーでは要求スコープの container から引く。クライアントは SSR
 * ペイロード（router の `dehydrate` / `hydrate`）から受け取るのでここでは
 * 何も返さない。
 *
 * **引けなければ `undefined` を返す（throw しない）。** `getRouter()` は
 * `handleServerRoutes` 経由で `/storage/$` を含む全要求から呼ばれるので、
 * 要求スコープ外での throw は無関係なファイル配信まで 500 に落とす。
 * `head` 側はすべて `if (!config) return {}` を持つため、失敗は「メタ
 * タグが出ない」に留まる。
 *
 * `createIsomorphicFn` なのは `router.tsx` がクライアントバンドルにも入る
 * ため — `.server(...)` の本体はクライアントビルドから落ちるので、
 * `containerStore` 経由のサーバー DI グラフが漏れない。
 */
export const resolveAppConfig = createIsomorphicFn()
  .server(async (): Promise<AppConfig | undefined> => {
    const { getInstalledStore } = await import(
      "@repo/core/application/di/containerStore"
    );
    return getInstalledStore()?.getStore()?.config;
  })
  .client(async (): Promise<AppConfig | undefined> => undefined);
