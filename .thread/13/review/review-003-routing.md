# レビュー R003 — ルーティング基盤・設定の受け渡し

対象: PR #36 / ベース `main` / 差分 `13-round-003.diff`（18 ファイル全量）
既出判定: `triage-keys.md` の `wont-fix` / `defer` 4 + 1 件は蒸し返していない。

## 検証の要約（実測したもの）

- `pnpm typecheck` rc=0、`pnpm test` 76 files / 935 passed。
- `pnpm dev`（`APP_URL=http://localhost:3100`）を立てて実測（**計測後に停止済み・作業ツリーは無変更**）:
  - `/` `/terms` の SSR `<head>` に `title` / `description` / `og:*` / `twitter:*` / `theme-color` / `canonical` が従来どおり出る（`resolveAppConfig` → `context` → `match.context?.config` の供給経路が SSR で通っている）。
  - SSR ペイロードの `dehydratedData` は `{config:{siteName,defaultTitle,defaultDescription,themeColor,appUrl}}` が **1 回だけ**。root の `__beforeLoadContext` から config が消えたぶん、むしろ減っている。
  - 未サインインの直開き: `/notes` → **307** `/signin?redirect=%2Fnotes`、`/settings/profile` → **307**（401 ではない = 計画の手動 7 が通る）、`/settings` → 307 `/settings/profile`、`/settings/danger` → **200**（AC-11 の `SIGNED_OUT_PATH` 分岐）。
- 本番ビルド成果物 `apps/web/dist/client` を全文検索して `containerStore` / `getInstalledStore` / `container-store` が **0 件**（`createIsomorphicFn().server(...)` によるサーバー DI の非漏洩）。
- フレームワーク側の前提をソースで確認:
  - `router-core/ssr/ssr-client.ts:98` — `await router.options.hydrate?.(...)` は `router.matchRoutes(...)` の**前**。`start-client-core/client/hydrateStart.ts:25` も `await getRouter()` なので async 化は安全。`router.update` は `{...prevOptions, ...newOptions}` のマージ（`router.ts:1089`）。
  - `router.ts:1430-1435,1690-1712` — `match.context` は `matchRoutes` の時点で `this.options.context` から組まれる。`head` が読む `match.context?.config` はロード前に確定している。
  - `load-matches.ts:809-816` — `shouldReload ?? staleMatchShouldReload`。関数形は必ず boolean を返すので `staleTime` / `preloadStaleTime` は本当に死ぬ（docs L.129 の記述は正しい）。`invalid ||` が先にあるので `router.invalidate()` は `shouldReload` を貫通する。
  - `load-matches.ts:860-864` — `staleReloadMode` はオブジェクト形の loader からしか読まれない（`typeof routeLoader === 'function' ? undefined : ...`）。`route.tsx` のコメントどおり。
  - `load-matches.ts:1025-1030` — loader は `Promise.all` で同時起動。AC-3a / AC-3b の「2 本同時開始 / 1 段」は構造として成立する。
  - `router.ts:2935-2945` — `preloadRoute` の catch は redirect を **navigate せず preload に倒す**。`/settings` を blocking にした狙い（ホバーだけで `/signin` へ飛ばない）は正しい。かつ preload 時の `updateMatch` はアクティブ match をストアに書き戻さない（`router.ts:2924-2931`）ので、ホバーで `ServerErrorState` が閃く経路も無い。
  - `createServerFn.ts:166-168` — クライアント側 fetcher は `parseRedirect` で redirect を再構築して throw。畳んだブリッジの `throw redirect(...)` は loader で router に拾われる。

### `Deferred` の `use(useDeferredValue(promise))`（2 ラウンド目の最重要修正）の妥当性

**正しい解決である**と判断する。

- 初回マウント: `useDeferredValue` は初期値をそのまま返すので `use()` が suspend し、フォールバックが出る（AC-9a 保持）。SSR / ハイドレーションも同じ経路。
- 背景再取得: 前の（fulfilled な）promise を保持したまま同期レンダーが通り、差し替えは deferred lane で再レンダーされる。マウント済み `<Suspense>` はフォールバックへ戻らない。AC-8 の観測（スケルトン 0 件）と整合する。
- 「永遠に古い値が残る経路」は見つからなかった。`useDeferredValue` が前の値を保つのは deferred レンダーが suspend しているあいだだけで、新しい promise が settle すればそこへ収束する。連続で差し替わっても最新値を追う。reject した場合は deferred レンダーが throw し `errorComponent` に落ちる（従来どおり）。
- 全利用箇所を洗い出した（`/notes/index.tsx:44`, `/notes/$noteId.tsx:95`, `/settings/profile.tsx:39`, `/settings/auth.tsx:39`, `/settings/usage.tsx:39`）。`/settings` のタブ間遷移は route component の型が変わるので必ず remount し、スケルトンが出る挙動は保たれる。
- ミューテーション後の `router.invalidate()`（`router.ts:2769-2792` — cached / pending も invalid にして `load()`）でも差し替わる。`IdentityBoard` のような「`useOptimistic` が `invalidate()` の解決後に revert する」経路は**変更前より良く**なっている（従来は revert → スケルトン → 新データ、今回は revert → 新データ）。

### `/settings` blocking と `/notes` 非ブロッキングの組み合わせ

AC-1/2（1 本 1 段）、AC-3a/3b（2 本 1 段）、AC-3c（1 本 1 段）、AC-4（0 本 — 公開 6 ルートに `beforeLoad` / `loader` が無く、root からも消えた）はいずれも構造上成立する。`/notes` 側を blocking にしなかった判断（`triage-keys.md` Round 002 の既決事項）も、上記 `load-matches.ts` の読みと矛盾しない。

## Blockers

なし。

## Warnings

- **[W-001]** `Deferred` の「前の値を保つ」性質は**同一 URL の再取得**を前提にしているが、コードにもコメントにもその前提が書かれていない
  - 場所: `apps/web/app/components/ui/Deferred/index.tsx:13-19,29` / `apps/web/app/routes/notes/$noteId.tsx:11-28`
  - 理由: `useDeferredValue` は「promise の identity が変わったが**コンポーネントインスタンスが生き残った**」すべての場合に前の値を保つ。TanStack Router は `defaultRemountDeps` も route ごとの `remountDeps` も設定していないので、`Match.tsx:336,418` の `key` は常に `undefined` になり、**同じ route の params だけが変わる遷移では route component が remount されない**。したがって `/notes/$noteId` 同士の遷移が生まれた瞬間、「別のノートの本文がスケルトンも挟まずに表示され続けてから差し替わる」という**誤った内容の表示**になる。今日は到達しない（`to="/notes/$noteId"` を持つのは `components/note/NoteList/index.tsx:67` と `CreateNoteButton`、どちらも `/notes` 配下にしか無い）ので退行ではないが、`Deferred` の JSDoc は「On the first mount there is no previous value, so the fallback still shows」としか言っておらず、**何が「first mount」を決めるのか**（= remount されるかどうか）が読み取れない。ADR-005 の射程が「同じ URL の再取得」に限られることが読み手に伝わらない。
  - 提案: `/notes/$noteId` に `remountDeps: ({ params }) => params` を足す（今日の観測される挙動は 1 つも変わらず、AC-1〜9 のどれにも影響しない）。それを入れないなら、`Deferred` の JSDoc に「前の値を保つのは promise の差し替えが**同じ URL の再取得**であることが前提で、params だけが変わる遷移では route に `remountDeps` が要る」の 1 文を足す。

- **[W-002]** `docs/frontend_implementation_example.md:135` が同じ節の L.119 と AC-8 に矛盾する
  - 場所: `docs/frontend_implementation_example.md:135`
  - 理由: 「`/notes` と `/settings/*` は同じ形で、**どちらもその 1 往復無しには loader が settle しない**」と断言しているが、既訪 match への再訪（＝ AC-8 の「戻る」）では `/notes` の loader は背景枝（`load-matches.ts:830-848`）に落ちて**往復を待たずに settle する**。それはこの PR の目玉挙動であり、16 行上のスニペット注記（L.119 相当「The re-fetch runs in the background, so the navigation itself settles at once」）が正しく述べている。この 2 文が同じ節に並んでいると、次の読み手は「`/notes` は常にブロックする」と受け取り、`shouldReload` + 背景枝 + `Deferred` という 3 点セットの意味を取り違える。
  - 提案: L.135 の断言を「**初回（未ロードの match）の遷移では**どちらもその 1 往復ぶんブロックする」に限定し、既訪 match は背景枝で即 settle する旨を 1 節前の記述に委ねる。

- **[W-003]** サインインしたタブに前の利用者の**表示名とアバター**が 1 往復ぶん残る窓が新たに開く（`spec/adr/030` に記述はあるが、影響が「一覧の中身」から「利用者の同一性表示」へ広がっている）
  - 場所: `spec/adr/030-auth-state-transition-transport.md:32-33` / `apps/web/app/routes/notes/index.tsx:21,40-42`
  - 理由: 経路は ADR が新しく書いたとおり（A の失効 → `/notes` の背景再判定 → `/signin` → B がサインイン → `router.invalidate()` は cached match を `invalid` にするだけ → `history.push("/notes")` で既訪 match が背景再取得 → 1 往復ぶん前の `loaderData`）。ここまでは変更前も同じだが、**`AppShell` の `displayName` / `avatarUrl` の供給源が `beforeLoad` の routeContext から `loaderData` へ移った**ため、変更前は「A の一覧 + B の名前」だったものが「**A の一覧 + A の名前とアバター**」になる。つまり別人としてサインインした直後の画面が、1 往復のあいだ完全に前の利用者の画面として成立してしまう。ADR は現象を記録しているが、この差分（同一性表示まで巻き込むこと）を受け入れた判断だと読める書き方にはなっていない。
  - 提案: 受け入れるなら ADR-030 の該当行に「上部バーの同一性表示まで含めて 1 往復ぶん前の利用者のものになる」と**変更前との差**を明示する。閉じるなら `SignInForm`（`components/auth/SignInForm/index.tsx:141`）の `router.invalidate()` を `router.clearCache()`（`router-core/src/router.ts:2843`）と併用して既訪 match ごと捨てる — そうすれば `/notes` は新規 match になり `status !== "success"` でブロッキング判定に落ちるので、この窓だけが閉じ、AC-1〜9 のどれにも触れない。

## カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`（`useLoaderData({ from: "/settings" })` は `/settings` レイアウトの loaderData を読む。未サインインでも `{ user: null }` が返るので `currentUserId` は従来どおり `null` に倒れる）
- 確認: `apps/web/app/components/ui/Deferred/index.tsx`（W-001）
- 確認: `apps/web/app/presentation/__tests__/redirect.test.ts`（`signInRedirectOptions` は AC-7 の全検体 — `//evil.example` / `https:` / `/\` / 生 LF / `javascript:` / `undefined` / `null` — と「`/%0Aevil` は復号せず通す」を押さえており実効的。`boundedRedirectSource` は境界値 `REDIRECT_MAX_LENGTH` ちょうどと +1 を両方見ていて off-by-one を落とせる）
- 確認: `apps/web/app/presentation/appConfig.ts`（`RouterContext` を省略可能プロパティにしない理由、`getInstalledStore()?.getStore()?.config` の寛容な読み、`createIsomorphicFn` によるクライアント非漏洩 — dist で実測）
- 確認: `apps/web/app/presentation/auth.ts`（`requireAuthenticated` 撤去。リポジトリ全体の grep で参照ゼロ = AC-14 成立。残る `sessionUserFn` は `routes/index.tsx` と `routes/settings/route.tsx` の 2 か所から使われている）
- 確認: `apps/web/app/presentation/redirect.ts`（`SameOriginPolicy.isSameOriginPath` への委譲は既存 7 ケースがそのまま通ることで回帰網が張れている。`REDIRECT_MAX_LENGTH` が `-action.tsx` の validator と `signin.tsx` の `validateSearch` の両方から import されていて天井が二重定義になっていない）
- 確認: `apps/web/app/presentation/sessionGuard.ts`（`session.ts` の動的 import 規約を維持。redirect 組み立てを純関数に出したのでテストが届く）
- 確認: `apps/web/app/router.tsx`（async 化 / `context` / `dehydrate` / `hydrate` / `Register.router` の `Awaited<...>`。`hydrate` 内の `router` 参照は TDZ に当たらない — `hydrate` はフレームワークが `createRouter` 完了後に呼ぶ）
- 確認: `apps/web/app/routes/__root.tsx`（`createRootRouteWithContext<RouterContext>()`、`loadAppContext` 撤去、config 不在時に `{ links: baseLinks }` を返す分岐。canonical 重複は #37 で defer 済みなので触れない）
- 確認: `apps/web/app/routes/notes/$noteId.tsx`（W-001）
- 確認: `apps/web/app/routes/notes/-action.tsx`（`redirectField` の `min(1).max(REDIRECT_MAX_LENGTH)`。`boundedRedirectSource` が上限超えを `/notes` に倒すので validator が 422 を返す入力は loader からは作れない）
- 確認: `apps/web/app/routes/notes/index.tsx`（`shouldReload` の関数形、`loader` が `location.href` を渡す形、`user` の供給源が loaderData に移った点 = AC-12）
- 確認: `apps/web/app/routes/settings/-action.tsx`（コメントのみの変更。「権威はハンドラー側」「別 match なので畳めず並列」は実装と一致）
- 確認: `apps/web/app/routes/settings/route.tsx`（`shouldReload` + オブジェクト形 loader + `staleReloadMode: "blocking"`。ホバーで `/signin` へ飛ばないこと・アクティブ match が汚れないことを router-core のソースで裏取り）
- 確認: `apps/web/app/routes/signin.tsx`（`REDIRECT_MAX_LENGTH` の共有。`.optional().catch(undefined)` があるので上限超えの `redirect` が来ても 4xx にならず `/notes` に倒れる）
- 確認: `docs/frontend_implementation_example.md`（ルーティング基盤・設定受け渡しに関わる記述のみ: `shouldReload` / `staleTime` の関係、`staleReloadMode` の object 形、`getRouter` async 化と `head` の `if (!config)` 不変条件、`appConfig.ts` を「container 直読み例外」に加えた節。AC-13 / AC-14 の文言判定は note-docs 観点の担当。W-002）
- 確認: `packages/core/src/application/di/types.ts`（`AppConfig` に秘密を足さない旨の JSDoc。`spec/presentation/index.md:94` の「SSR メタデータを運ぶ設定の器に秘密を混ぜず」と同じ向きで、#38 で defer した矛盾を悪化させていない）
- 確認: `spec/adr/030-auth-state-transition-transport.md`（W-003）
- スキップ: なし
