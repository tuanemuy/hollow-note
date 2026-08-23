# PR Review #002 — ルーティング基盤・設定の受け渡し

**PR:** #36 / **base:** main / **Round:** 2回目（1回目の16件反映後をゼロベースで再レビュー）

## 1回目の指摘の再検証（先に結論）

| R1 の指摘 | 再検証結果 |
|---|---|
| B-001 タブのホバーだけで `/signin` へ実ナビゲート | **閉じている。** `staleReloadMode: "blocking"` により `shouldReloadInBackground` が `false`（`router-core@1.171.15` `src/load-matches.ts:861-865`）→ 背景枝 `835-848`（redirect を無条件に `router.navigate` する catch）へ落ちず `849` の `await runLoader` になる。redirect は `loadMatches` の `1030-1046` を抜けて `preloadRoute` の catch（`src/router.ts:2935-2945`）に着き、そこは `navigate` ではなく `preloadRoute(err.options)` なので `/signin` を preload するだけで遷移しない |
| W-001 `redirect` 上限超過で `/notes` が 500 | 閉じている。`boundedRedirectSource` が `location.href` を `REDIRECT_MAX_LENGTH` で clamp（ただし W-004 参照） |
| W-003 型は `undefined` を許すのに実装は throw | 閉じている（ただし W-002 / W-003 参照） |
| W-004 docs:839 の redirect 所在記述 | 閉じている（`docs:876` で `sessionGuard.ts` + 畳んだブリッジに更新） |
| W-005 `requireSessionOrRedirect` に自動テストが無い | 判定部分を `signInRedirectOptions` へ切り出して単体テスト化。委譲としては妥当 |
| W-006 死んだ `staleTime` | `/notes` 系・`/settings` から除去済み。`shouldReload ?? staleMatchShouldReload`（`load-matches.ts:824-826`）で右辺に落ちないという記述も正しい |

### 並列性・型・ハイドレーションの確認（退行なし）

- **AC-3a/3b の「2 本同時開始 / 1 段」は維持されている。** 並列性は `loadMatches` の `for (let i…) matchPromises.push(loadRouteMatch(...))`（`load-matches.ts:1025-1027`）が同一 tick で各 match の loader を同期的に着火することに由来し、`staleReloadMode` は「その先を await するか背景へ飛ばすか」しか変えない。`/settings` レイアウトの `handleLoader` → `runLoader` → `loader?.(...)`（`667`）は最初の await 前に `sessionUserFn()` を発火するので、直後のループ反復で走る子断片 loader と同じ tick で 2 本立つ。
- **`Route.useLoaderData()` の型推論はオブジェクト形でも壊れていない。** `ResolveRouteLoaderFn<TLoaderFn>` が `{ handler: infer THandler }` を剥がす（`router-core/src/route.ts:315-352`）。`pnpm typecheck` rc=0 で実測確認済み。
- **`AppConfig` のハイドレーション窓は無い。** `ssr-client.ts:99` の `await router.options.hydrate?.(dehydratedData)` は `102` の `matchRoutes` より前で、`hydrateStart.ts:24-59` は `await hydrate(router)` を終えてから router を返す。`buildMatchContext`（`load-matches.ts:66`）と `ssr-client.ts:182` はどちらも `router.options.context` を起点にするので、最初のクライアント遷移から `config` が入る。`router.update` は options をマージするだけ（`router.ts:1089-1092`）なので後続の framework 側 `update` でも落ちない。
- **クライアントバンドルへのサーバー DI 漏れは無い。** `handleCreateIsomorphicFn`（`start-plugin-core/src/start-compiler/handleCreateIsomorphicFn.ts:36`）が client ビルドでチェーン全体を `.client(...)` の内側関数へ置換するので、`await import("@repo/core/application/di/containerStore")` はクライアント側に残らない。
- **`head` の 17 箇所すべてに `config` ガードがある**（16 箇所が `if (!config) return {}`、`__root.tsx:41` だけ `return { links: baseLinks }` で stylesheet/favicon を維持）。`resolveAppConfig` が `undefined` を返しても `head` が throw する経路は無い。
- **`location.href` は必ずオリジン相対**（`router.ts:1326` / `1352-1355`）。`safeRedirectPath` の「`/` で始まること」判定が SSR 直開きでも成立し、AC-6a の `?redirect=<元のパス>` は壊れない。

---

## Blockers

- **[B-001]** `shouldReload` を常時真にしたことで、**本番でも `/notes` / `/notes/:id` へ戻るたびに断片 promise が差し替わり、解決済みの一覧がスケルトンへ巻き戻る**。AC-8 後半（「スケルトンに戻らない」）と、本 PR が新たに書いた 3 箇所の断定が同時に成立しない。
  - 場所: `apps/web/app/routes/notes/index.tsx:19`（同 `apps/web/app/routes/notes/$noteId.tsx:19`）、主張の側は `apps/web/app/routes/notes/index.tsx:16-17` のコメント / `docs/frontend_implementation_example.md:82-83`（"The re-fetch runs in the background, so the resolved list stays on screen instead of flashing back to the skeleton."）/ `plan.md` AC-8
  - 理由:
    1. 既訪 `/notes` match へ戻る遷移は `cause: "enter"` なので `shouldReload` が真、`status === 'success'` なので `loaderShouldRunAsync = true`（`load-matches.ts:824-826`）。関数形 loader は `shouldReloadInBackground = true`（`861-865`）なので背景枝 `835-848` に入り、遷移自体は即座に settle する — ここまでは計画どおり。
    2. しかし背景の `runLoader` が完走すると `inner.updateMatch(matchId, prev => ({ ...prev, loaderData }))`（`load-matches.ts:699-704`）で **loaderData ごと差し替わる**。新しい `loaderData.NoteList` は `renderServerFragment` の**未解決**の promise なので、`<Deferred promise={NoteList}>` の `use(promise)`（`apps/web/app/components/ui/Deferred/index.tsx`）が再サスペンドし、`<Suspense fallback={<NoteListSkeleton/>}>` が再び出る。
    3. この更新は React の transition の外で起きる。`router.load` は `this.startTransition(async () => {...})`（`router.ts:2471`）で包まれるが、`Transitioner.tsx:26-32` の実装は `React.startTransition(() => { fn(); setIsTransitioning(false) })` — 渡すコールバックが同期で thenable を返さないため、React 19 の async transition スコープに入らない。`await loadMatches(...)` 以降の store 更新はすべて非 transition の discrete update になり、サスペンドすれば fallback が出る。
    4. `main` との差はここに出る。`main` の `/notes` は `staleTime: Infinity`（本番）で `staleMatchShouldReload` が偽 → loader が再実行されず、解決済み promise がそのまま残るのでスケルトンに戻らなかった。ガードは `beforeLoad` が毎回撃っていたので鮮度と再判定が両立していた。本 PR は `staleTime` を外し `shouldReload` を常時真にしたので、**旧コメントが「MANDATORY」と書いて防いでいた失効モードそのもの**（`docs` の削除された旧文: "under `staleTime: 0` a revisit re-runs the loader, produces a fresh promise, and the Suspense boundary re-suspends — so the cached list flashes back to the skeleton on every back-navigation"）を本番へ持ち込んでいる。`docs:499` が「`shouldReload` は `staleTime` / `preloadStaleTime` に優先する」と正しく書いているのに、その帰結が `docs:82-83` の断定と噛み合っていない。
    - 補足: 失効時（背景再取得が redirect を投げる）経路はこの限りではない。`handleRedirectAndNotFound` が先に throw するので `loaderData` は更新されず、`spec/adr/030` に追記された「1 往復のあいだ直前の `loaderData` が表示されてから `/signin` へ遷移する」は正しい。問題になるのは**成功する再取得**、つまり通常のサインイン済みユーザーの戻る操作という最頻経路のほう。
  - 提案: まず AC-8 の本番実測（`pnpm build && pnpm start` → `/notes` → `/notes/:id` → 戻る）で、要求本数だけでなく **`NoteListSkeleton` が再表示されるか**を明示的に観測すること（現行の `testing.md` 手順 9 は「スケルトンに戻らない」を確認項目として持つので、そこで落ちるはず）。落ちた場合の選択肢は
    (a) `/notes` 系も `staleReloadMode: "blocking"` にして「戻るときは 1 往復ブロックしてから新しい一覧を出す」に倒す（スケルトンは出ないが遷移が待たされる。AC-8 の文面を書き換える必要がある）、
    (b) 差し替えを transition に載せる — 例えば `NotesPage` 側で `loaderData` の promise を `useDeferredValue` ではなく明示の `startTransition` 越しに持ち替える島を挟む（フレームワークの更新経路に手を入れられないので実効性は要検証）、
    (c) 「戻る操作では毎回スケルトンが出る」ことを受け入れ、**`notes/index.tsx:16-17` のコメント・`docs:82-83`・AC-8 の 3 箇所を同時に直す**。
    いずれにせよ、実測前に「背景だから戻らない」と 3 箇所へ書き切っている現状は、次の読み手が誤った前提で `shouldReload` を他ルートへ広げる導線になる。

## Warnings

- **[W-001]** `docs/frontend_implementation_example.md:342` の「`getRouter()` runs for requests that have no request scope (`/storage/$` and the other server routes)」が事実と逆。
  - 場所: `docs/frontend_implementation_example.md:342`（同趣旨の日本語版が `apps/web/app/presentation/appConfig.ts:22-26`）
  - 理由: `/storage/$` を含むすべての要求は `apps/web/app/server.node.ts:129` の `storage.run(container, () => entry.fetch(request))` の内側で処理され、`handleServerRoutes`（`start-server-core/src/createStartHandler.ts:762`）の `getRouter()` もその中で呼ばれる。実際 `apps/web/app/routes/storage.$.tsx:38` は同じ要求の中で `getContainer()` を呼んで成功しているのだから、「要求スコープを持たない」なら `/storage/$` は今日すでに全滅している。同じ段落の直前で `storage.$.tsx` を `getContainer()` 呼び出し側として列挙しているので、文書内でも自己矛盾している。さらに、本 PR が**新しく**作った `getRouter()` の呼び出し経路は `handleServerRoutes` ではなく `handleRedirectResponse`（`createStartHandler.ts:534,727`）— 未サインインの `/notes` ブリッジ要求が redirect を throw するたびにルーターツリー構築 + `resolveAppConfig()` が走る — で、そちらは記述されていない。
  - 提案: 「今日この経路は存在しないが、prerender / SPA shell 生成を入れると `getRouter()` が要求スコープ外で走りうるので、その日に無関係なファイル配信まで 500 にしないための保険」と書き直す（`plan.md` の「リスクと注意点」に既にその形で書かれている）。あわせて `handleRedirectResponse` 経由の呼び出しが本 PR で発火するようになったことを 1 行足す。

- **[W-002]** `resolveAppConfig` が `undefined` を返しても**どこにも痕跡が残らない**ので、配線ミス時に「全ページの meta / canonical / og が黙って全部消える」まで誰も気づけない。
  - 場所: `apps/web/app/presentation/appConfig.ts:32-39`
  - 理由: `head` 17 箇所がすべて `if (!config) return {}` で握り潰す設計なので、失敗は 500 でも例外でもなく「HTML から `<title>` と OGP が消えるだけ」になる。変更前の `loadAppContext` は `getContainer()` の throw が `errorResponseMiddleware` を通ってログに落ちていた。throw を止めた判断自体（W-001 の但し書き付きで）は妥当だが、**サーバー側で `undefined` になったときに 1 行も出ない**のは観測性の後退。AC-5 は代表 7 ルートの `head` を目視で突き合わせる手順なので、配備後の劣化はここでは拾えない。
  - 提案: `.server(...)` 側で `store?.getStore()` が引けなかったときだけ `console.warn`（または `getInstalledStore()` 経由で `container.logger` が取れないので素の `console`）を 1 本出す。値そのものは `undefined` のまま返してよい。

- **[W-003]** 転送境界の上限 `2048` が `REDIRECT_MAX_LENGTH` と `signin.tsx` の生リテラルに二重管理されている。
  - 場所: `apps/web/app/routes/signin.tsx:11`（`z.string().max(2048)`）と `apps/web/app/presentation/redirect.ts:23`
  - 理由: `signin.tsx` はすでに `@/presentation/redirect` から `safeRedirectPath` を import しており、定数を使わない理由が無い。`docs:432` は「the same ceiling the loader clamps to」と**同一の上限であること**を明示しているのに、コードでは同期していない。`REDIRECT_MAX_LENGTH` を 4096 に上げると 2049〜4096 文字の `redirect` は `/signin` の `validateSearch` の `.catch(undefined)` に落ちて**黙って `/notes` へ倒れる** — ブリッジ側は通すのに着地だけ変わるという、原因が読めない不一致になる。
  - 提案: `signin.tsx` で `REDIRECT_MAX_LENGTH` を import して `z.string().max(REDIRECT_MAX_LENGTH)` にする。ついでに `redirect.test.ts` に「`boundedRedirectSource` の出力は必ずブリッジの validator を通る長さである」を 1 ケース足すと、上限を動かしたときに 2 箇所同時に落ちる。

- **[W-004]** 失効後に `/settings` のタブへ**ホバーするだけ**で、レイアウトのガード 1 本に加えて子断片の 401 が 1 本飛び、その cached match が `status: 'error'` のまま残る。計画も `testing.md` もこの副作用を「クリック時」としてしか書いていない。
  - 場所: `apps/web/app/routes/settings/route.tsx:32-53`
  - 理由: `/settings/profile` に居て `/settings/auth` を preload すると、レイアウト match はアクティブなので `resolvePreload`（`load-matches.ts:53-55`）が偽 → `cause: "stay"` → `shouldReload` 真 → blocking で `runLoader` → redirect。その throw が `Promise.all` を抜けるまでに、**同じ tick で着火済みの子断片 loader**（`renderIdentityList` → `requireSession()`）が `ValidationError("UNAUTHENTICATED")` → 401 を返し切っている。子 match は非アクティブなので `preloadRoute` の `updateMatch`（`router.ts:2924-2931`）が実際にストアへ `status: 'error'` を書く。実害は無い（クリック時は `status !== 'success'` で再実行され、レイアウトの redirect が先に遷移を奪う）が、**ホバーのたびにサーバーログへ 401 が積まれる**ことと、`plan.md` の「未サインインでも子の断片 loader が並列に発火して 401 を 1 本無駄に打つ」がナビゲーション限定の記述になっていることは合っていない。
  - 提案: `settings/route.tsx` のコメント、または `.thread/13/adr.md` の該当節に「この 401 はホバー（preload）でも出る」を 1 行足す。AC を増やす必要は無いが、`testing.md` 手順 12(a) は「`/signin` へナビゲートしないこと」しか見ていないので、そこに「Network に 401 が 1 本残るのは想定どおり」と書いておかないと、実測時に退行と誤記録される。

- **[W-005]** `settings/route.tsx:31` の「`cause !== "preload"` が preload を弾けるのは cached match だけなので、このレイアウト match に対しては実質いつも真になる」が、`/settings` の**外から**入る初回だけ成り立たない。
  - 場所: `apps/web/app/routes/settings/route.tsx:30-31`
  - 理由: `/notes` からタブへホバーした時点ではレイアウト match はアクティブでも cached でもないので `resolvePreload` は真、`cause` は `"preload"` になり `shouldReload` は**偽**を返す。それでも `status !== 'success'` の枝（`load-matches.ts:849`）で loader は走るため、結果として要求は飛ぶ — つまり「いつも真」ではなく「真でなくても走る」が実態。読み手が `shouldReload` の戻り値と要求の有無を 1:1 に結びつけると、preload 経路の本数を数え間違える（AC-3a の preload 欄が該当）。
  - 提案: 「アクティブなまま残るあいだは常に真。外から入る初回は `cause: "preload"` で偽になるが、その match は `status: 'pending'` なので `shouldReload` を参照せずに loader が走る」と 2 段で書く。

## カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`
- スキップ: なし

### 差分外で読んだもの（判断の根拠）

`node_modules/@tanstack/router-core/src/{load-matches,router,route,location}.ts`, `router-core/src/ssr/{ssr-client,ssr-server}.ts`, `@tanstack/start-server-core/src/createStartHandler.ts`, `@tanstack/start-client-core/src/{client/hydrateStart,client-rpc/serverFnFetcher,createServerFn}.ts`, `@tanstack/react-router/src/Transitioner.tsx`, `@tanstack/start-plugin-core/src/start-compiler/handleCreateIsomorphicFn.ts`, `apps/web/app/server.node.ts`, `apps/web/scripts/listen.node.ts`, `apps/web/vite.config.node.ts`, `apps/web/app/routeTree.gen.ts`, `apps/web/app/routes/{index,storage.$,settings/danger,settings/profile}.tsx`, `apps/web/app/components/{layout/AppShell,ui/Deferred}/index.tsx`, `apps/web/app/presentation/errorResponseMiddleware.ts`, `packages/core/src/application/di/containerStore.ts`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`

### 既出（蒸し返さない）として扱ったもの

`triage-keys.md` の 4 件 — `/settings` 固有の但し書きの複製（note-docs W-004）、手動検証の実行証跡（auth W-005）、`CLAUDE.md` への掲載（note-docs W-008）、`<link rel="canonical">` の重複（routing W-007 / #37）、および `spec/presentation/index.md` の `AppConfig` 節と `packages/core/src/application/di/types.ts` の新 JSDoc が「署名鍵の供給元」で矛盾する件（auth W-003 (2) / #38）。いずれも本レビューでは指摘していない。

### 実行した検証

- `pnpm typecheck` → rc=0（`Register.router` の `Awaited<...>` 化、オブジェクト形 loader の `useLoaderData` 推論、`exactOptionalPropertyTypes` 下の `RouterContext` がすべて通ることを確認）
- コード改変・サーバー起動は行っていない（revert 対象なし）
