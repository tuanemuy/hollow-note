# 実装手順 — Issue #13

## 設計

本 Issue はプレゼンテーション層に閉じる。ドメイン・ユースケース・アダプターへの変更はない（`AppConfig` の定義も `authenticateSession` も現状のまま）。

### ドメインモデルへの影響

なし。既存の `SameOriginPolicy.isSameOriginPath`（`packages/core/src/domain/identity/services/sameOriginPolicy.ts`、ADR 051）を presentation から**呼ぶ**ようになるだけで、ドメイン側は 1 行も変えない。

### ユースケース / アプリケーションロジック

なし。`packages/core` は 1 行も変えない。`AppConfig` の供給元は引き続き DI（`container.config`）であり、presentation はその値を**運び方だけ**変える。

### アダプター / 永続化 / 外部連携

なし。

### UI / プレゼンテーション

3 往復の内訳と、それぞれをどう畳むかを分けて設計する。

#### 往復 1: root の `loadAppContext`

**問題の本質**は「`beforeLoad` は `staleTime` を見ない」ことではなく、**配備ごとにしか変わらない値（`AppConfig`）を要求ごとに運んでいること**である。`spec/presentation/index.md` は `AppConfig` を「起動時に環境から解決される読み取り専用の設定」＝ SSR メタデータと定めており、ナビゲーションのたびに引く根拠がない。

Issue が挙げる「root `loader` へ移す」案は**採らない**。`head({ matches, match, loaderData })` の `matches` は `loadMatches` に渡ったスナップショット配列で、`updateMatch` が各 match ストアに**新しいオブジェクト**を書くため後から更新されない。したがって子ルートの `head` から root の `loaderData` は読めず、17 箇所の `head` 実装を作り替えることになる。Issue が「ルーティング契約の変更になる」と警戒していたのはこの点である（ADR-001）。

代わりに、**`AppConfig` をルーターコンテキストに載せる**。`buildMatchContext` は `{...router.options.context}` を起点に各 match のコンテキストを重ねるので、`createRouter({ context: { config } })` で与えた値は全 match の `match.context` に入る。**既存の `head: ({ match }) => match.context?.config` は 17 箇所すべて無変更で通る。**

供給経路は環境ごとに分かれる。

- **サーバー**: `getRouter()` は要求ごとに `await` で呼ばれる（`start-server-core` の `createStartHandler`）。`apps/web/app/server.node.ts` が `storage.run(container, () => entry.fetch(request))` で包んでいるので、`getRouter()` の中から `getContainer()` が引ける。
- **クライアント**: `getRouter()` はハイドレーション時に 1 回だけ `await` される。この時点では値を持てないので、ルーターの `dehydrate` / `hydrate` オプションで SSR ペイロードに 1 回だけ載せて渡す。`router.options.hydrate(dehydratedData)` はクライアントで `matchRoutes` より**前**に走るので、`router.update({ context })` で入れれば最初のクライアント遷移から効く。

結果、`loadAppContext` という server function は消える。**クライアント遷移での往復は 0。**

#### 往復 2 と 3: 認証ガードと RSC 断片

断片ブリッジ（`renderNoteList` / `renderNoteDetail` / `renderIdentityList` …）は**すでにハンドラーの中で `requireSession()` を通しており、そこが権限判定の唯一の権威**である。ルートの `beforeLoad` ガードはクライアントから直接叩ける以上、権威ではなく「未サインインを `/signin` へ誘導する導線」でしかない。したがって**ガードの往復は、断片の往復が既に持っている情報の使い残し**である。

畳み方はルートの形で 2 通りに分かれる。

- **ガードと断片が同じ match にあるルート（`/notes`, `/notes/$noteId`）** — ブリッジに畳む。ブリッジが「セッションを解決し、無ければ `/signin` へ `redirect` を throw し、あれば `{ user, 断片 }` を返す」。`beforeLoad` は消す。**1 要求 / 1 段。**
- **ガードと断片が別 match にあるルート（`/settings` レイアウト + 子）** — 畳めないので**並列化**する。`loadMatches` は `beforeLoad` を match 順に逐次実行し、`loader` は `Promise.all` で並列に走らせる。レイアウトのガードを `beforeLoad` から `loader` へ移すだけで、子の断片 loader と同時に飛ぶ。**2 要求 / 1 段。**

`/notes` 系で `/signin` への誘導をサーバー側で出すには、遷移元のパスをブリッジへ渡す必要がある。転送境界の入力なので `.validator(validateInput(schema))` を通し（形と DoS 上限）、値としての安全（オープンリダイレクト）は `safeRedirectPath` がサーバー側で担保する。**判定そのものは今もクライアント側の `requireAuthenticated` で同じ関数が行っており、実装は移動するだけで新しい判定は増えない。**

#### ガードの鮮度: `staleTime` から切り離す

`beforeLoad` はナビゲーションごとに必ず走る（`handleBeforeLoad` にキャッシュ判定はない）。`loader` はそうではない — `handleLoader` は

```js
staleMatchShouldReload = age >= staleAge && (!!inner.forceStaleReload || match.cause === "enter"
  || (previousRouteMatchId !== undefined && previousRouteMatchId !== match.id));
loaderShouldRunAsync = status === "success" && (invalid || (shouldReload ?? staleMatchShouldReload));
```

（`@tanstack/router-core@1.171.15` `dist/esm/load-matches.js:431-435`）で判定する。素直に移すと 2 つ壊れる。

1. 本番は `staleTime: Infinity` なので `age >= staleAge` が偽 → **既訪 match へ戻るとガードが再判定されない**。
2. `/settings` レイアウト match は子ルート間の遷移で生き残るため `cause: "stay"` かつ `previousRouteMatchId === match.id`、`forceStaleReload` は同一 href の再読み込みでしか立たない → **DEV（`staleTime: 0`）でもレイアウトの loader が再実行されない**。

上の式のとおり `shouldReload ?? staleMatchShouldReload` は **`shouldReload` が優先**で、`staleTime` も `cause` の条件も丸ごと迂回する。したがってガードを載せた loader を持つルート（`/notes/`, `/notes/$noteId`, `/settings`）にだけ

```ts
shouldReload: ({ cause }) => cause !== "preload",
```

を置き、`beforeLoad` が持っていた「毎ナビゲーション再判定」を取り戻す（ADR-003）。

関数形にするのは、真偽値の `true` だと `preloadStaleTime` まで無効化され、`defaultPreload: "intent"` の下で**読み込み済みの** `/notes/` `/notes/$noteId` にホバーするたび要求が飛ぶため。**ただし関数形が preload を抑止できるのは cached match だけで、`/settings` レイアウトには効かない。** `resolvePreload`（同ファイル 53-55）は `inner.preload && !router.stores.matchStores.has(matchId)` で、`matchStores` はアクティブ match のプール（`src/stores.ts:125,259-267`）なので、`/settings/profile` にいる状態で `/settings/auth` を preload するとレイアウト match はアクティブ → `preload = false` → `getLoaderContext`（同 620,635）が渡す `cause` は `"stay"` になり、`shouldReload` は true を返す。`LoaderFnContext` に preload を見分ける別の手掛かりは無い（`preload` フィールドも同じ `resolvePreload` 由来）。**これは後退ではない** — `executeBeforeLoad`（同 388-531）にキャッシュ判定は無いので、現行の `beforeLoad` ガードも今すでにホバーのたび飛んでいる。本数は変わらず、変わるのは「関数形の効能が 3 ルート中 2 ルートにしか及ばない」ことだけである（ADR-003 Decision / Consequences）。

`staleTime` 自体は据え置く（子の断片ルート `/settings/{profile,auth,usage}` はそのまま `staleTime: Infinity` の恩恵を受ける）。**ただし `shouldReload` を置いた 3 ルートでは `staleTime` / `preloadStaleTime` は一切参照されなくなる** — `shouldReload ?? staleMatchShouldReload` の左辺が常に非 `undefined` になるため。据え置きが意味を持つのは子の断片ルート側だけであり、3 ルートに `staleTime` の行を残すなら「もう参照されない」ことをコメントで明示する（ステップ 3-4 / ステップ 4-1）。

#### 変わらないもの

- 断片ストリーミングの形（ブリッジは `renderServerFragment(...)` の promise を**未解決のまま**返し、loader は await せず転送し、`<Suspense>` の下で解決される）
- `renderServerFragment` による redaction 境界（ADR 031）
- `errorResponseMiddleware`（`isRedirect` は素通しするので、ブリッジからの `redirect` throw は影響を受けない）
- 17 箇所の `head` 実装
- 各ミューテーション server function
- `SameOriginPolicy`（ドメイン側）の実装

---

## 実装ステップ

### 1. `AppConfig` をルーターコンテキストへ載せ、root の `beforeLoad` を廃止する

- **対象ファイル:**
  - `apps/web/app/presentation/appConfig.ts`（新規）
  - `apps/web/app/router.tsx`
  - `apps/web/app/routes/__root.tsx`
  - `apps/web/app/routeTree.gen.ts`（自動生成 — 再生成して差分を含める）
- **変更内容:**
  1. `presentation/appConfig.ts` に、ルーターコンテキストの型と、環境ごとの解決関数を置く。

     ```ts
     import type { AppConfig } from "@repo/core/application/di/types";
     import { createIsomorphicFn } from "@tanstack/react-start";

     /**
      * ルーターコンテキスト。`head` は `match.context?.config` で読む。
      * `config?:` ではなく `config: AppConfig | undefined` にするのは
      * `exactOptionalPropertyTypes: true` のため（省略可能プロパティへ
      * `undefined` を代入できない）。
      */
     export type RouterContext = { config: AppConfig | undefined };

     /**
      * サーバーでは要求スコープの container から引く。クライアントは
      * SSR ペイロード（router の `dehydrate` / `hydrate`）から受け取るので
      * ここでは何も返さない。
      */
     export const resolveAppConfig = createIsomorphicFn()
       .server(async (): Promise<AppConfig | undefined> => {
         const { getContainer } = await import(
           "@repo/core/application/di/containerStore"
         );
         return (await getContainer()).config;
       })
       .client(async (): Promise<AppConfig | undefined> => undefined);
     ```

     **`RouterContext` を `{ config?: AppConfig }` にしないこと。** `apps/web/tsconfig.json` は `exactOptionalPropertyTypes: true` なので、`{ config } satisfies RouterContext`（`config` は `AppConfig | undefined`）が `TS1360` で落ちる。`createRootRouteWithContext<RouterContext>()` を通した `createRouter({ context })` と `hydrate` 内の `router.update({ context })` も同じ理由で落ちる。

     `createIsomorphicFn` を使うのは、`router.tsx` がクライアントバンドルにも入るため。`.server(...)` の本体はクライアントビルドから落ちるので、`containerStore` 経由のサーバー DI グラフが漏れない。`import.meta.env.SSR` 分岐でも同等だが、フレームワークが用意している形をとる。
  2. `router.tsx` の `getRouter()` を **async** にし、`context` / `dehydrate` / `hydrate` を渡す。

     ```ts
     export async function getRouter() {
       const config = await resolveAppConfig();
       const router = createRouter({
         routeTree,
         context: { config } satisfies RouterContext,
         // SSR ペイロードに 1 回だけ載せる。クライアントは要求を出さない。
         dehydrate: () => ({ config }),
         // `matchRoutes` より前に走るので、最初のクライアント遷移から効く。
         hydrate: (dehydrated) => {
           router.update({ context: { config: dehydrated.config } });
         },
         scrollRestoration: true,
         defaultPreload: "intent",
         // …以下は現状のまま
       });
       return router;
     }

     declare module "@tanstack/react-router" {
       interface Register {
         router: Awaited<ReturnType<typeof getRouter>>;
       }
     }
     ```

     **`Register.router` の宣言は 2 系統ある。** `routeTree.gen.ts:430-438`（`@tanstack/react-start` 側・自動生成）は既に `Awaited<...>` なので触らない。直すのは手書きの `router.tsx:33-37`（`@tanstack/react-router` 側）だけ。忘れると `Link` の型補完から `useLoaderData` までルーター型が一斉に壊れる。
  3. `__root.tsx` から `loadAppContext`（server function 定義そのもの）と `beforeLoad` を削除し、`createRootRoute({...})` を `createRootRouteWithContext<RouterContext>()({...})` に変える。root は loader も beforeLoad も持たなくなるので `staleTime` の行も落とす。`head` の本体・`SITE_ASSET_LINKS`・`errorComponent` / `notFoundComponent` ・ server function 登録用の副作用 import は**そのまま残す**。
  4. `pnpm dev` か `pnpm build` を一度走らせて `routeTree.gen.ts` を再生成する。
- **理由:** `AppConfig` は配備ごとにしか変わらない SSR メタデータで、要求ごとに運ぶ根拠がない。ルーターコンテキストに載せれば `match.context?.config` を読む 17 箇所の `head` が無変更のまま、往復だけが消える。root `loader` 案を採らないのは、`head` の `matches` がロード前スナップショットで子ルートから root の `loaderData` を読めないため（ADR-001）。

### 2. オープンリダイレクト判定を ADR 051 の述語へ委譲し、セッション解決 + `/signin` 誘導を 1 本置く

- **対象ファイル:**
  - `apps/web/app/presentation/redirect.ts`
  - `apps/web/app/presentation/sessionGuard.ts`（新規）
- **変更内容:**
  1. `redirect.ts` の `safeRedirectPath` の中身を、ドメインの述語へ委譲する形に差し替える。`hasControlCharacter` とその重複ロジックは削除する。

     ```ts
     import { SameOriginPolicy } from "@repo/core/domain/identity/services/sameOriginPolicy";

     /**
      * Open-redirect guard: only same-origin absolute paths survive.
      * 述語そのものは ADR 051 でドメインに 1 本化されている
      * （`//host` / バックスラッシュ / 制御文字の 3 つの回避形）。
      * ここが持つのは「弾いたときどこへ倒すか」という導線の決定だけ。
      */
     export function safeRedirectPath(value: string | undefined | null): string {
       return typeof value === "string" && SameOriginPolicy.isSameOriginPath(value)
         ? value
         : "/notes";
     }
     ```

     `presentation/__tests__/redirect.test.ts` は**変更しない** — 既存ケースがそのまま通ることが委譲の回帰網になる。
  2. `presentation/sessionGuard.ts`（新規）に、遷移元パスを受けて redirect まで面倒を見る関数を置く。

     ```ts
     import { redirect } from "@tanstack/react-router";
     import { safeRedirectPath } from "./redirect";

     /**
      * 断片ブリッジ用のガード。セッションを解決し、無ければ遷移元へ戻れる
      * 形で `/signin` へ送る。ルートの `beforeLoad` ガードと違い、判定と
      * 断片の描画が同じ要求に収まる。`redirectTo` は転送境界から来るので
      * `safeRedirectPath` を必ず通す（オープンリダイレクト対策）。
      *
      * Server-only module: `session.ts` を動的 import する規約はそのまま。
      */
     export async function requireSessionOrRedirect(redirectTo: string) {
       const { sessionUserOrNull } = await import("./session");
       const user = await sessionUserOrNull();
       if (user === null) {
         throw redirect({
           to: "/signin",
           search: { redirect: safeRedirectPath(redirectTo) },
         });
       }
       return user;
     }
     ```
- **理由:**
  - **委譲（ADR-004）:** ADR 051 は「認可の往復のあとに再生する遷移先は自オリジンに限る」を業務不変条件と定め、「述語を 1 本にまとめてドメインに置く」と決めている。`sameOriginPolicy.ts` と `redirect.ts` は現在バイト単位で同じロジックを 2 本持っており、ADR 051 の「影響」欄（1 箇所でしか判定されない）は既に事実でない。本 Issue は**判定をクライアント側の導線からサーバー側の境界へ移し、呼び出し点を 1 つ増やす**ので、片方だけに知識が入る事故の被害が上がる。1 行の委譲で canon と揃う。
  - **置き場所（`session.ts` ではなく `sessionGuard.ts`）:** `session.ts` の library JSDoc は自身を「Session-cookie transport（spec/presentation/index.md 資格情報の運搬）」と定義しており、Cookie 属性・読み書き・`requireSession` に閉じている。`/signin` への誘導はルーティングの方針であって Cookie の運搬ではない。分けることで `auth.ts`（クライアントグラフに入るセッション probe）/ `session.ts`（Cookie 運搬）/ `sessionGuard.ts`（誘導）の 3 分担が読める。
  - 同じ「セッションが無ければ遷移元付きで `/signin` へ」という決定を 3 つのブリッジが共有するので、1 か所に置く。

### 3. `/notes` と `/notes/$noteId` のガードを断片ブリッジへ畳む

- **対象ファイル:**
  - `apps/web/app/routes/notes/-action.tsx`
  - `apps/web/app/routes/notes/index.tsx`
  - `apps/web/app/routes/notes/$noteId.tsx`
- **変更内容:**
  1. `-action.tsx`: 両ブリッジに `redirect`（遷移元パス）の入力を足し、`requireSession()` を `requireSessionOrRedirect(data.redirect)` に置き換える。`renderNoteList` は `user` も返す。

     ```ts
     const redirectField = z.string().min(1).max(2048);

     export const renderNoteList = createServerFn({ method: "GET" })
       .middleware([errorResponseMiddleware])
       .validator(validateInput(z.object({ redirect: redirectField })))
       .handler(async ({ data }) => {
         const [{ NoteList }, { requireSessionOrRedirect }] = await Promise.all([
           import("@/components/note/NoteList"),
           import("@/presentation/sessionGuard"),
         ]);
         const user = await requireSessionOrRedirect(data.redirect);
         return {
           user,
           NoteList: renderServerFragment(() => NoteList({ userId: user.userId })),
         };
       });
     ```

     `renderNoteDetail` は既存の `noteDetailInputSchema` に `redirect` を足し、`user` は返さない（`ReaderShell` が使わないため）。
     ファイル冒頭のコメント（「ガードは redirect、ハンドラーは 401 の二重化」の説明）を、統合後の実態に書き換える。
  2. `index.tsx`: `beforeLoad` を削除。loader を `loader: ({ location }) => renderNoteList({ data: { redirect: location.href } })` にし、コンポーネントは `const { user, NoteList } = Route.useLoaderData();` にする（`Route.useRouteContext()` の行は消す）。`head` / `staleTime` / `errorComponent` はそのまま。**`shouldReload: ({ cause }) => cause !== "preload"` を足す。**
  3. `$noteId.tsx`: `beforeLoad` を削除。loader を `loader: ({ params, location }) => renderNoteDetail({ data: { noteId: params.noteId, redirect: location.href } })` にする。コンポーネントは変更なし。**同じく `shouldReload` を足す。**
  4. **`shouldReload` を置いた 3 ルートでは `staleTime` が死ぬ。** `loaderShouldRunAsync = status === "success" && (invalid || (shouldReload ?? staleMatchShouldReload))` で `shouldReload` は常に非 `undefined` を返すため、`/notes/`・`/notes/$noteId`・`/settings` の `staleTime`（および `preloadStaleTime`）は**一切参照されなくなる**。`staleTime` の行を残す場合は「この `staleTime` は `shouldReload` があるかぎり参照されない」を 1 行コメントで添える（`shouldReload` 自体と同じ誤読リスクが `staleTime` 側にも立つ）。行ごと落とす判断も可 — どちらでもよいが、**無言で残さない**こと。据え置きが意味を持つのは `staleTime` を持つ子の断片ルート（`/settings/{profile,auth,usage}`）のほうであって、この 3 ルートではない。
- **理由:** ハンドラー側のセッション解決が唯一の権威で、その結果を返せばガード往復は不要になる。`location.href` はルーターの `ParsedLocation.href`（パス + search + hash、オリジンなし）で、今も `requireAuthenticated(location.href)` に渡している値と同じ。判定は `safeRedirectPath` のままサーバー側へ移る。`shouldReload` は、ガードが `staleTime: Infinity` のキャッシュに埋もれて再判定されなくなるのを防ぐ（ADR-003 / AC-6b）。`shouldReload` を置く 3 ルート（`/notes/`, `/notes/$noteId`, `/settings`）には**コメントで「`cause !== "preload"` が preload を弾けるのは cached match だけで、アクティブなまま残る `/settings` レイアウトには効かない」まで書く** — 消しても型は通るオプションなので、効能の範囲を書き残さないと次に読む人が誤読する（ADR-003 Consequences）。**再取得は背景で走る**（`loaderShouldRunAsync && !sync && shouldReloadInBackground` の枝）ので、遷移は即座に settle し前回の一覧が表示されたまま置き換わる — `updateMatch` は `React.startTransition` の中で走るため、新しい断片 promise に差し替わってもスケルトンには戻らない（AC-8）。

### 4. `/settings` レイアウトのガードを `loader` へ移して子の断片と並列化する

- **対象ファイル:**
  - `apps/web/app/routes/settings/route.tsx`
  - `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`
- **変更内容:**
  1. `route.tsx`: `beforeLoad` を `loader` に置き換える。中身（`sessionUserFn()` → `null` なら `SIGNED_OUT_PATH` 判定 → `redirect`）はそのままで、`return { user }` / `return { user: null }` の形も変えない。`SettingsLayout` は `Route.useRouteContext()` → `Route.useLoaderData()`。**`shouldReload: ({ cause }) => cause !== "preload"` を足す。** ステップ 3-4 と同じく、このルートの `staleTime` は `shouldReload` があるかぎり参照されないので、残すならその旨のコメントを添える（落としてもよい）。

     `SIGNED_OUT_PATH` の分岐には、**判定のタイミングが変わったことを明記するコメントを置く**:

     ```ts
     // このレイアウト match は子ルート間の遷移でも生き残るので、`loader` は
     // ナビゲーションごとには走らない（`cause: "stay"` かつ
     // `previousRouteMatchId === match.id` で `staleMatchShouldReload` が偽）。
     // 上の `shouldReload` があって初めて再実行される。`location.pathname`
     // の分岐は「パスが変われば自動で再判定される」ものではない。
     ```
  2. `DeleteAccountPanel`: `useRouteContext({ from: "/settings" })` → `useLoaderData({ from: "/settings" })`。`user` が `null` になりうる扱いは変えない（`user?.userId` を ticket の退避キーに使う経路をそのまま維持する — AC-11）。
- **理由:** レイアウトのガードと子の断片は別 match なので 1 要求には畳めないが、`beforeLoad`（逐次）から `loader`（`Promise.all` で並列）へ移すだけで直列 2 段が 1 段になる。

  **この loader は本物のブロッキング loader である。** 断片ブリッジと違って `sessionUserFn()` を await して値を返すので、`/settings/*` への遷移はガード応答を待って settle する（`/notes` 系のようにブリッジ応答の完了前には settle しない）。`CLAUDE.md` の区別でいえば `/settings/*` は「本当にブロックする loader を持つルート」側であり、ガード応答が 200ms を超えれば `router.tsx` の `defaultPendingComponent` + `defaultPendingMs: 200` を踏む。**これは本 Issue が新しく作る副作用ではない** — 変更前の `beforeLoad` も `sessionUserFn()` を await しており、その待ち時間にも `defaultPendingMs` は掛かっていた。本 Issue が変えるのは待ち時間の長さ（3 段 → 1 段）だけで、むしろ短くなる。ここで押さえるべきは「`/notes` 系と期待値が違う」ことだけであり、AC-9a（`/notes` 系）と AC-9b（`/settings/profile`）を分けてあるのはそのため。`/settings` に AC-9a を当てはめてはいけない。実測では「変更前後で `defaultPendingComponent` の有無が変わった」と記録しないこと。
  **ここで「`SIGNED_OUT_PATH` の分岐は `loader` の `location` からも同じに書ける」と考えないこと。** `beforeLoad` はナビゲーションごとに必ず走るが、`loader` は match 単位でしか走らない。レイアウト match は子ルート間遷移で生き残るため、`shouldReload` が無ければ **DEV（`staleTime: 0`）でも再実行されない**（`load-matches.js:434` の `cause === "enter" || previousRouteMatchId !== match.id` を満たさない）。`shouldReload` を入れることで挙動は `beforeLoad` と等価に戻るが、**分岐の意味は「レイアウト match の生存期間で 1 回」ではなく「`shouldReload` が明示的に毎回走らせている」に変わる**ので、コメントで固定する。

  もう 1 点、`/settings/` index ルート（`routes/settings/index.tsx`）は `beforeLoad` で `/settings/profile` へ redirect する。`loadMatches` は `beforeLoad` ループを先に回すので、レイアウトのガードが `loader` へ移ると **index の redirect が認証判定より先に throw される**。結果、未サインインで `/settings` を開くと `/signin?redirect=/settings/profile` に着く（変更前は `/signin?redirect=/settings`）。最終的な着地は同じだが観測値が変わるので、AC-6a に期待値として書いてある。

### 5. 使われなくなったガードを畳む

- **対象ファイル:**
  - `apps/web/app/presentation/auth.ts`
  - `apps/web/app/routes/settings/route.tsx`
  - `apps/web/app/routes/signin.tsx`
- **変更内容:**
  - `auth.ts` から `requireAuthenticated` を削除する。あわせて `safeRedirectPath` の**再輸出も外す**（`export { safeRedirectPath }` の行）。
  - **再輸出を読んでいるのは 2 箇所**（`grep` で確認済み）: `routes/settings/route.tsx:6` と `routes/signin.tsx:5`（`SignInForm redirectTo={safeRedirectPath(redirect)}`）。両方を `@/presentation/redirect` からの直接 import に切り替える。`signin.tsx` は本 Issue の主題（ナビゲーションの往復）と無関係な公開ルートだが、再輸出を畳む以上ここも触る — 差分レビューで「なぜ signin を触ったのか」が読めるよう、対象ファイルとして明示しておく。`pnpm typecheck` で必ず出るとはいえ、手順書としては先に挙げておく。
  - 結果、`auth.ts` に残るのは `sessionUserFn`（`routes/index.tsx` のトップと `routes/settings/route.tsx` が使う）だけになる。
- **理由:** ステップ 3・4 で `requireAuthenticated` の呼び出し元が消える。残すと「どちらのガードを使うのか」が 2 通りになり、次に画面を足す人が古い形を写す。`pnpm lint` は未使用 export を落とさないので、削除したことは AC-14（`grep` で参照が残っていない）で担保する。**AC-14 はこのステップだけでは閉じない** — `docs/frontend_implementation_example.md` に `requireAuthenticated` が 4 箇所残るので、ステップ 6 とセットで初めて `grep` が通る。再輸出を畳むのは、`auth.ts` が `sessionUserFn` 1 本のモジュールに戻って責務が読めるようにするため。

### 6. ドキュメントを実態に合わせる

- **対象ファイル:** `docs/frontend_implementation_example.md`
- **`requireAuthenticated` はこのファイルに 4 箇所ある。** 4 つすべてを潰さないと AC-14（`grep` で参照が残らない）が通らず、AC-13（二重化の記述が残っていない）も L.545 が生き残って不合格になる。**AC-13 と AC-14 は同じ節（L.482-546）に共依存している。**

  | 出現 | 節 | 扱い |
  |---|---|---|
  | L.79 | `#### Streaming variant`（L.46-118）のコード例 | 下記 1 |
  | L.113 | 同節の「二重化」本文 | 下記 2 |
  | L.433 | `## Route definition (a thin proxy that pulls in an RSC)`（L.393-481）の `$noteId.tsx` 例 | 下記 3 |
  | L.531 | `## Shared server logic (authentication helper)`（L.482-546）— `requireAuthenticated` の**実装全文の掲載** | 下記 4 |
  | L.545 | 同節の締め（「the guard makes navigation land on `/signin`, the in-handler check makes a direct POST return 401」= L.113 と同一の主張） | 下記 4 |

- **変更内容:**
  1. 「RSC owner patterns → 1. Held by the route loader → Streaming variant」のコード例（L.50-101）から `beforeLoad` ガードを外し、ブリッジが `{ user, Fragment }` を返して未サインインなら `redirect` を throw する形に差し替える。ルート側の `Route.useRouteContext()` も `Route.useLoaderData()` に直す。
  2. L.113 の「Because the route guard (`beforeLoad`) redirects but a bare server-function call cannot, each bridge also calls `requireSession()` inside its handler — defense in depth」を、統合後の分担に書き換える。要点:
     - ガードと断片が同じ match のルートは、ブリッジがセッションを解決して redirect まで出す（1 要求）
     - レイアウトがガードを持ち子が断片を持つ形（`/settings`）は、ガードを `loader` に置いて並列にする（2 要求 / 1 段）
     - どちらの形でも**権限判定の権威はハンドラー側**であり、ルートの `beforeLoad` は権威ではない
     - ガードを `loader` に置いたら `shouldReload` を必ず添える（`staleTime` と match の生存に鮮度を支配させない）
     - 畳んだブリッジが返すのは「セッション無し → redirect」であって 401 ではない。**主体が無効（削除中／削除済み）なら引き続き 401** が出る（`sessionUserOrNull` は `UNAUTHENTICATED` だけを飲み込む）。この 2 系統を書き分ける
  3. **`## Route definition (a thin proxy that pulls in an RSC)`（L.393-481）の `$noteId.tsx` 例**（L.427-472）から `beforeLoad` ガード（L.432-435）を外し、`loader` を「遷移元パスをブリッジへ渡し、ブリッジ側が redirect を throw する」形へ差し替える。同じ節のブリッジ例（L.397-425）にも `redirect` 入力と `requireSessionOrRedirect` を反映する。
  4. **`## Shared server logic (authentication helper)`（L.482-546）を書き換える。**
     - L.519-543 の `requireAuthenticated` の掲載（導入文 + コードブロック）を落とす。掲載を残すと AC-14 の `grep` が通らない。
     - 代わりに `auth.ts`（セッション probe = `sessionUserFn`）/ `session.ts`（Cookie 運搬 = `requireSession` / `sessionUserOrNull`）/ `sessionGuard.ts`（誘導 = `requireSessionOrRedirect`）の **3 分担**を書く（ステップ 2 の置き場所の理由と同じ内容）。
     - L.545 の「the pair is intentional, not redundant: the guard makes navigation land on `/signin`, the in-handler check makes a direct POST return 401」を、統合後の分担へ差し替える。**ここを残すと AC-13 が不合格になる**（L.113 とまったく同じ主張なので、L.113 だけ直しても二重化の記述は消えない）。
- **理由:** `CLAUDE.md` が `docs/frontend_implementation_example.md` を「worked patterns」として指しており、ここが古いと次のスライスが 3 往復の形を再生産する。AC-13 と AC-14（docs 側 4 箇所）の対象。

### 7. 検証

- **変更内容:**
  1. `pnpm typecheck && pnpm lint:fix && pnpm format`
  2. `pnpm test`
  3. plan.md「テスト方針 → 手動」の手順で `main` と本ブランチの `_serverFn` 要求数・`Start Time` を実測し、変更前 / 変更後の表と HAR を `.thread/13/` に残す（AC-1〜AC-4）。**preload 分は別欄**、本数は preload 完了後のクリック以降だけを数える（前置きの計測条件）。
  4. `<head>` の一致確認（AC-5）、未サインイン経路（AC-6a / AC-11）、**別タブサインアウト（AC-6b）を DEV と本番の両方で**、SSR 直開きの 307 確認、open-redirect（AC-7、2049 文字は **422**）、本番ビルドでのキャッシュ挙動（AC-8）、スケルトンの出るタイミング（`/notes` は応答完了前 = AC-9a、`/settings/profile` はガード応答後 = AC-9b）、上部バーの表示（AC-12）、ドキュメント（AC-13 = 二重化の記述が L.113 と L.545 の**両方**から消えていること）、`grep`（AC-14 = コード側 + docs 側 4 箇所）。

     **AC-6b の順序を守ること:** タブ A で `/notes` → `/notes/:id` と遷移して**両方を訪問済みにしてから**タブ B でサインアウトし、タブ A で**戻る**。サインアウトを先に済ませると `/notes/$noteId`（`/notes/` の子ではなく**兄弟ルート**。`routes/notes/route.tsx` は存在しない）が新規 match として `shouldReload` を参照せずに loader を走らせ、`/signin?redirect=/notes/$noteId` に着いてしまい、ADR-003 が閉じた「既訪 match」の経路を踏まない。
  5. **`shouldReload` の有無を判別できる観測点は 2 つだけ**であることを踏まえて記録する: **AC-6b の本番実行**（`staleTime: Infinity` なので `shouldReload` を外すと再取得が起きず一覧が残る）と **AC-3b（`/settings` タブ間）**（DEV でも `cause: "stay"` / `previousRouteMatchId === match.id` で再実行されないので差が出る）。AC-6b の DEV 実行は `cause === "enter"` だけで `staleMatchShouldReload` が真になるため差が出ず、「環境差が消えたこと」の確認としてのみ記録する。
- **理由:** 本 Issue の成果は「往復が減ったこと」そのものなので、数値を残さないと達成を主張できない。AC-6b を環境を分けて 2 回測るのは、DEV と本番で結果が揃うこと自体が ADR-003 の目的だから。
