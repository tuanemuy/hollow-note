# レビュー 001 — ノート閲覧のフロントエンド体験・ドキュメント整合

対象: PR #36 / ブランチ `issue/13/reduce-navigation-rpc-roundtrips`（`8cd81a3`）
差分本文: `scratchpad/diff/13-round-001.diff`

## 事前検証（このレビュー中に実施したこと）

- `pnpm typecheck` → rc=0（`Register.router` の `Awaited<...>` 化、`RouterContext` の `exactOptionalPropertyTypes` 対応とも通る）
- `pnpm test` → 76 files / 930 passed / 3 skipped
- `grep -rn requireAuthenticated apps packages docs spec README.md` → 0 件（AC-14 充足）
- `grep -rn useRouteContext apps/web/app` → 0 件（`routeContext` → `loaderData` の移行漏れなし。`SettingsTabs` は `user` を参照していないので AC-12 の退行経路は `AppShell` の 2 箇所だけ）
- `@tanstack/router-core@1.171.15` の `load-matches.ts:804-853` / `router.ts:2714-2726` / `ssr/ssr-client.ts:99-102` を実読し、次の 3 つの前提が正しいことを確認した
  - `shouldReload` が非 undefined を返すかぎり `staleTime` / `preloadStaleTime` は一切参照されない（`staleTime` の唯一の参照は `load-matches.ts:802` → `staleMatchShouldReload` のみ）
  - 既訪 match への再訪では `loaderShouldRunAsync` で**背景**ロードになり、その `updateMatch` は `router.startTransition`（React 19 の `startTransition`）の中で走る。したがって「新しい未解決 promise に差し替わっても Suspense がフォールバックへ戻らない」という `notes/index.tsx` のコメントと doc L.85-86 の主張は**正しい**（＝ AC-8「スケルトンに戻らない」は構造的に成立する）
  - `router.options.hydrate` は `matchRoutes` の**前**に走る（`ssr-client.ts:99` → `102`）。`router.tsx:16` のコメントどおりで、初回クライアント遷移から `match.context.config` が埋まる（AC-5 の `head` 供給経路は壊れていない）
- `createServerFn` のクライアント側 fetcher（`start-client-core/src/createServerFn.ts:166-169`）が応答の redirect を `parseRedirect` して throw することを確認。`errorResponseMiddleware:32` は redirect / notFound を素通ししているので、畳んだブリッジの `throw redirect` は loader → router へ正しく伝播する（断片がスケルトンのまま固まる経路はない）

**断片ストリーミング自体に退行は無い。** `renderNoteList` / `renderNoteDetail` はいずれも `renderServerFragment(...)` を **await せず**返し、loader はそれを転送するだけ（`notes/index.tsx:21-22`、`$noteId.tsx:21-24`）。`<Suspense fallback={<NoteListSkeleton/>}>` / `<NoteDetailSkeleton/>` と `Deferred` の組も無変更。ガードを畳んだことで loader がブロッキングになった箇所は無い。

以下は上記を踏まえたうえでの指摘。

## Blockers

- **[B-001]** 畳んだブリッジの「主体が無効（削除中／削除済み）→ 401」という 2 系統目が、実装上**絶対に発火しない**。doc と実装コメントの両方が事実と食い違っている
  - 場所: `docs/frontend_implementation_example.md:123` / `apps/web/app/routes/notes/-action.tsx:9`
  - 理由: `packages/core/src/application/identity/authenticateSession.ts:13-22` の JSDoc が明示するとおり「Every failure collapses to `ValidationError("UNAUTHENTICATED")` without distinction」で、`user.status !== "active"`（= 削除中 `deleting` / 削除済み `deleted`）も `authEpoch` 不一致も同 61-65 行で `unauthenticated()` に収斂する。`apps/web/app/presentation/session.ts:126-138` の `sessionUserOrNull` はその `UNAUTHENTICATED` をちょうど飲み込んで `null` を返すので、`requireSessionOrRedirect` は **redirect を投げる**。401 になるのは system / unknown 系のインフラ失敗だけで、doc が名指しした「主体が無効」ではない。doc の続く一文「`sessionUserOrNull` swallows only `UNAUTHENTICATED`, so everything else still surfaces as an error」は正しいが、その "everything else" に削除中／削除済みは**含まれない**ため、太字の主張と根拠が繋がっていない。AC-13 が要求した「2 系統」の文言そのものが誤った前提に立っており、字面だけ満たして中身が嘘になっている
  - 提案: doc L.123 を「セッションが解決できない理由（無い / 期限切れ / epoch 不一致 / 削除中・削除済み）は 1 つに収斂して redirect になる。401 が残るのは `requireSession` を直に呼ぶミューテーション側だけ」に書き換える。`-action.tsx:9` の「主体が無効（削除中／削除済み）なら 401 が出る」も同様に落とす（この行は畳み込み前の `requireSession()` 時代の記述がそのまま残ったもの）。あわせて plan の AC-13 も実態に合わせて訂正する

- **[B-002]** `getContainer()` を直接呼んでよい**閉じた例外リスト**が、この PR によって古くなったまま残っている
  - 場所: `docs/frontend_implementation_example.md:334`
  - 理由: 「The real cases are `presentation/serverErrorLog.ts`, `routes/storage.$.tsx`, and `routes/__root.tsx` (reads `container.config`)」と書かれているが、本 PR は `__root.tsx` から `loadAppContext` を削除しており（`routes/__root.tsx:36` は `createRootRouteWithContext` になり `getContainer` を一切呼ばない）、代わりに **`apps/web/app/presentation/appConfig.ts:50-55` が新しい 4 件目の直接呼び出し**になっている。閉じたリストと明記されている箇所なので、旧エントリの残存と新エントリの欠落が同時に起きているのは単なる説明漏れではなく規約の穴になる。続く L.336 の「every one of those call sites reaches `getContainer` through `await import(...)` inside the handler」も、`appConfig.ts` は handler ではなく `createIsomorphicFn().server(...)` の中で動的 import する別形なので、そのまま読むと当てはまらない
  - 提案: L.334-336 のリストから `routes/__root.tsx` を外し、`presentation/appConfig.ts` を「ルーターコンテキストへ `AppConfig` を供給する。クライアントバンドルから本体を落とすため `createIsomorphicFn().server(...)` 内の動的 import という別形をとる」として追加する

## Warnings

- **[W-001]** `router.tsx` の抜粋が古く、この PR が入れた `RouterContext` / `context` / `dehydrate` / `hydrate` の仕組みが doc のどこにも書かれていない
  - 場所: `docs/frontend_implementation_example.md:906-921`
  - 理由: 抜粋は `export function getRouter()`（同期）のままだが実物は `export async function getRouter()`（`router.tsx:8`）。doc 冒頭 L.3 が「Every path and identifier below points at real code」と宣言している以上、シグネチャの不一致は看過できない。さらに重いのは、17 箇所の `head` が依存する `match.context?.config` の供給経路が `beforeLoad` から router context + SSR dehydrate/hydrate に丸ごと差し替わったのに、フロントエンド実装の参照ドキュメントに 1 行も無いこと。`head` を書く次の人はこの経路を知らないまま `match.context?.config` を書くことになる
  - 提案: L.906-921 の抜粋を `async` 化し、`context` / `dehydrate` / `hydrate` の 3 行を含めたうえで、「配備ごとにしか変わらない値なので SSR ペイロードに 1 回だけ載せる」「`hydrate` は `matchRoutes` の前に走るので初回クライアント遷移から効く」「したがって `AppConfig` に秘密を入れない前提が転送の前提になる」を短く添える（最後の 1 点は `.thread/13/adr.md` ADR-001 の Consequences にあるが、doc 側にも要る）

- **[W-002]** 「redirect はルートガードにある」の列挙に `presentation/auth.ts` が残っており、しかも本 PR で redirect の発生源に**サーバー関数ハンドラー**が加わったことが反映されていない
  - 場所: `docs/frontend_implementation_example.md:839`
  - 理由: `presentation/auth.ts` は本 PR で `requireAuthenticated` を失い、`redirect` の import すら残っていない（現在の全 16 行に redirect は無い）。redirect の決定は `presentation/sessionGuard.ts` へ移った。加えて同じ文が「the automatic path is a safety net rather than the main road」と締めているが、`/notes` 系の未サインイン遷移では `renderNoteList` / `renderNoteDetail` の `throw redirect` が**まさに本道**になった（`useServerFn` 経由ではなく loader 経由なので文意そのものは崩れないが、列挙が誤りのままだと読者は auth.ts を見に行って何も見つけられない）
  - 提案: 列挙を `presentation/sessionGuard.ts`, `routes/index.tsx`, `routes/settings/route.tsx` に差し替え、「畳んだブリッジ（`routes/notes/-action.tsx`）からも redirect が出る。こちらは loader が受けるので `useServerFn` の自動処理は関与しない」を 1 文足す

- **[W-003]** 3 ルートに「参照されない」と自ら書いた `staleTime` が残っている。死んだ設定 + それを説明するコメント、という一番読み手を迷わせる形
  - 場所: `apps/web/app/routes/notes/index.tsx:11-13` / `apps/web/app/routes/notes/$noteId.tsx:11-13` / `apps/web/app/routes/settings/route.tsx:25-27`（および doc `frontend_implementation_example.md:75-78`）
  - 理由: router-core を実読して確認したとおり `staleTime` の参照は `load-matches.ts:802` の 1 箇所のみで、`shouldReload` が常に boolean を返す本 PR の書き方では到達しない。コメントの内容自体は正しいが、「効かない設定 + 効かない理由の 3 行コメント」を 3 ファイルに置くのは CLAUDE.md の「Default to no comments / Make illegal states unrepresentable」と逆向きで、次に `shouldReload` を消した人が `staleTime` の意図を再構築できない（`/notes` に至っては元々あった「無期限で持てるのは鮮度を `router.invalidate()` が担うため」という**生きた** WHY を、死んだ設定の言い訳に置き換えてしまっている）。doc L.77 の "Do not leave it here silently; drop it or say so, as here" は、この死んだ設定を規約として制度化してしまう
  - 提案: 3 ルートから `staleTime` の行を落とす。残す判断をするなら doc 側は "drop it" 一択に倒し、「なぜ残せるのか」ではなく「`shouldReload` を外すときは `staleTime` を戻す」を `sessionGuard` 側の JSDoc に 1 箇所だけ書く

- **[W-004]** `/settings` レイアウト固有の但し書きが、レイアウト match ではない 2 ファイルへそのままコピーされている
  - 場所: `apps/web/app/routes/notes/index.tsx:17-19` / `apps/web/app/routes/notes/$noteId.tsx:17-19`
  - 理由: 「ただし `cause !== "preload"` が preload を弾けるのは cached match だけで、アクティブなまま残る `/settings` レイアウトのような match には効かない」は `/settings/route.tsx` の事情であって、`/notes` `/notes/$noteId` はどちらも cached match 側なので**この但し書きが当てはまる状況が無い**。3 ファイルに同一の 6 行コメントを置いた結果、当該ファイルで起きないことの説明が 2/3 を占めている
  - 提案: `/notes` 系は「`loader` がガードを兼ねるので毎ナビゲーション再実行させる。関数形なのは `shouldReload: true` だとホバーのたび要求が飛ぶため」の 2 行に切り詰め、`/settings` レイアウト特有の但し書きは `settings/route.tsx` にだけ残す

- **[W-005]** ローディングフォールバック 2 種の使い分けの記述が、畳み込み後の実態とずれた**非対称**を主張したままになっている
  - 場所: `docs/frontend_implementation_example.md:127`（新規追記の L.119-121 と隣接）
  - 理由: 「a streaming route like `/notes` settles its loader immediately and never triggers it」とあるが、本 PR 後の `/notes` の loader はブリッジ 1 往復（＝その中の `requireSessionOrRedirect` によるセッション解決）を await してから settle する。一方 `/settings/profile` も親レイアウトの `sessionUserFn` 1 往復（子の断片 loader と並列）で settle する。**両者とも「1 往復ぶんブロックしてから URL 確定 → 断片はスケルトンでストリーム」で構造的に同じ**であり、どちらも 200ms を超えれば `defaultPendingComponent` が挟まる。plan の AC-9a / AC-9b が「期待値が違うことが正」としている非対称は、この PR がガードを畳んだ結果むしろ**消えた**。この状態で L.127 の "never triggers it" を残すと、`/notes` の pending が出た実測を「退行」と誤読させる
  - 提案: L.127 を「per-fragment のスケルトンは断片の解決を、`defaultPendingComponent` は loader が await する 1 往復（ガード）を覆う。両者は排他ではなく直列に並ぶ」に直す。あわせて AC-9a / AC-9b の期待値の書き分けも「`/notes` は 0 往復で settle」ではなく「どちらも 1 往復」で再表現する

- **[W-006]** 本 PR が新しく作った振る舞いを、実効的に守るテストが 1 つも無い
  - 場所: `apps/web/app/presentation/sessionGuard.ts:12-21` / `apps/web/app/routes/notes/-action.tsx:14,18,33`
  - 理由: 追加されたのは (a) `requireSessionOrRedirect` が `redirectTo` を必ず `safeRedirectPath` に通すこと、(b) `redirect` 転送境界の上限 2048、(c) loader が `location.href` を積んで渡すこと、の 3 点だが、いずれも自動テストが無く AC-7 / AC-9 は手動観測のみ。既存の `presentation/__tests__/redirect.test.ts` が守っているのは `safeRedirectPath` という**純関数の述語**（ADR-004 の委譲回帰網）だけで、「ブリッジがそれを呼んでいること」は誰も保証していない。将来 `requireSessionOrRedirect` から `safeRedirectPath` の呼び出しが落ちてもテストは緑のままで、オープンリダイレクトがそのまま復活する。`apps/web` に純関数テストしか無い現行方針（`docs/test.md`）を踏まえてもここは境界の外形が明確なので、最低でも「`redirect` の組み立てだけを純関数へ切り出して検証する」形は取れる
  - 提案: `requireSessionOrRedirect` から「redirect 先を組み立てる」部分（`{ to: "/signin", search: { redirect: safeRedirectPath(redirectTo) } }`）を純関数として切り出し、`//evil.example` / `https://evil.example` / `/%0Aevil` / `/\evil.example` が `/notes` に倒れることを `__tests__` で固定する。`redirectField` の上限は `components/*/schema.ts` と同じく定数化して schema テストの対象に乗せる

- **[W-007]** 未サインインで `/settings/*` へ**クライアント遷移**する経路（別タブでサインアウト → 設定タブをクリック）がどの AC にも手順にも無い
  - 場所: `apps/web/app/routes/settings/route.tsx:35-52`（plan の手動 7 は SSR 直開きのみ）
  - 理由: ガードが `loader` へ降りたことで、子の断片 loader（`renderProfileForm` など）が親のガードと**並列**に発火する。SSR 直開きは plan の手動 7 とリスク欄で押さえてあるが、同じ並列化はクライアント遷移でも起きる。`loadMatches` は index 順に redirect を throw し、`onReady` 前に抜けるので commit されない読みで正しいはずだが、`ServerErrorState` が一瞬出ないこと・401 が 1 本で収まることは実機で 1 回見ておく価値がある（AC-6a は SSR 直開き、AC-6b は `/notes` 系で、この組み合わせだけ観測されない）
  - 提案: `.thread/13/testing.md` に「サインイン済みで `/settings/profile` → 別タブでサインアウト → 元タブで `/settings/auth` タブをクリック」を 1 手順足し、`/signin?redirect=/settings/auth` に着くこと・設定カラムにエラー表示が閃かないことを見る

- **[W-008]** `CLAUDE.md` の Presentation 節が挙げる「load-bearing files」に、本 PR が作った 2 モジュールが入っていない
  - 場所: `CLAUDE.md`（Architecture → Presentation の列挙）
  - 理由: `presentation/sessionGuard.ts`（redirect 決定の唯一の置き場）と `presentation/appConfig.ts`（`RouterContext` の供給源）はどちらも横断的で、列挙されている `serverAction.ts` / `errorResponseMiddleware.ts` / `serverFragment.tsx` / `validator.ts` / `session.ts` と同格。plan は「`spec/` / `CLAUDE.md` への昇格は片付けフェーズの昇格ゲートで判定」としてスコープ外に置いているので**この PR のブロッカーではない**が、落とすと二度と拾われないので記録として残す
  - 提案: 昇格ゲートで、Presentation の列挙に 2 件を追加するか否かを明示的に判定する（`spec/presentation/index.md` の `AppConfig` 節が署名鍵の供給元を `AppConfig` と読める件も、ADR-001 の前提と衝突するので同じゲートで扱う）

## 受け入れ基準の確認（担当観点ぶん）

| AC | 判定 | 根拠 |
|---|---|---|
| AC-5（`head` 出力の一致） | 構造的に成立 | `head` の本体は 3 ファイルとも 1 行も変わっておらず、`match.context?.config` の供給が root context + `hydrate`（`matchRoutes` の前に走ることを `ssr-client.ts:99-102` で確認）に置き換わっただけ。実測は手動側に残る |
| AC-8（スケルトンに戻らない） | 構造的に成立 | 既訪 match は `loaderShouldRunAsync` で背景ロードになり、`updateMatch` は `router.startTransition`（React 19）内で走るので、新しい未解決 promise へ差し替わっても Suspense はフォールバックへ戻らない |
| AC-9a / AC-9b（スケルトンの出方） | **要再定義** | W-005 のとおり、畳み込み後は `/notes` も `/settings/*` も「1 往復ブロック → URL 確定 → 断片ストリーム」で同型。期待値の書き分けが実態と合わない |
| AC-12（上部バーの表示） | 成立 | `useRouteContext` の残存 0 件。`AppShell` は `notes/index.tsx:39` と `settings/route.tsx:72` の 2 箇所で `useLoaderData` 由来の `user` を受ける。`SettingsTabs` は `user` を参照しない。`DeleteAccountPanel` は `useLoaderData({ from: "/settings" })` で `user: AuthenticatedUserView \| null` を受け、`currentUserId` の導出も従来どおり |
| AC-13（二重化の記述の除去） | **字面のみ成立 → B-001** | L.113 / L.545 の 2 箇所はいずれも書き換わり、2 つの形・「権威はハンドラー側」も書かれた。ただし置き換え後の「2 系統」の片方が発火しない |
| AC-14（`requireAuthenticated` の全消し） | 成立 | `apps packages docs spec README.md` を grep して 0 件 |
| AC-10（typecheck / test） | 成立 | 本レビュー中に `pnpm typecheck` rc=0、`pnpm test` 930 passed / 3 skipped を確認 |

スコープ越えの変更は見当たらない。`signin.tsx` / `settings/route.tsx` の `safeRedirectPath` の import 元差し替えは `auth.ts` の再エクスポート削除に伴う機械的な追随で、`redirect.ts` の `SameOriginPolicy` 委譲は ADR-004 の範囲内（`packages/core/src/domain/identity/services/sameOriginPolicy.ts` の述語は旧実装と 1 対 1 で、`redirect.test.ts` 全ケースが通ることを確認済み）。

## カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`
- 差分外の参照: `CLAUDE.md`, `README.md`, `docs/test.md`, `apps/web/app/components/ui/Deferred/index.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`, `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/errorResponseMiddleware.ts`, `apps/web/app/routes/settings/{danger,profile}.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`, `packages/core/src/application/identity/authenticateSession.ts`, `packages/core/src/application/di/types.ts`, `@tanstack/router-core@1.171.15`（`load-matches.ts` / `router.ts` / `ssr/ssr-client.ts`）, `@tanstack/start-client-core@1.170.14`（`createServerFn.ts`）
- スキップ: `.thread/13/` 配下（`plan.md` / `steps.md` / `adr.md` / `testing.md`）— 計画ドキュメントのため指示によりレビュー対象外（`plan.md` は受け入れ基準の照合に読んだ）
