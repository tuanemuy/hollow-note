# ADR — Issue #13: ナビゲーションごとの RPC 3往復を削減する

## ADR-001: `AppConfig` は root の `loader` ではなくルーターコンテキストで運ぶ

### Context

root の `beforeLoad` が `loadAppContext()` を呼んでおり、`beforeLoad` は `staleTime` を見ないためクライアント遷移のたびに 1 往復する（`router-core` の `load-matches.js`: `handleBeforeLoad` にキャッシュ判定はなく、`shouldSkipLoader` はハイドレーション済み match をスキップするだけ）。

Issue が挙げた案は「root `loader` へ移して `staleTime` を効かせる」。しかしこれは成立しない。`head` に渡る `AssetFnContextOptions` のうち、

- `match` / `loaderData` は `router.getMatch(matchId)` でライブに取り直される
- `matches` は `loadMatches` に渡ったスナップショット配列（`stores.pendingMatches.get()`）で、`updateMatch` は各 match ストアに**新しいオブジェクト**を書くため、配列要素は更新されない

したがって子ルートの `head` から root の `loaderData` は読めない。`match.context?.config` を読む `head` は 17 箇所あり、全部を `matches` 経由へ書き換えると壊れる。Issue が「head 生成を巻き込むルーティング契約の変更になる」と警戒していた正体はこれである。

選択肢は 4 つあった。

1. root `loader` + 子ルートの `head` を `matches[0].loaderData` 経由に書き換える
2. クライアント側でモジュールスコープにメモ化し、セッション中 1 回だけ引く
3. `AppConfig` をルーターコンテキストに載せ、SSR ペイロード（`dehydrate` / `hydrate`）でクライアントへ渡す
4. `packages/core/src/config.ts` の静的部分をクライアントで直接 import し、`appUrl` / `twitterHandle` だけを別経路で運ぶ

### Decision

**3 を採る。** `createRootRouteWithContext<RouterContext>()` にし、`getRouter()` が `createRouter({ context: { config } })` を渡す。サーバーでは `getRouter()` が要求ごとに `await` されるので `getContainer()` から引ける（`start-server-core` の `createStartHandler` が `await entries.routerEntry.getRouter()`、`server.node.ts` が `storage.run(container, () => entry.fetch(request))` で包んでいる）。クライアントでは `getRouter()` がハイドレーション時に 1 回 `await` されるが値を持てないので、ルーターの `dehydrate` で SSR ペイロードに 1 回だけ載せ、`hydrate` で `router.update({ context })` する。`router.options.hydrate` はクライアントで `matchRoutes` より**前**に走るため、最初のクライアント遷移から効く。

型は **`RouterContext = { config: AppConfig | undefined }`**（省略可能プロパティではなく `undefined` を明示的に含む形）にする。`apps/web/tsconfig.json` は `exactOptionalPropertyTypes: true` なので、`{ config?: AppConfig }` にすると `AppConfig | undefined` の代入が `TS1360` で落ちる（`createRouter({ context })` と `hydrate` 内の `router.update({ context })` の両方で）。`head` 側の `match.context?.config` はどちらの形でも通る。

根拠は往復数だけではない。`spec/presentation/index.md` は `AppConfig` を「起動時に環境から解決される読み取り専用の設定」＝ SSR メタデータと定めている。**要求ごとに変わらない値を要求ごとに運んでいたことが誤りで、`beforeLoad` か `loader` かはその症状**である。ルーターコンテキストは「ルーターの生存期間ずっと同じ値」の置き場であり、意味が一致する。

1 を採らないのは上記のとおり `matches` がスナップショットだから。2 は「セッション中 1 回」までしか減らず、サーバー側にモジュールスコープのキャッシュを持ち込むと将来の要求スコープ付き構成（Cloudflare Workers）で正しさの根拠が変わる。4 は同じ 1 つの値が 2 経路（クライアント直 import と SSR 転送）に割れ、`AppConfig` の正本が DI であるという分担を崩す。

### Consequences

- 良い点: `match.context?.config` を読む 17 箇所の `head` が**無変更**で通る。クライアント遷移での config 往復が 0 になる（セッション初回も含めて 0）。`loadAppContext` という server function がひとつ消える。
- トレードオフ: `getRouter()` が async になり、`declare module` の `Register.router` を `Awaited<ReturnType<typeof getRouter>>` にする必要がある。宣言は 2 系統あり、`routeTree.gen.ts:430-438`（`@tanstack/react-start` 側・自動生成）は既に `Awaited` 済みで、手書きの `router.tsx:33-37`（`@tanstack/react-router` 側）だけを直す。忘れるとアプリ全域のルーター型が壊れる（typecheck で出る）。
- トレードオフ: `getRouter()` がサーバーで要求スコープ（AsyncLocalStorage）の内側にいることに依存する。prerender / shell 生成を導入すると要求スコープ外で走りうるので、そのときはここが最初に壊れる。`head` 側は `if (!config) return {}` のガードを持っているので、致命ではなく「メタデータが出ない」に落ちる設計にはなっている。
- トレードオフ: **`getRouter()` の呼び出し経路が ADR-002 の実装で 1 つ増える。** `createStartHandler` は `getRouter()` を (a) `handleServerRoutes`（すべてのドキュメント要求とサーバールート要求 — `/storage/$` のアバター配信を含む）と (b) `handleRedirectResponse`（未解決 redirect の解決時）で呼ぶ。(b) は現状どの server function も redirect を throw しないので発火していないが、ADR-002 で `renderNoteList` / `renderNoteDetail` が redirect を throw するようになると、**未サインインの断片要求のたびにルーターツリー構築 + `resolveAppConfig()` → `getContainer()` が走る**。いずれも `storage.run(...)` の内側なので動作はするが、上の「要求スコープ依存」の適用範囲が広がる。
- トレードオフ: `router.tsx` がクライアントバンドルに入るため、`containerStore` は `createIsomorphicFn().server(...)` の中で動的 import する必要がある。静的 import に戻すとサーバー DI グラフがクライアントへ漏れる。
- 前提: **`AppConfig` に秘密を入れないことが、この転送の前提になる。** `dehydrate: () => ({ config })` は未サインインの公開ページを含む全ページの SSR ペイロードに `AppConfig` 全体を無条件で載せる。露出量そのものは現状の `loadAppContext`（root の `beforeLoad` が全ページで引いている）と同じで本 Issue で増えるわけではないが、これまでは「要求ごとに引く値」だったものが「SSR ペイロードに焼かれる値」になる。`di/types.ts` の `DeletionTicketKeyRing` の JSDoc は既に「削除チケットの鍵は `AppConfig` の一部ではない — `AppConfig` は SSR メタデータである」と明言しているが、`spec/presentation/index.md` の `AppConfig` 節は署名鍵・暗号鍵の供給元として `AppConfig` を挙げており canon 側はそう読める。`AppConfig` を拡張する人がこの前提に気づける必要がある。

---

## ADR-002: 認証ガードは断片ブリッジへ畳む。畳めない形は並列化にとどめる

### Context

ルートの `beforeLoad` が `sessionUserFn()` を呼び、そのあと `loader` が `renderNoteList()` / `renderNoteDetail()` を呼ぶ。`loadMatches` は `beforeLoad` を match 順に逐次実行し、そのループが全部終わってから `loader` を `Promise.all` で走らせるので、この 2 つは必ず直列になる。しかも断片ブリッジは**ハンドラーの中で `requireSession()` を再度通している**（同じセッションを 2 回解決している）。

Issue は「断片側で 401 を返す設計にするか」と書いているが、`spec/presentation/index.md` の HTTP ステータス表は既に `ValidationError("UNAUTHENTICATED")` → 401 を定め、「クライアントはサインインへ誘導する必要があり」と書いている。**401 を返すこと自体は決着済みで、未決なのは「誘導（`/signin` への redirect）を誰が出すか」だけ**だった。

選択肢:

1. 現状維持（ガードは `beforeLoad`、断片は `loader`）— 直列 2 段
2. ガードと断片を `loader` の中で `Promise.all` する — 2 要求 / 1 段、セッションは 2 回解決される
3. ガードを断片ブリッジへ畳む（ブリッジが `{ user, 断片 }` を返し、未サインインなら `redirect` を throw）— 1 要求 / 1 段
4. 断片は 401 を返すだけにして、loader が `catch` して redirect に変換する — 1 要求 / 1 段、ただし loader に `try / catch`

### Decision

**ガードと断片が同じ match にあるルート（`/notes`, `/notes/$noteId`）は 3 を採る。** ブリッジがセッションを解決し、無ければ `redirect({ to: "/signin", search: { redirect: safeRedirectPath(...) } })` を throw する。遷移元パスは server function の入力として運び、`.validator(validateInput(schema))` で形と長さ、`safeRedirectPath` で値の安全（オープンリダイレクト）を見る。

**ガードと断片が別 match にあるルート（`/settings` レイアウト + 子）は 2 の形にとどめる。** レイアウトのガードを `beforeLoad` から `loader` へ移すだけで、子の断片 loader と `Promise.all` で並列になる（2 要求 / 1 段）。レイアウトは子の loaderData を読めないので、3 は構造的に取れない。

どちらの形でも、`loader` へ移したガードには `shouldReload` を添える（ADR-003）。

判断の根拠は「**権限判定の権威は元々ハンドラー側にしかない**」ことである。ルートの `beforeLoad` はクライアントから直接叩ける以上、防御ではなく導線であり、ハンドラー側の `requireSession()` こそが権威だった。したがってガードをハンドラーへ畳んでも防御は 1 段も減らない — 減るのは重複した導線のほうである。

4 を採らないのは、`docs/frontend_implementation_example.md` が「loader は RSC ペイロードを引くだけの薄い代理」と定め、`CLAUDE.md` が「Avoid broad `try / catch` in ordinary application logic」としているため。redirect の判断はセッションの判定と同じ場所にあるほうが素直である。

### Consequences

- 良い点: `/notes` 系はクライアント遷移 1 回につき server function 1 要求 / 1 段。セッションの二重解決も消える。
- 良い点: `/settings/*` は 3 段 → 1 段（2 要求並列）。
- **`renderNoteList` / `renderNoteDetail` は未サインイン時に 401 を返さなくなる。** 上の Context に「401 を返すこと自体は決着済み」と書いたが、それは `spec/presentation/index.md` の状態表が有効という意味であって、この 2 本が 401 を返し続けるという意味ではない。**本決定はこの 2 本の 401 を redirect に置き換える。** 現状この 2 本は `requireSession()` の `ValidationError("UNAUTHENTICATED")` → 401（`spec/presentation/index.md:213`）を返す唯一の断片ブリッジ経路であり、畳み込み後に 401 を返す断片ブリッジは `/settings` 系だけになる（ミューテーション系はそのまま）。なお `presentation/session.ts:126-138` の `sessionUserOrNull` は `code === "UNAUTHENTICATED"` **だけ**を飲み込んで `null` を返すので、削除中／削除済み主体の `UnauthorizedError` は `requireSessionOrRedirect` を素通りして引き続き 401 として出る。**「セッション無し → redirect」「主体が無効 → 401」の 2 系統が残る**ことまで書いておかないと、次に画面を足す人が「ブリッジは常に redirect」と誤読する。
- **`SIGNED_OUT_PATH`（`/settings/danger` は未サインインでも開ける）の分岐は、`loader` の `location` から「そのまま同じに」は書けない。** `beforeLoad` はナビゲーションごとに必ず走るが、`loader` は match 単位でしか走らない。`/settings` レイアウト match は子ルート間の遷移で生き残るため `cause: "stay"` かつ `previousRouteMatchId === match.id` になり、`load-matches.js:434` の `staleMatchShouldReload` が `staleTime: 0` でも偽になる。ADR-003 の `shouldReload` を入れれば挙動は `beforeLoad` と等価に戻るが、**「パスが変われば自動で再判定される」という読み方は成り立たない**（再判定しているのは `shouldReload` であって `location` ではない）ので、コード側にコメントで固定する。今の UI は `user === null` のとき `SettingsTabs` を出さないので実害の経路は塞がっているが、次に画面を足す人が踏む形になっている。
- トレードオフ: `/settings` で未サインインのとき、子の断片 loader が並列に発火して 401 を 1 本無駄に打つ。`loadMatches` は走査順（親が index 0）で redirect を先に throw するので遷移は正しく `/signin` へ行くが、Network には 401 が残る。SSR 直開きでも同じ並列が起き、`errorResponseMiddleware` が `setResponseStatus(401)` を呼ぶが、`executeRouter` は `routerInstance.state.redirect`（307 の `Response`）をそのまま返すのでドキュメント応答は 307 になるはず — **現状は起きていない組み合わせなので実機で 1 回確認する**。
- トレードオフ: `/settings/` index ルートの `beforeLoad`（`/settings/profile` への redirect）はレイアウトの `loader` より先に走るので、未サインインで `/settings` を開いたときの着地が `/signin?redirect=/settings` から `/signin?redirect=/settings/profile` に変わる。最終的な着地は同じ。
- トレードオフ: 遷移元パスがクライアント → サーバーへ運ばれるようになる。オープンリダイレクトの判定（`safeRedirectPath`）は今もクライアント側の `requireAuthenticated` で行っていたので判定自体は増えないが、**転送境界を越える入力が 1 つ増える**ので `.validator` を必ず通す。判定の中身は ADR-004 でドメインの述語へ委譲する。
- トレードオフ: server function からの `redirect` throw には `start-server-core` の `handleRedirectResponse` の制約が掛かる — `to` は絶対パス、`search` は関数ではなく静的な値。将来ここを関数形にすると SSR 側で throw する。
- 影響: `docs/frontend_implementation_example.md` の「ルートガードは redirect、ハンドラーは 401 の二重化」という記述が事実と食い違うので、2 つの形（畳む / 並列にする）とその使い分け、および `shouldReload` の必須性に書き換える。**この主張は同ファイルに 2 箇所ある**（L.113 の `#### Streaming variant` 節と、L.545 の `## Shared server logic (authentication helper)` 節の締め — 後者は「the guard makes navigation land on `/signin`, the in-handler check makes a direct POST return 401」で前者と同一の主張）。あわせて `requireAuthenticated` の出現は **4 箇所**（L.79 / L.433 / L.531 / L.545）で、L.531 は**実装全文の掲載**である。ドキュメント側の作業範囲はこの 4 箇所と 3 つの節（L.46-118 / L.393-481 / L.482-546）に及ぶ（steps.md ステップ 6）。この分担は本 Issue のあとに画面を足す人が必ず参照するので、`spec/presentation/index.md` か `CLAUDE.md` のフロントエンド節へ昇格させるべきかは片付けフェーズの昇格ゲートで判定する。

---

## ADR-003: `loader` へ移したガードは `shouldReload` で `staleTime` から切り離す

### Context

ADR-002 でガードを `beforeLoad` から `loader`（またはブリッジを呼ぶ loader）へ移す。ここで**捨ててはいけない性質を捨てかけていた**。

`beforeLoad` は `shouldSkipLoader`（ハイドレーション済み / `ssr: false`）以外に一切のキャッシュ判定を持たず、**毎ナビゲーション必ず走る**。本計画が「往復 1 を削れる」根拠にしているのもこの性質である。一方 `loader` の再実行は `handleLoader`（`@tanstack/router-core@1.171.15` `dist/esm/load-matches.js:431-435`）が決める:

```js
const shouldReload = typeof shouldReloadOption === "function" ? shouldReloadOption(...) : shouldReloadOption;
const staleMatchShouldReload = age >= staleAge && (!!inner.forceStaleReload || match.cause === "enter"
  || (previousRouteMatchId !== undefined && previousRouteMatchId !== match.id));
loaderShouldRunAsync = status === "success" && (invalid || (shouldReload ?? staleMatchShouldReload));
```

素直に移すと 2 つの経路で壊れる。

1. **本番ビルドの既訪 match。** `staleAge = route.options.staleTime ?? ... ?? 0` は本番で `Infinity` なので `age >= staleAge` が偽 → 一度訪れた `/notes` match に戻るとガードが二度と走らない。**別タブ / 別デバイスでサインアウトした利用者が、キャッシュ済みの `/notes` を見続けられる。** ADR 030 の「サインアウトはフル遷移でページごと破棄する」は**そのタブのルーターにしか及ばない**ので、別タブ経路は救えない。
2. **`/settings` レイアウト match（DEV も含む）。** 子ルート間の遷移でレイアウト match は生き残るので `cause: "stay"` かつ `previousRouteMatchId === match.id`、`forceStaleReload` は同一 href の再読み込みでしか立たない。したがって `staleAge` が 0 でも `staleMatchShouldReload` は偽で、**`staleTime: 0` の DEV でもレイアウトの loader は再実行されない**。

選択肢:

1. 何もせず、「本番の既訪 match ではガードが再判定されない」を既知の挙動差として受け入れる
2. 認証ルートの `staleTime` を 0 にする
3. ガードを載せた loader を持つルートにだけ `shouldReload` を置く
4. ガードだけ `beforeLoad` に残す（= ADR-002 を撤回する）

### Decision

**3 を採る。** `/notes/`, `/notes/$noteId`, `/settings` に

```ts
shouldReload: ({ cause }) => cause !== "preload",
```

を置く。上の式のとおり `shouldReload ?? staleMatchShouldReload` は `shouldReload` が非 `undefined` なら**それだけで決まる**ので、`staleTime` も `cause` / `previousRouteMatchId` の条件も丸ごと迂回する。結果、`beforeLoad` が持っていた「毎ナビゲーション再判定」がそのまま戻り、経路 1・2 の両方が閉じる。しかも**同じ 1 つの仕掛けで閉じる**。

**真偽値の `true` ではなく関数形にする。ただし関数形の効能は 3 ルート中 2 ルートにしか及ばない。** `handleLoader` は preload 経路でも同じ式を通るため、`shouldReload: true` だと `preloadStaleTime`（既定 30 秒）まで無効化され、`defaultPreload: "intent"` の下で**読み込み済みの** match にホバーするたびガード + 断片の要求が飛ぶ。`cause !== "preload"` は preload のときだけ `false` を返し、`false ?? x` は `false` なので「読み込み済み match の preload は何もしない」に落ちる（未読み込みなら `status !== "success"` の枝でそのまま走る）。

**この抑止が効くのは cached match、つまり `/notes/` と `/notes/$noteId` だけである。** `resolvePreload`（`src/load-matches.ts:53-55`）は

```js
inner.preload && !router.stores.matchStores.has(matchId)
```

で、`matchStores` は**アクティブ match のプール**（`src/stores.ts:125` / `setMatches` → `reconcileMatchPool` 259-267。cached は `cachedMatchStores` に分かれている）。したがって `/settings/profile` にいる状態で `/settings/auth` を preload すると、`/settings` レイアウト match はアクティブなので `preload = false` になり、`getLoaderContext`（同 607-639）が渡す `cause` は `"preload"` ではなく match 自身の `cause` = `"stay"`（`src/router.ts:1473-1478,1589` — `previousMatch` はアクティブ match を routeId で引いたもの）。`shouldReload({ cause: "stay" })` は **true** を返し、`SettingsTabs` のタブにホバーするたびレイアウトのガード要求が 1 本飛ぶ。**`LoaderFnContext` には preload を見分ける別の手掛かりが無い**（`preload` フィールドも同じ `resolvePreload` 由来なので同様に `false`）ので、`shouldReload` の書き方をどう変えてもこの経路は閉じられない。

**それでもこの決定は成立する。本数として後退しないからである。** `executeBeforeLoad`（同 388-531）にはキャッシュ判定が無く、`handleBeforeLoad` も `shouldSkipLoader` しか見ないので、**現行の `beforeLoad` ガードも今すでにホバーのたび飛んでいる**。`shouldReload` は「毎ナビゲーション再判定」という本来の目的を 3 ルートすべてで果たしており、失われるのは「preload では鳴らさない」という副次効果が `/settings` に及ばないという一点だけである。`/settings` タブの preload を止める手（`SettingsTabs` の `<Link>` に `preload={false}`）は採らない — 子の断片ルート（`/settings/{profile,auth,usage}`）の preload は本番（`staleTime: Infinity` かつ `shouldReload` なし）でクリック時にそのまま再利用されており、それを一緒に捨てることになるため。

`staleTime` 自体は据え置く。子の断片ルート（`/settings/{profile,auth,usage}`）はガードを持たないので、`staleTime: Infinity` の恩恵をそのまま受ける。

**ただし「据え置く」が意味を持つのは子の断片ルート側だけである。** `shouldReload` を置いた 3 ルート（`/notes/`, `/notes/$noteId`, `/settings`）では `shouldReload ?? staleMatchShouldReload` の左辺が常に非 `undefined` になるので、**`staleTime` も `preloadStaleTime` も一切参照されなくなる**。これは本決定の副作用であって偶然ではない — ガードの鮮度を `staleTime` から切り離すことが目的である以上、同じルートの `staleTime` が死ぬのは当然の帰結である。`shouldReload` 自体と同じく「消しても型は通り、書いた人にしか意味が伝わらない」誤読リスクが `staleTime` 側にも立つので、3 ルートに `staleTime` の行を残す場合は「この `staleTime` は `shouldReload` があるかぎり参照されない」を 1 行添える（行ごと落とす判断も可）。

1 は採らない。**それは既存挙動の後退**であり、「認証状態の遷移はキャッシュを跨がない」という ADR 030 由来の受容根拠が別タブ経路には及ばないことが判明した以上、受容の前提が崩れている。2 は `/settings` レイアウト（経路 2）を閉じられず、しかも断片のキャッシュまで一緒に捨てる。4 は本 Issue の目的そのものを捨てる。

### canon の [ADR 030](../../../spec/adr/030-auth-state-transition-transport.md) が退けた代替案との関係

ADR 030 は代替案「認証済みルートの loader キャッシュを無効にする」を挙げ、「残存の問題は消えるが、通常の閲覧のたびに再取得が発生し、キャッシュの利点を全経路で失う」として退けている。本 ADR の `shouldReload` は、その代替案と**表面的には同じ状態**（毎ナビゲーション再取得）を作るので、前提の食い違いをここで潰しておく。

退けられた案と本決定の違いは 3 点ある。

1. **対象が「認証済みルート全体」ではなく、ガードを載せた 3 ルートに限られる。** 子の断片ルート（`/settings/{profile,auth,usage}`）は `staleTime: Infinity` のまま据え置かれ、キャッシュの利点を失わない。ADR 030 が嫌った「全経路で失う」は起きない。
2. **再取得が blocking ではなく背景である。** `loaderShouldRunAsync && !inner.sync && shouldReloadInBackground` の枝（`src/load-matches.ts:829-848`）に落ちるので、遷移は即座に settle し前回の `loaderData` が表示されたまま置き換わる。ADR 030 が想定していた「通常の閲覧のたびに再取得が発生する」体感上のコストは、待ち時間としては表に出ない。
3. **本数は変更前より減る。** ガードと断片が同じ要求に畳まれているため、再訪でも 2 本（root の `loadAppContext` + `beforeLoad` の `sessionUserFn`）→ 1 本になる。ADR 030 の代替案は「キャッシュを捨てて要求を増やす」方向だったが、本決定は「キャッシュに頼らず、かつ要求を減らす」方向である。

つまり ADR 030 の判断（キャッシュ全域を捨てる案は割に合わない）は今も有効で、本決定はその判断を覆していない。`spec/adr/index.md` への昇格を判断するときは、この 3 点が昇格ゲートの前提になる。

### Consequences

- 良い点: **AC-6（未サインイン → `/signin`）が DEV と本番で同じ結果になる。** 環境で挙動が割れる基準を書かずに済む。
- 良い点: `/settings` のタブ間遷移でもレイアウトのガードが走るので、`SIGNED_OUT_PATH` の分岐が「match が生まれた時のパスで 1 回だけ固定される」状態にならない。
- 良い点: 対処が 1 行 / 3 ルートで、`staleTime` の設計にも断片の契約にも触らない。
- トレードオフ: **`/notes` の再訪で `_serverFn` が 0 本にはならず 1 本になる。** ガードと断片が同じ要求に乗っている以上、ガードを毎回再判定することは断片も毎回取り直すことと同義である。ただし変更前の再訪も 2 本（root の `loadAppContext` + `beforeLoad` の `sessionUserFn`）だったので、**再訪でも 2 本 → 1 本の改善**であり後退はしていない。
- トレードオフ: その 1 本は**背景で走る**（`loaderShouldRunAsync && !inner.sync && shouldReloadInBackground` の枝。`shouldReloadInBackground` は `staleReloadMode` が `"blocking"` でない既定の場合に真）。したがって遷移は即座に settle し、前回の `loaderData` が表示されたまま置き換わる。新しい断片 promise へ差し替わる更新も `updateMatch` → `router.startTransition` → React の `startTransition` の中で起きるので、`<Suspense>` のフォールバック（スケルトン）には戻らない。**この「スケルトンに戻らない」は実測で確認する**（AC-8）。
- トレードオフ: 背景再取得なので、ガードが redirect を投げるのは描画のあとになる（`load-matches.js` の background 枝が `isRedirect(err)` を捕らえて `router.navigate` する）。別タブでサインアウトした利用者は、**一瞬キャッシュ済みの画面を見てから** `/signin` へ飛ぶ。ここを詰めるなら `loader: { handler, staleReloadMode: "blocking" }` にできるが、そうすると毎遷移がガードの応答を待つ blocking になり本 Issue の目的（体感の改善）と衝突するので採らない。
- トレードオフ: `shouldReload` の存在は**書いた人にしか意味が伝わらない**（消しても型は通り、DEV の `/notes` では挙動差も出ない — 出るのは本番の再訪と `/settings` のタブ間だけ）。3 ルートすべてにコメントで理由を添える。**書き忘れを落とす網は 2 つで、どちらも観測条件が厳しい**:
  - **AC-6b の本番実行。** 網の目が空きやすいので手順を固定してある — `/notes/$noteId` は `/notes/` の子ではなく**兄弟ルート**（`apps/web/app/routes/notes/route.tsx` は存在せず、`routeTree.gen.ts` の `rootRouteChildren` に並列に入る）なので、`/notes` を見た直後にサインアウトしてから `/notes/:id` をクリックすると、その match は**その時点で初めて作られる**（`cause: "enter"` かつ `status !== "success"`）。`src/load-matches.ts:848` の `status !== 'success' || loaderShouldRunAsync` 枝で `shouldReload` を参照せずに loader が走るため、`/signin?redirect=/notes/$noteId` に飛んで**本 ADR が閉じた経路を一度も踏まない**（＝ `shouldReload` が無くても「合格」する）。**`/notes` と `/notes/:id` の両方を訪問済みにしてからサインアウトし、既訪の `/notes` match へ戻る**形にすること。この形なら cached match（`status: "success"` / `cause: "enter"`）→ `shouldReload` → 背景再取得（同 829-848）→ redirect を同 843-847 が `router.navigate` で拾う、という本 ADR が想定した経路をそのまま通る。
  - **AC-3b（`/settings` タブ間）。** こちらは DEV でも差が出る（経路 2）。
  - **AC-6b の DEV 実行は判別に使えない。** `staleTime: 0` では `cause === "enter"` だけで `staleMatchShouldReload` が真になるので、`shouldReload` の有無で挙動が変わらない。DEV と本番の両方で測る手順にしてあるのは「**環境差が消えたこと**」の確認であって、`shouldReload` の有無を分けるためではない。
- トレードオフ: `/settings` はタブを切り替えるたびにガードの往復が 1 本走る。これは `beforeLoad` 時代と同じ本数であり増えてはいないが、「タブ間遷移は断片 1 本だけ」にはならない（AC-3b）。
- トレードオフ: **`/settings` タブへのホバーでもガードの往復が 1 本走る**（上記のとおり関数形では抑止できない）。これも `beforeLoad` 時代と同じ本数で後退はしていないが、「`shouldReload` を関数形にしたのだから preload では鳴らない」と読める書き方を**コードにもドキュメントにも残さない**こと。3 ルートに添えるコメントは「preload で抑止できるのは cached match（`/notes` 系）だけ」まで書く。
- トレードオフ: **`shouldReload` を置いたルートでは、preload の投機取得がクリック時に必ず捨てられる。** `/notes` から `/notes/$noteId` にホバーすると preload が 1 本走るが、クリック時の match は `cause: "enter"`（アクティブな previous match が無い）なので `shouldReload` が true を返し、`preloadStaleTime` 内でも取り直される（`src/load-matches.ts:824-826`）。`defaultPreload: "intent"` が体感の改善に寄与していた分を一部打ち消すので、「毎ナビゲーション再判定」の代償として明示しておく。後で preload を疑う人が同じ調査をやり直さずに済む。
- トレードオフ: **preload が in-flight のままクリックすると、その遷移ではガードが再判定されない。** `loadRouteMatch`（`src/load-matches.ts:893-904`）は `prevMatch._nonReactive.loaderPromise` があり `status === 'success' && !sync && !prevMatch.preload && shouldReloadInBackground` のとき `prevMatch` をそのまま返す。ガード自体は preload 側の背景ロードで走り、redirect も同 843-847 の背景枝が `router.navigate` で拾うので**挙動は壊れない**が、`_serverFn` の本数はその遷移で 1 本少なくなる。受け入れ基準の本数を実測で再現するには「preload の完了を待ってからクリックする」を計測条件に固定する必要があり、plan.md の前置きに書いてある。

---

## ADR-004: `safeRedirectPath` の述語を `SameOriginPolicy` へ委譲する

### Context

ADR-002 で、オープンリダイレクト判定（`presentation/redirect.ts` の `safeRedirectPath`）は**クライアント側の導線（`requireAuthenticated`）からサーバー側の転送境界（断片ブリッジ）へ移り、呼び出し点が 1 つ増える**。

一方 ADR 051（承認済み canon）は「認可の往復のあとに再生する遷移先は自オリジンに限る」を名指しで業務不変条件と位置づけ、「述語を 1 本にまとめてドメインに置く」と決め、代替案「転送境界で判定する」を明示的に退けている。にもかかわらず `packages/core/src/domain/identity/services/sameOriginPolicy.ts` の `SameOriginPolicy.isSameOriginPath` と `apps/web/app/presentation/redirect.ts` の `safeRedirectPath` は、3 つの回避形（`//host` / バックスラッシュ / 制御文字）の検査を**バイト単位で同じロジックとして 2 本持っている**。ADR 051 の「影響」欄に書かれた「1 箇所でしか判定されない」は既に事実ではない。

この重複は本 Issue が作ったものではないが、判定をセキュリティ境界へ移して呼び出し点を増やす以上、片方だけに知識が入る事故の被害は上がる。

### Decision

**`safeRedirectPath` の中身を `SameOriginPolicy.isSameOriginPath(value) ? value : "/notes"` に差し替える。** `redirect.ts` に残るのは「弾いたときどこへ倒すか」という導線の決定（`"/notes"`）だけになり、回避形の知識はドメインの述語 1 本に戻る。ADR 051 の「述語は真偽値だけを返す。どう倒すかは呼び出し側が決める」という分担とそのまま一致する。

**値オブジェクト（`SameOriginPath` 型で運ぶ）への移行までは踏み込まない。** ADR 051 の理想形はそちらだが、`?redirect=` の値は `validateSearch` から `redirect()` の `search` まで素の文字列として流れており、型を通すには route の search スキーマと `/signin` のコンポーネントまで巻き込む。本 Issue のフットプリント（転送境界とナビゲーション経路）を超えるので、`plan.md` のスコープ外に置く。

`presentation/__tests__/redirect.test.ts` は変更しない — 既存ケースがそのまま通ることが委譲の回帰網になる。

### Consequences

- 良い点: 回避形の知識が 1 本に戻り、ADR 051 の「影響」欄の記述が再び事実になる。差分は実質 1 行。
- 良い点: presentation → domain の依存方向なので、`CLAUDE.md` の内向き依存に沿う（`redirect.ts` は既に `@repo/core` を import できる層にいる）。
- トレードオフ: `redirect.ts` の「`createServerFn` も他のフレームワーク import も無い純関数モジュール」という性質は保たれるが、`@repo/core` への import が 1 本増える。ユニットテストはこれまでどおり `redirect.ts` を単体で import できる（`sameOriginPolicy.ts` は依存を持たない純関数）。
- トレードオフ: 値オブジェクト化は残る。`spec/adr/051` の理想形に対して「述語は 1 本、型はまだ」という中間状態が続く。
