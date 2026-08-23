# レビュー R004 — ルーティング基盤・設定の受け渡し

**結論: 問題点ゼロ。** Blocker 0 / Warning 0。収束と判断する。

## ルーティング基盤・設定の受け渡し

### Blockers

なし。

### Warnings

なし。

## 確認したこと（指摘に至らなかった検証の記録）

### 1. `Deferred` の JSDoc に足された前提の記述

追記された 3 つの主張をすべて裏取りし、いずれも事実として正しい。

- 「背景 loader の再実行が `loaderData` を未解決の promise ごと差し替える」 — `router-core@1.171.15` `load-matches.js:437-449` の背景枝が `runLoader` → `updateMatch` を通り、`loaderData` は新しい戻り値で丸ごと置き換わる。
- 「初回マウントには前値が無いのでフォールバックは出る」 — `useDeferredValue(value)` は `initialValue` 無しの初回レンダーで `value` をそのまま返すので正しい。
- 「params だけのナビゲーションはマウント済みコンポーネントを再利用するので、`remountDeps` が無ければ前の payload が残る（今日 note→note の導線は無い）」 — `to="/notes/$noteId"` の出現は `components/note/NoteList/index.tsx:67` の 1 箇所のみで、いずれも `/notes` 配下からの導線。Round 003 で `remountDeps` を wont-fix にした際の「前提は JSDoc に書く」という決着と一致しており、条件付きの書き方（"unless that route sets `remountDeps`"）なので将来 note→note を足す人が踏める形になっている。

### 2. `shouldReload` / `staleReloadMode` / `loader` オブジェクト形の組み合わせ

インストール済み `@tanstack/router-core@1.171.15` の実装で 4 点を実測確認した。残った穴は無い。

- `load-matches.js:359` — `typeof routeLoader === "function" ? routeLoader : routeLoader?.handler`。オブジェクト形の `handler` は正しく loader として呼ばれる。
- `load-matches.js:458` — `staleReloadMode` は**関数形では `void 0` 扱い**（`typeof routeLoader === "function" ? void 0 : routeLoader?.staleReloadMode`）。`routes/settings/route.tsx:36-41` のコメントの主張はそのまま実装どおり。
- `load-matches.js:430-436` — `loaderShouldRunAsync = status === "success" && (invalid || (shouldReload ?? staleMatchShouldReload))`。`shouldReload` を宣言した時点で `staleTime` / `preloadStaleTime` が参照されなくなるという docs / コメントの記述（`docs/frontend_implementation_example.md` の「do **not** also declare `staleTime`」および 3 ルートで `staleTime` を落とした判断）は正しい。3 ルートのいずれにも死んだ `staleTime` は残っていない。
- `router.js:742-777`（`preloadRoute`）— 例外が redirect のとき `router.navigate` ではなく **`preloadRoute` を再帰**する。つまりブロッキング枝の redirect はホバーで実ナビゲートを起こさない。一方で背景枝（`load-matches.js:446-448`）は `catch` で無条件に `await inner.router.navigate(err.options)` する。`/settings` にだけ `staleReloadMode: "blocking"` を置いた理由（タブへのホバーだけで `/signin` へ飛ぶのを防ぐ）は実装のとおりで、`/notes` 系は `cause !== "preload"` が cached match の preload を弾くので同じ穴に落ちない。

### 3. `getRouter()` の async 化と `dehydrate` / `hydrate`

- `router-core/dist/esm/ssr/ssr-client.js` の `hydrate()` は `await router.options.hydrate?.(dehydratedData)` を **`router.matchRoutes(...)` より前**に実行する。`router.tsx:16` のコメント「`matchRoutes` より前に走るので、最初のクライアント遷移から効く」は正しい。
- 同ファイルはハイドレーション時に `match.context = { ...parentContext, ...__routeContext, ...__beforeLoadContext }`（root の `parentContext` は `router.options.context`）を組み直してから各 match の `head` を再評価するので、`hydrate` 内の `router.update({ context })` が `match.context?.config` に確実に届く。AC-5 の「クライアント遷移後の DOM」側の前提は静的に成立している。
- `hydrate` クロージャが `router` を参照する形は TDZ にならない（`createRouter` の戻り値代入後にしか呼ばれない）。`Register.router` は `Awaited<ReturnType<typeof getRouter>>` に更新済みで、`routeTree.gen.ts:435` も同形。`getRouter` の呼び出し元はソースツリーに他に無い（フレームワーク側の規約解決のみ）。

### 4. AC のうちコードから静的に判定できるもの

| AC | 判定 | 根拠 |
|---|---|---|
| AC-1 / AC-2 | 成立見込み | root の `beforeLoad`・両ルートの `beforeLoad` が消え、loader はブリッジ 1 本のみ |
| AC-3a/b/c | 成立見込み | `/settings` のガードが `loader`（blocking）へ移り子断片と並列。`shouldReload` によりタブ間でも再実行される |
| AC-4 | 成立 | `__root.tsx` に `loadAppContext` / `beforeLoad` が無く、公開ルートに loader が無い |
| AC-5 | 成立 | 17 箇所の `head` 本体は無変更。root だけが config 不在時に `{ links: baseLinks }` を返す（スタイルシート / favicon の保全） |
| AC-6a | 成立 | `routes/settings/index.tsx` の `beforeLoad` は無条件 redirect なのでレイアウトの loader より先に走り、着地は `/signin?redirect=/settings/profile` |
| AC-7 | 成立 | `redirect` は `.validator` で `min(1).max(REDIRECT_MAX_LENGTH)`、値の安全は `signInRedirectOptions` → `safeRedirectPath` → `SameOriginPolicy.isSameOriginPath` の 1 本道。境界値は `redirect.test.ts` が両側（2048 / 2049）で固定 |
| AC-10 | **実測で成立** | `pnpm typecheck` 全パッケージ Done / `pnpm test` 76 files・935 passed・3 skipped |
| AC-11 | 成立 | `SIGNED_OUT_PATH` 分岐は loader 内に温存され、`{ user: null }` の形も不変。`DeleteAccountPanel` は `useLoaderData({ from: "/settings" })` で `user?.userId` を維持 |
| AC-12 | 成立 | `/notes` は `useLoaderData()` の `user`、`/settings` は layout の `useLoaderData()` の `user` から `AppShell` に渡る |
| AC-13 / AC-14 | 成立 | `requireAuthenticated` / `loadAppContext` / `useRouteContext` はソース・docs とも参照 0 件（ヒットは `.thread/` の記録のみ）。二重化の主張は L.113 / L.545 の両方が置き換わっている |

AC-8 / AC-9a / AC-9b / AC-6b は実測（Phase 4）の担当。コード上の前提（`/notes` 系に `staleReloadMode` を置かない、`/settings` にだけ blocking を置く、`Deferred` の deferred lane 化）はいずれも上記 2 のとおり実装と整合している。

### 5. スコープ

計画のスコープ外項目（`/` の往復、`/settings` 断片の 1 本化、ミューテーション系、`spec/` への昇格、`SameOriginPath` 値オブジェクト化）に踏み込んだ変更は無い。`spec/` への変更は ADR 030「影響」節の 2 行だけで、これは ADR-003 / ADR-005 が作った混在窓の記述であり本 PR の帰結そのもの。`packages/core` 側の変更も `AppConfig` の JSDoc（秘密を足さない前提）1 箇所に留まっている。

### 6. `main` と比べて壊れたものの探索（否定的確認）

- `staleTime` の残存: `/settings/{profile,auth,usage,danger}` に残るが、これらは `shouldReload` を持たないので生きた設定。`danger.tsx` の `staleTime`（loader が無い）は本 PR より前からある既存の書き方で、差分ではない。
- `presentation/redirect.ts` が `@repo/core/domain/identity/services/sameOriginPolicy` を**静的** import するようになったが、これは純粋なドメイン述語でサーバー DI グラフを引かないので、`signin.tsx` 経由でクライアントバンドルに入っても害はない。`sessionGuard.ts`（`./session` を動的 import）はサーバー専用のまま。
- `AccountMenu` のサインアウトが `staleTime: Infinity` に言及するコメントは、`/settings` 子ルートの `staleTime` が残っているうえ「ルーターインスタンスごと捨てる」という主張自体が設定と独立に真なので、退行にはなっていない。

## カバレッジ

- 確認: `apps/web/app/components/note/CreateNoteButton/index.tsx`, `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/components/ui/Deferred/index.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`
- スキップ: なし
