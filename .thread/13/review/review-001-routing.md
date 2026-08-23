# レビュー R001 — ルーティング基盤・設定の受け渡し

対象: PR #36 (`8cd81a3` / base `main`) — Issue #13 「ナビゲーションごとの RPC 3往復を削減する」

## 検証の前提（このレビューで実際に走らせたもの）

差分の読み取りだけでなく、次を実測している。

- `pnpm typecheck` → rc=0（`packages/core` / `apps/web` とも Done）
- `pnpm test` → 76 files / 930 passed, 3 skipped
- **本番ビルド成果物（`apps/web/dist`、本 PR の内容でビルド済み）を `PORT=3457 NODE_ENV=development node scripts/listen.node.ts` で起動して HTTP で観測**（観測後に停止。作業ツリーは無変更）
- `@tanstack/router-core@1.171.15` / `@tanstack/start-server-core@1.169.17` / `@tanstack/start-client-core@1.170.14` / `@tanstack/start-plugin-core@1.171.24` / `h3@2.0.1-rc.20` の dist 実装を読解

観測できた事実（先に結論だけ）:

| 観測 | 結果 |
|---|---|
| `AppConfig` のクライアントバンドル漏れ | **無し**。`dist/client/assets/index-BEOE86ip.js` の `resolveAppConfig` は `var Hi=async()=>void 0` に畳まれており、`containerStore` の文字列は client バンドルに存在しない（`start-compiler/handleCreateIsomorphicFn.js` が `context.env === "client"` で `.client(...)` の本体へ `path.replaceWith` する） |
| SSR の `<head>` | `/terms` で `title` / `description` / `og:*` / `twitter:*` / `theme-color` / `canonical` すべて出力される |
| SSR ペイロードの `config` | `dehydratedData:{config:{siteName,defaultTitle,defaultDescription,themeColor,appUrl}}` が 1 回だけ載る（従来 root match の `__beforeLoadContext` に載っていたものが移っただけで、露出量は同じ） |
| 未サインイン SSR 直開き | `/notes` → 307 `?redirect=%2Fnotes` / `/notes/abc` → 307 / `/settings` → 307 `/settings/profile` / `/settings/profile` → **307**（401 ではない。plan「手動 7」は満たされる） / `/settings/danger` → **200** / `/` → 200 |
| ハイドレーション前に `config` が `undefined` になる窓 | **無い**。`router-core/ssr/client.js` の `hydrate` は `await router.options.hydrate?.(dehydratedData)` を `router.matchRoutes(...)` より**前**に呼び、`hydrateStart` はその `hydrate` を `await` してからルーターを返す。初期 state は `matches: []` なので `hydrateStart` の `if (!router.stores.matchesId.get().length)` は必ず真 |
| `head` 17 箇所の `match.context?.config` | すべて `buildMatchContext`（`load-matches.js:26` = `{...router.options.context}` を種にする）経由なので値を得る。SSR / hydrate 後クライアント遷移の両方で成立 |
| `shouldReload ?? staleMatchShouldReload` の主張 | 正しい（`load-matches.js:430-435`）。`staleTime` / `preloadStaleTime` は `staleAge` 経由でしか使われず、`shouldReload` が常に boolean を返す以上参照されない |
| loader の並列性（AC-3a/3b の前提） | 正しい。`loadMatches` は `beforeLoad` を逐次ループしたあと `for (...) matchPromises.push(loadRouteMatch(...))` → `Promise.all` で loader を並列起動する |
| `Register.router` / `routeTree.gen.ts` | `routeTree.gen.ts:435` は既に `Awaited<ReturnType<typeof getRouter>>`。`router.tsx:46` も揃っており再生成不要。typecheck も通る |

---

### ルーティング基盤・設定の受け渡し

#### Blockers

- **[B-001]** `/settings` レイアウトのガードを非ブロッキングな `loader` へ移したため、**タブ列にホバーしただけで `/signin` へ「実際にナビゲート」してしまう**（preload が遷移を起こす）。`main` の `beforeLoad` ガードでは起きなかった後退で、P-25 / ADR 047 が守っている唯一の例外画面を落とす。
  - 場所: `apps/web/app/routes/settings/route.tsx:34-52`（`shouldReload` + `loader`）
  - 理由:
    1. `/settings` レイアウト match は子ルート間の preload でも**アクティブ**なので `resolvePreload`（`load-matches.js:19-20` = `inner.preload && !matchStores.has(matchId)`）が `false` を返し、`getLoaderContext` が渡す `cause` は `"preload"` ではなく `"stay"` になる（`router.js:910` `cause = previousMatch ? "stay" : "enter"`）。plan もここまでは把握している。
    2. その結果 `shouldReload` が `true` → `loaderShouldRunAsync = status === "success" && true` → `load-matches.js:436` の**バックグラウンド分岐**（デタッチされた `(async () => {...})()`）に入る。
    3. この分岐の catch は `catch (err) { if (isRedirect(err)) await inner.router.navigate(err.options); }` で、**preload かどうかを一切見ずに `router.navigate` する**。`preloadRoute`（`router.js:742-775`）の「redirect は握り潰して `/signin` を preload するだけ」という保護は、デタッチされた promise なので効かない。
    4. `main` の `beforeLoad` 版では、同じ hover で投げられた redirect は `loadMatches` の `catch (err) { if (isRedirect(err)) throw err; }` を通って `preloadRoute` の catch に着き、**ナビゲートは起きなかった**。つまりこれは純粋な後退である。
    5. 実害: `DeleteAccountPanel` は「受理と同時にセッションが消える」画面で、`router.invalidate()` を意図的に呼ばず遷移もしない（`components/settings/DeleteAccountPanel/index.tsx:34-46` の規律）。受理直後、`SettingsTabs`（`components/layout/SettingsTabs/index.tsx` — 素の `<Link>`、`defaultPreload: "intent"`）はまだ描画されたままなので、**利用者がタブ列の上をマウスで横切るだけで `/signin?redirect=/settings/profile` へ飛ばされ、進捗表示が消える**。ticket は `ticketStorage` に退避されているので `/settings/danger` へ戻れば復帰するが、AC-11 が守ろうとしている「その場に留まる」性質は失われる。より一般には、`/settings/*` 滞在中にセッションが失効した利用者全員が、クリックせずに画面を奪われる。
    6. 同じ根から出るもう 1 つの帰結: タブ間遷移（`/settings/profile` → `/settings/auth`）では、レイアウトの loader は**バックグラウンド**で走るので `loadMatches` に await されない。したがって**ガードは遷移をブロックしない** — セッションが切れていても URL は先に `/settings/auth` へ確定し、子の断片が 401 で `ServerErrorState` を出したあとで redirect が追いかけてくる。権限判定の権威はハンドラー側にあるので情報漏洩はないが、`beforeLoad` が持っていた「ガードが通るまで遷移しない」性質は落ちている。plan / AC-9b は「初回遷移」しか語っておらず、この差分は記録されていない。
  - 提案: レイアウトの loader をブロッキングにする。`loader: { handler: async ({ location }) => {...}, staleReloadMode: "blocking" }`（`route.d.ts:158` `LoaderStaleReloadMode`、判定は `load-matches.js:458`）にすれば、
    - preload 時は `await runLoader(...)` 経路になり、redirect は `Promise.all` → `loadMatches` → `preloadRoute` の catch へ戻るので `main` と同じ「ナビゲートしない」に揃う
    - 実クリック時もガードが遷移をブロックする（`beforeLoad` と同じ性質。AC-9b が「`/settings/*` は元々ブロックする」と認めているので、`/notes` 系のストリーミング契約には影響しない）
    - `/notes/` `/notes/$noteId` には**付けないこと**。あちらは AC-8（背景再取得・スケルトンに戻らない）が非ブロッキングを要求している。
    代案として、レイアウトの loader から `throw redirect` を消して `{ user: null }` を返し、redirect の決定を子ルート側（＝ `/notes` と同じ「ハンドラーが権威」の形）へ寄せる手もあるが、`/settings/*` の 3 つの断片ブリッジすべてに `requireSessionOrRedirect` を入れる作業になり、本 Issue のスコープを超える。
  - テスト: `.thread/13/testing.md` の「エッジケース 3」（451-461 行）は**サインイン済みでのホバー**しか見ていない。「別タブでサインアウト → `/settings/profile` に留まったままタブ列にホバー（クリックしない）」を手順として追加し、`main` とブランチで挙動が同じであることを確認すること。

#### Warnings

- **[W-001]** `redirect` の上限 2048 を転送境界の**拒否**に使ったため、`location.href` が 2048 文字を超える URL で `/notes` / `/notes/:id` が **500** になる（従来は正常に描画 or `/signin` へ redirect）。
  - 場所: `apps/web/app/routes/notes/-action.tsx:14`（`const redirectField = z.string().min(1).max(2048)`）、`apps/web/app/routes/notes/index.tsx:21-22`、`apps/web/app/routes/notes/$noteId.tsx:21-24`
  - 理由: `/notes/` は `validateSearch` を持たないので任意のクエリを受け取り、`location.href` = `pathname + searchStr + hash` がそのまま `redirect` に載る。`.validator` は handler より前に走るので、**ガードにも断片にも到達せず 422 を投げ、ルートの `errorComponent` に落ちる**。実測: `GET /notes?q=<2100 文字>` → **500** + `ServerErrorState`（`main` では未サインインなら 307 `/signin`、サインイン済みなら一覧が描画される）。増幅の無い自己 DoS なので緊急度は低いが、リンクを共有された第三者も同じ 500 を踏む。
  - 提案: 「戻り先が長すぎる」は拒否ではなく**フォールバック**で扱うのが `safeRedirectPath` の設計と一貫する。`z.string().min(1).max(2048).catch("/notes")` にするか、そもそも `location.href` ではなく `location.pathname`（ルート定義で長さが有界）を送る。DoS 上限としての `.max()` は残したまま、超過時の帰結だけを変えれば AC-7 後半（2049 文字 → 422）を守るか捨てるかを明示的に選べる。

- **[W-002]** AC-7 / `testing.md` が期待する `/%0Aevil` の弾きが**実際には起きない**。手動テストをそのまま実行すると不合格になるか、誤った合格が記録される。
  - 場所: `.thread/13/plan.md:45`（AC-7）、`.thread/13/testing.md:290,293`、判定本体は `packages/core/src/domain/identity/services/sameOriginPolicy.ts`
  - 理由: `SameOriginPolicy.isSameOriginPath` は**生の**制御文字（`charCodeAt <= 0x1f || === 0x7f`）しか見ない。文字列 `"/%0Aevil"` は生の LF を含まないので同一オリジンパスとして通る。実測（本番ビルド + `Sec-Fetch-Site: same-origin` で `renderNoteList` へ直送）:
    - `//evil.example` → `{"to":"/signin","search":{"redirect":"/notes"}}` ✅
    - `https://evil.example` → `/notes` ✅
    - `/\evil.example` → `/notes` ✅
    - 生の LF `"/\n/evil.example"` → `/notes` ✅
    - **`/%0Aevil` → `{"search":{"redirect":"/%0Aevil"}}`** ❌（`testing.md:293` の「`%0A` も応答のどこにも現れない」に反する）
    - 2049 文字 → **422** ✅
  - 補足: これは**セキュリティ上の欠陥ではない**。`/%0Aevil` はパーセントエンコードのままオリジンに解決されるので同一オリジンであり、`main` の `hasControlCharacter` 実装でも同じく通っていた（＝ ADR-004 の委譲は挙動を変えていない、という回帰網としては正しく機能している）。問題は AC の検体が「生の LF」を意図していたのに `%0A` と書かれてしまっている点。
  - 提案: AC-7 と `testing.md` の検体を生の制御文字（`/\n/evil.example` など、DevTools の "Copy as fetch" で実際に埋め込める形）に直すか、`/%0Aevil` の期待値を「そのまま通るのが正（同一オリジン）」に書き換える。放置すると、次に `SameOriginPolicy` を触った人がこの AC を根拠にパーセントデコードを持ち込みかねない。

- **[W-003]** `getRouter()` が要求スコープの container に依存するようになり、**失敗の影響範囲が `/notes` 系のガードから「ほぼ全要求」へ広がった**。
  - 場所: `apps/web/app/presentation/appConfig.ts:22-29`、`apps/web/app/router.tsx:8-9`
  - 理由: `createStartHandler`（`start-server-core/dist/esm/createStartHandler.js`）は `getRouter()` を (a) `handleServerRoutes`（**すべてのドキュメント要求とサーバールート要求** — `/storage/$` のアバター配信を含む、389 行）と (b) `handleRedirectResponse`（381 行、**`x-tsr-serverFn` の判定より前**）で呼ぶ。`getContainer()` は store 未インストール / 要求スコープ外で throw するので、以後この 2 経路は container の健全性に無条件で依存する。今の参照ランタイムでは `server.node.ts:129` の `storage.run(container, () => entry.fetch(request))` が全要求を包むので動くが、`main` では `getRouter()` は container に一切触れていなかった。plan はこれを prerender / shell の将来リスクとして挙げているが、**今日の時点で `/storage/$` まで巻き込むこと**は書かれていない。
  - あわせて (b) の副作用: `renderNoteList` / `renderNoteDetail` が redirect を投げるようになったので、**未サインインの断片要求 1 本ごとにルーターツリー構築 + `resolveAppConfig()` → `getContainer()`** が走る（本番は `globalThis.__TSR_CACHE__` が processRouteTree をキャッシュするので実費は小さい）。
  - 提案: `RouterContext` は既に `config: AppConfig | undefined` を許し、17 箇所の `head` はすべて `if (!config) return {}` を持っている — つまり「config が引けない」を耐える形は型の上では用意されている。`resolveAppConfig` の `.server(...)` を `getInstalledStore()?.getStore()?.config` 相当（引けなければ `undefined`）にするか、逆に「ここは必ず throw する / それが正しい」を JSDoc に明記して、どちらの契約なのかを 1 つに決めること。今は「型は undefined を許すのに実装は throw する」で意図が読めない。

- **[W-004]** `docs/frontend_implementation_example.md:839` に、この PR で消えた導線を指す記述が残っている。
  - 場所: `docs/frontend_implementation_example.md:839`（`### Points` の 1 つ目）
  - 理由: 「In this repository the redirects live in route guards (`presentation/auth.ts`, `routes/index.tsx`, `routes/settings/route.tsx`)」— `presentation/auth.ts` はもう `redirect` を import すらしておらず（`sessionUserFn` だけ）、redirect の決定は `presentation/sessionGuard.ts` と `routes/notes/-action.tsx` の 2 つのブリッジへ移った。AC-13 / AC-14 は `requireAuthenticated` という**識別子**と L.113 / L.545 の 2 つの主張しか見ていないため、この 3 つ目の陳腐化をすり抜けている。
  - 提案: `presentation/auth.ts` → `presentation/sessionGuard.ts` に差し替え、「ブリッジのハンドラーからも redirect が出る（＝ `useServerFn` の自動変換はもはや safety net ではなく `/notes` 系の主経路と同じ形）」を 1 文足す。

- **[W-005]** 今回いちばん壊れやすい配線（`dehydrate`/`hydrate` の受け渡し、`shouldReload` の preload フィルタ、`requireSessionOrRedirect` のフォールバック）に、**振る舞いを検証する自動テストが 1 本も無い**。
  - 場所: `apps/web/app/presentation/__tests__/`（新規テスト無し）、`apps/web/app/presentation/sessionGuard.ts`、`apps/web/app/presentation/appConfig.ts`
  - 理由: `redirect.test.ts` は残っているが、`safeRedirectPath` は 3 行の委譲になったので、この 7 ケースが守るのは実質 `SameOriginPolicy` 側（`packages/core` 側にも同等の suite があるならほぼ重複）と「弾いたら `/notes` へ倒す」の 1 点だけ。**オープンリダイレクトが実際に閉じているかを決めているのは `requireSessionOrRedirect` が `safeRedirectPath` を通しているという事実**で、そこは誰もテストしていない。将来 `search: { redirect: redirectTo }` と書き換えられても CI は緑のまま通る。
  - また `createIsomorphicFn` のスタブ実装（`start-fn-stubs/createIsomorphicFn.js`）は `.server(...)` を優先するので、**Start コンパイラを通さずに `router.tsx` / `appConfig.ts` を import すると `resolveAppConfig()` はサーバー実装を走らせて throw する**。今それをする経路は無いが、vitest からこれらを触ろうとした瞬間に踏む。
  - 提案: 最低 1 本、`vi.mock("../session")` でセッションを `null` に固定して `requireSessionOrRedirect("//evil.example")` が `isRedirect` かつ `search.redirect === "/notes"` になること、`"/settings/auth"` ならそのまま通ることを assert する単体テストを足す。`resolveAppConfig` のクライアント実装が `undefined` を返すこと（＝ サーバー DI がクライアントへ渡らない前提）も 1 行で書ける。

- **[W-006]** `staleTime` を「参照されない」と分かったうえで 3 ルートに残し、同じ注意書きを 3 ファイル + docs 2 箇所に複製している。
  - 場所: `apps/web/app/routes/notes/index.tsx:11-13`、`apps/web/app/routes/notes/$noteId.tsx:11-13`、`apps/web/app/routes/settings/route.tsx:25-27`
  - 理由: `load-matches.js:430-435` のとおり `staleTime` / `preloadStaleTime` は `shouldReload` が boolean を返す限り一切効かない。docs 側は「drop it or say so」と書いてあり本 PR は "say so" を選んでいるので規約違反ではないが、**死んだ設定 + 4 箇所に複製された長いコメント**は、次に `shouldReload` を外す人がコメントを 1 箇所だけ直して残りを腐らせる形になっている。
  - 提案: 3 ルートから `staleTime` を落とし、「なぜ `staleTime` を書かないのか」は `docs/frontend_implementation_example.md` の 1 箇所だけに書く。どうしても宣言として残すなら、コメントは 1 行（「`shouldReload` があるため未参照。理由は docs 参照」）に縮めること。

- **[W-007]** `<link rel="canonical">` が 1 ドキュメントに 2 本出る（root の `/` 用 + ルート個別）。**本 PR の後退ではない**が、`head` の供給経路を差し替えた PR で「変更前と一致」を確認するときに一緒に見ておくべき既存不具合。
  - 場所: `apps/web/app/routes/__root.tsx:42`（`buildHead(config)` を options 無しで呼ぶ）
  - 理由: 実測（`/terms` の SSR HTML）で `<link rel="canonical" href="http://localhost:3100/"/>` と `<link rel="canonical" href="http://localhost:3100/terms"/>` の 2 本が出る。root の `head` が常にサイト既定の canonical を出し、子がもう 1 本足す構造。AC-5 は「変更前と一致」なので合格はするが、その「一致」が誤りの温存であることを記録に残さないと、次に誰かが「head は検証済み」と読んでしまう。
  - 提案: 本 Issue のスコープ外として別 Issue に切る（root は canonical を出さない、が正）。

#### 良かった点（設計判断として支持できるもの）

- `createIsomorphicFn().server(...)` の中で `containerStore` を動的 import する形は、**ビルド成果物で漏れが無いことを確認済み**（`dist/client` に `containerStore` の文字列が無く、`resolveAppConfig` が `async()=>void 0` に畳まれている）。plan のリスク欄「`router.tsx` はクライアントバンドルにも入る」は正しく閉じられている。
- `RouterContext = { config: AppConfig | undefined }`（省略可能プロパティにしない）という判断は `exactOptionalPropertyTypes: true` 下で必須で、実際 `router.update({ context: { config: dehydrated.config } })` がこれで通っている。
- `hydrate` を `router.update({context})` で書く形は、`ssr-client.js` が `hydrate` → `matchRoutes` の順であること・`hydrateStart` がそれを await することの両方に支えられており、**最初のクライアント遷移から `config` が入る**。`router.update` の shallow merge は `context` キーしか触らないので `dehydrate` / `hydrate` 自身も残る。ここは正しい。
- `shouldReload` を真偽値ではなく `({ cause }) => cause !== "preload"` の関数形にした判断は、cached match の preload（`/notes/` `/notes/$noteId`）を実際に弾けており、`preloadStaleTime` を殺した分の代償を最小化している。効かない場所（アクティブなレイアウト match）をコード内コメントと docs の両方で名指ししているのも良い。
- 未サインインで `/settings/profile` を SSR 直開きしたとき HTML 応答が **307**（401 ではない）になることを実測で確認した。`h3` の `prepareResponse` は `val instanceof Response && !val.ok` をそのまま返すので、子の断片が ALS に書いた 401 はドキュメント応答に出ない（plan「手動 7」の不確実性はここで解消してよい）。

#### カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`
- スキップ: なし（`.thread/13/` 配下は計画ドキュメントのため対象外。ただし `plan.md` / `testing.md` は AC 照合のために読んでおり、W-002 はその照合から出ている）

#### 差分外で参照したもの

`apps/web/app/server.node.ts`, `apps/web/app/start.ts`, `apps/web/app/routeTree.gen.ts`, `apps/web/vite.config.node.ts`, `apps/web/app/presentation/errorResponseMiddleware.ts`, `apps/web/app/presentation/serverFragment.tsx`, `apps/web/app/routes/settings/{index,profile,danger}.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`, `packages/core/src/application/di/containerStore.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`, `apps/web/dist/{client,server}`（ビルド成果物）, `node_modules/.pnpm/@tanstack+*`（router-core / start-server-core / start-client-core / start-plugin-core / start-fn-stubs）, `node_modules/.pnpm/h3@2.0.1-rc.20`

#### スコープ逸脱の確認

無し。`presentation/redirect.ts` の `SameOriginPolicy` 委譲は ADR-004、`DeleteAccountPanel` の `useRouteContext` → `useLoaderData` は `/settings` ガード移設の直接の帰結、docs の書き換えは AC-13 / AC-14 の成果物。`spec/` への昇格は行われておらず、plan の「含まれないもの」と一致する。`spec/presentation/index.md` / `spec/pages/index.md` に本 PR と矛盾する記述は無い（`/settings/danger` の認証ガード例外は SSR 200 で維持されていることを実測で確認）。
