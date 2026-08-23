# 実装計画 — Issue #13: ナビゲーションごとの RPC 3往復を削減する

**Issue:** #13
**作成日:** 2026-08-23
**規模:** 通常
**実装方針:** steps.md

---

## 目的

クライアント側のページ遷移 1 回につき直列に 3 回発生している server function 往復を、認証ルートで 1 段（`/notes` 系は 1 要求、`/settings/*` は並列 2 要求）に、公開ルートで 0 要求に減らす。**ガードがナビゲーションごとに再判定される性質は落とさない**（ADR-003）。

## 受け入れ基準

**計測環境の別:**

- AC-1〜4, AC-9a, AC-9b … `pnpm dev`（`staleTime: 0`）
- AC-8 … 本番ビルド（`pnpm build && pnpm start`、`staleTime: Infinity`）
- AC-6 … **DEV と本番の両方**で同じ結果になること（ADR-003 の `shouldReload` はこの 2 環境差を消すために入れている）。**ただし「`shouldReload` を書き忘れたか」を判別できるのは本番側の 1 回だけ**である — DEV（`staleTime: 0`）では `cause === "enter"` だけで `staleMatchShouldReload` が真になるので、`shouldReload` の有無で差が出ない。したがって `shouldReload` の有無を分ける観測点は **AC-6b の本番実行**と **AC-3b（`/settings` タブ間・DEV で差が出る側）**の 2 つであり、AC-6b の DEV 実行は「環境差が消えたこと」の確認としてのみ意味を持つ
- AC-5, AC-7, AC-11〜14 … 環境非依存

DevTools Network を **`_serverFn`** で絞り、"Preserve log" を有効にして計測する。**「直列段数」は Network パネルの `Start Time` 列（数値）で判定する** — 後続要求の開始時刻が先行要求の完了時刻以降なら直列。目視の Waterfall だけに頼らない。`main` 側とブランチ側の HAR を保存して `.thread/13/` に添え、第三者が同じ判定に到達できるようにする。

**preload 要求の扱い（本数の母集合）:** `apps/web/app/router.tsx:11` は `defaultPreload: "intent"` で、`NoteList` のカードも `SettingsTabs` も素の `<Link>` なので、クリックの前にホバー／フォーカスで preload の `_serverFn` が飛ぶ。下表の「本数」は **クリック（またはブラウザ戻る）の時刻以降に `Start Time` を持つ `_serverFn` 要求だけ**を数える。ホバーで飛んだ preload 要求は本数に含めず、**HAR とあわせて別欄に記録する**。手順上の条件は 2 つ:

- **`defaultPreload` は計測中も外さない。** 本番では子の断片ルート（`/settings/{profile,auth,usage}`）の preload 結果がクリック時にそのまま再利用される（`staleTime: Infinity` かつ `shouldReload` を持たないため）。外して測ると「変更後」の実態と違う数字になる。
- **preload が完了してからクリックする。** preload が in-flight のままクリックすると、`loadRouteMatch`（`@tanstack/router-core@1.171.15` `src/load-matches.ts:893-904`）が `prevMatch._nonReactive.loaderPromise` を見て早期 return するため、ガードの再実行がその遷移から落ち、**本数が 1 本少なく出る**。ガードそのものは preload 側の背景ロードで走り、redirect も同ファイル 843-847 の背景枝が `router.navigate` で拾うので挙動は壊れない — 落ちるのは要求の本数だけである。

「変更前」を `main` で取り直すときも同じ 2 条件で取る。

下表の「変更前」は本計画時点の設計上の期待値であり、**`main` での実測値で置き換える**。

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | サインイン済みで `/notes` へクライアント遷移したとき、`_serverFn` 要求は **1 本 / 直列 1 段**（変更前: 3 本 / 3 段） | Issue 本文「3 往復」 | 1, 2, 3 |
| AC-2 | 同じく `/notes/:noteId` へのクライアント遷移で **1 本 / 直列 1 段**（変更前: 3 本 / 3 段） | Issue 本文「`renderNoteDetail`」 | 1, 2, 3 |
| AC-3a | `/notes` → `/settings/profile`（`/settings/*` へ**外から入る**遷移）で **2 本が同時開始 / 1 段**（変更前: 3 本 / 3 段） | Issue 本文「ナビゲーションごと」 | 1, 4 |
| AC-3b | `/settings/profile` → `/settings/auth`（**タブ間**遷移）で **2 本が同時開始 / 1 段**（変更前: 3 本 / 3 段）。2 本の内訳はレイアウトのガードと子の断片で、**レイアウト側は `shouldReload` によって再実行される**（これが無いと 1 本になるが、それは AC-6 の再判定を失うことと同義） | Issue 本文「ナビゲーションごと」/ ADR-003 | 1, 4 |
| AC-3c | `/settings/profile` → `/settings/danger`（タブ間・`danger` は loader を持たない）で **1 本 / 1 段**（変更前: 2 本 / 2 段） | 同上 | 1, 4 |
| AC-4 | `/signin` `/signup` `/terms` `/privacy` `/verify-email` `/reset-password` へのクライアント遷移で `_serverFn` 要求が **0 本**（変更前: 1 本 = root の `loadAppContext`） | Issue 本文「`loadAppContext` は毎ロード実行される」 | 1 |
| AC-5 | 代表ルート `/`, `/signin`, `/terms`, `/notes`, `/notes/:id`, `/settings/profile`, **未サインインの `/settings/danger`** の `<head>` 出力（`title` / `description` / `canonical` / `og:*` / `twitter:*` / `theme-color`）が変更前と一致する。**SSR の初期 HTML**（`view-source:`）と**クライアント遷移後の DOM**（DevTools Elements）の両方で確認する。17 箇所の `head` 実装をすべて見ないのは、**`head` の本体を 1 行も変えず `match.context?.config` の供給経路だけを差し替えるため**（ADR-001）— 代表集合は供給経路の分岐（SSR 直開き / ハイドレーション後のクライアント遷移 / 公開ルート / 親ガードが redirect を投げない分岐）を網羅している | Issue 本文「head 生成への影響を確認する」 | 1 |
| AC-6a | 未サインインで `/notes` / `/notes/:noteId` / `/settings/auth` を**直接開く**（SSR）と `/signin?redirect=<元のパス>` へ遷移し、サインイン後に元のパスへ戻る。未サインインで `/settings` を開いた場合の着地は `/signin?redirect=/settings/profile`（`/settings/` index の `beforeLoad` がレイアウトのガードより先に走るため。変更前は `/signin?redirect=/settings`） | 既存挙動の維持（`requireAuthenticated`）/ ADR-002 | 2, 3, 4 |
| AC-6b | サインイン済みのタブ A で `/notes` → `/notes/:id` と遷移して**両方を訪問済みにしてから**、タブ B でサインアウト → タブ A でブラウザ戻る（または `ReaderShell` の「ノート一覧」リンク）としたとき、`/signin?redirect=/notes` へ遷移する。**サインアウトは `/notes/:id` へ着いたあとに行う** — 先にサインアウトすると `/notes/$noteId` はその時点で初めて作られる match（`cause: "enter"` / `status !== "success"`）になり、`load-matches.ts:848` の `status !== 'success' \|\| loaderShouldRunAsync` 枝で `shouldReload` を参照せずに loader が走るため、着地が `/signin?redirect=/notes/$noteId` になり ADR-003 が閉じた経路（`staleTime: Infinity` の**既訪** match）を一切踏まない。戻り先の `/notes/` が cached match（`status: "success"` / `cause: "enter"`）であることがこの AC の成立条件。**DEV と本番ビルドの両方で同じ結果になること**（`staleTime: Infinity` でもガードが再判定される = ADR-003 が効いている証拠。ただし `shouldReload` の有無を判別できるのは本番側 — 上の「計測環境の別」を参照） | 既存挙動の維持 / ADR-003 | 2, 3 |
| AC-7 | 未サインイン状態で、DevTools から `renderNoteList` のブリッジ要求（`/_serverFn/...`）をコピーし、`redirect` 入力を差し替えて再送したとき、**JSON の値として** `//evil.example` / `https://evil.example` / `/\evil.example` / **生の LF を含む** `"/\n/evil.example"` を送った場合は応答の redirect 先が `/signin?redirect=/notes` になる。**文字列 `"/%0Aevil"` は `/signin?redirect=/%0Aevil` としてそのまま通るのが正**（`SameOriginPolicy.isSameOriginPath` はパーセントエンコードを**復号しない**ので `"/%0Aevil"` は同一オリジンパス。復号が不要な根拠は、この値の最終消費点が `SignInForm` の `router.history.push` に渡る生文字列であり、別オリジンへ解決しないこと）。同じ手順で `redirect` に 2049 文字を送ると **422**（`.validator` の上限超過）になる。**400 ではない** — `presentation/validator.ts:8-24` の `InputValidationError` は `kind: "validation"` / `code: "INVALID_INPUT"` で、`presentation/errorResponse.ts:117-129` の `HTTP_STATUS_BY_CODE.validation` に `INVALID_INPUT` の例外が無いため `HTTP_STATUS_BY_KIND.validation = 422`（同 102-111）に落ちる（`spec/presentation/index.md:196,213` の状態表とも一致） | 転送境界での入力検証（ADR 051 と同じ不変条件） | 2, 3 |
| AC-8 | 本番ビルド（`pnpm build && pnpm start`）で `/notes` → `/notes/:id` → ブラウザ戻る、としたとき 2 回目の `/notes` 表示は **`_serverFn` 1 本**（`shouldReload` によりガードを載せた loader が必ず再実行される）。その再取得は**背景で走る**ため、**遷移は即座に settle し、前回の一覧が表示されたまま置き換わる（スケルトンに戻らない）**。**「1 本」はステップ 1 が入って初めて成立する** — ステップ 3 だけを入れた状態では root の `beforeLoad` が `staleTime` を見ずに毎ロード `loadAppContext` を撃つので 2 本になる。**`staleReloadMode: "blocking"` は `/settings` レイアウトにだけ置き、`/notes` 系には置かない** — `/notes` 系に置くと再取得が背景枝から同期ロードへ移り、スケルトンに戻って本基準が壊れる | 既存の断片ストリーミング契約の維持 / ADR-003 | 1, 3 |
| AC-9a | `/notes` / `/notes/:id` への**初回**クライアント遷移で、**ブリッジ応答の断片部分が届くより前に URL が確定しスケルトンが表示される**。loader が await するのはガードの 1 往復（ハンドラー本体が返るまで）だけで、断片の promise は未解決のまま返るため。これは `renderNoteList` の中で断片を await してしまう実装ミスを落とす基準。**「0 往復で settle する」ではない** — ガードの 1 往復ぶんはブロックするので、その応答が 200ms を超えれば `defaultPendingComponent` が挟まる。これは退行ではなく AC-9b と同型である | `CLAUDE.md` フロントエンド規約 | 3 |
| AC-9b | `/settings/profile` への**初回**クライアント遷移では、**レイアウトのガード応答が返ってから** URL が確定し、子の断片スケルトンが表示される。ステップ 4 でレイアウトに載る loader は `sessionUserFn()` を await する**本物のブロッキング loader**（`staleReloadMode: "blocking"` を明示し、既訪 match の再実行も背景枝へ落とさない）で、断片ブリッジのように未解決 promise を返さないため。**これは本 Issue が新しく作る副作用ではない** — 変更前の `/settings` レイアウトも `beforeLoad` で `sessionUserFn()` を await しており、その待ち時間にも `router.tsx` の `defaultPendingMs: 200` は掛かっていた。本 Issue が変えるのは待ち時間の長さ（3 段 → 1 段）だけで、むしろ短くなる方向なので、**実測時に「変更前後で `defaultPendingComponent` の有無が変わった」と記録しない**こと。**AC-9a とは構造が同型**（どちらもガード 1 往復ぶんブロックしてから settle し、断片はスケルトンでストリームする。200ms を超えれば両方に `defaultPendingComponent` が挟まる）で、違うのは往復の内訳だけ — `/notes` 系はガードと断片が 1 要求に畳まれ、`/settings/*` はガードと断片が別 match の 2 要求として並列に走る | `CLAUDE.md` フロントエンド規約（ストリーミングする route と本当にブロックする route の区別） | 4 |
| AC-10 | `pnpm typecheck && pnpm lint:fix && pnpm format` と `pnpm test` が通る | プロジェクト規約 | 7 |
| AC-11 | **未サインインで `/settings/danger` を直接開くと `/signin` へ飛ばずにパネルが描画される**（`SIGNED_OUT_PATH` 分岐）。また `/settings/danger` で削除を受理した直後（受理と同時にサインアウトされる）にリロードすると、退避済み ticket から進捗表示が復帰する | 既存挙動の維持（`SIGNED_OUT_PATH`） | 4 |
| AC-12 | `/notes` と `/settings/*` の上部バー（`AppShell`）に表示名とアバターが従来どおり表示される（`user` の供給源が `routeContext` → `loaderData` に移っても壊れていない） | 既存挙動の維持 | 3, 4 |
| AC-13 | `docs/frontend_implementation_example.md` に「ルートガード（`beforeLoad`）は redirect、ハンドラーは `requireSession()` で 401」という**二重化の記述が残っておらず**、2 つの形（同一 match は畳む / 別 match は並列にする）、「権限判定の権威はハンドラー側」、および**畳んだブリッジは「セッション無し → redirect / 主体が無効 → 401」の 2 系統を返す**ことが書かれている。**二重化の主張は 2 箇所にある** — L.113（`#### Streaming variant` 節）と **L.545**（`## Shared server logic (authentication helper)` 節 L.482-546 の締め。「the guard makes navigation land on `/signin`, the in-handler check makes a direct POST return 401」＝ L.113 と同一の主張）。両方が消えていることを確認する | ドキュメント成果物（ADR-002 影響欄） | 6 |
| AC-14 | `apps/web/app/presentation/auth.ts` に `requireAuthenticated` が存在せず、リポジトリ全体を `grep` しても参照が残っていない。**docs 側の出現は 4 箇所**（`docs/frontend_implementation_example.md` L.79 = `#### Streaming variant` のコード例 / **L.433** = `## Route definition` 節 L.393-481 の `$noteId.tsx` 例 / **L.531** = `## Shared server logic (authentication helper)` 節 L.482-546 の**実装全文の掲載** / **L.545** = 同節の締めの本文）で、コード側（ステップ 5）だけを消しても `grep` は通らない | 死んだ導線を残さない | 5, 6 |

## スコープ

### 含まれないもの

- **トップ `/` の `sessionUserFn` 往復**。サインイン済みを `/notes` へ飛ばすだけのガードで、統合できる断片を持たない。root の `loadAppContext` が消えれば `/` は 1 往復（`sessionUserFn` のみ）になり、それが下限。`/` は基本フルロードで入る画面なので本 Issue の「ナビゲーションごとの 3 往復」には当たらない。**除外の根拠を事後に裏づけるため、`/` へのクライアント遷移で `_serverFn` が 1 本になることだけは実測して記録する**（AC ではなく記録項目。AC-4 の公開ルート一覧に `/` が入らない理由もこれ）。**観測経路は「未サインインで `/signin` → `/`」（`AuthLayout` のロゴリンク）に固定する** — サインイン済みのシェル（`components/layout/AppShell`）に `/` へのリンクは無く（`to="/"` を持つのは `PublicShell` / `AuthLayout` / `OAuthCallbackPanel` だけ）、仮に起こしても `routes/index.tsx:12-17` の `beforeLoad` がサインイン済みを `/notes` へ redirect するため `sessionUserFn` のあとに `/notes` の loader がもう 1 本走り、記録値が 1 本にならない。未サインイン経路なら `/` の `beforeLoad` は `sessionUserFn` 1 本で止まり、「`loadAppContext` が消えたあと `/` の下限は 1 往復」という主張がそのまま裏づく。
- **`renderProfileForm` / `renderIdentityList` / `renderUsagePanel` を 1 本にまとめること**。`/settings` はレイアウトルートが認証ガードと `AppShell` を持ち、断片は子ルートが持つ別 match なので、`/notes` 系のようにガードと断片を 1 要求へ畳む形が構造的に取れない（並列化までが上限）。
- **ミューテーション系 server function の往復**。本 Issue はナビゲーション経路の話。
- **`spec/` への昇格**。設計判断は `.thread/13/adr.md` に残す。`spec/presentation/index.md` や `CLAUDE.md` へ上げるかは片付けフェーズの昇格ゲートで判定する。
- **`safeRedirectPath` を値オブジェクト（`SameOriginPath`）へ移行すること**。本 Issue では述語の委譲（`SameOriginPolicy.isSameOriginPath` を呼ぶ）までにとどめる — ADR-004。

## リスクと注意点

- **`getRouter()` を async にすると `Register.router` が `Promise<Router>` になる。宣言は 2 系統ある。** `apps/web/app/routeTree.gen.ts:430-438`（`@tanstack/react-start` 側・自動生成）は**既に `Awaited<ReturnType<typeof getRouter>>`** なので触らなくてよい。手書きの `apps/web/app/router.tsx:33-37`（`@tanstack/react-router` 側）だけが `ReturnType<...>` のままなので、ここを直す。忘れるとアプリ全域のルーター型（`Link` の `to` 補完、`useLoaderData` の型）が一斉に壊れる。typecheck で必ず出る。
- **`exactOptionalPropertyTypes: true`（`apps/web/tsconfig.json:24`）の下で `RouterContext = { config?: AppConfig }` は型エラーになる。** `resolveAppConfig()` の戻りが `AppConfig | undefined` なので、省略可能プロパティへ `undefined` を代入する形（`{ config } satisfies RouterContext`、`router.update({ context: { config: dehydrated.config } })`）が TS1360 で落ちる。**`{ config: AppConfig | undefined }`（省略可能ではなく `undefined` を明示的に含む形）で宣言する。** `head` 側の `match.context?.config` はそのまま通る。
- **`getRouter()` はサーバーでは要求ごとに呼ばれ、`getContainer()` は AsyncLocalStorage の外だと throw する。** `apps/web/app/server.node.ts:129` の `storage.run(container, () => entry.fetch(request))` の内側から `entry.fetch(request)` が呼ばれる構造に依存する。将来 prerender / shell 生成を入れると要求スコープ外で `getRouter()` が走りうるので、そのときはここが最初に壊れる。
- **ステップ 3 は `getRouter()` の呼び出し経路を 1 つ増やす。** `createStartHandler` は `getRouter()` を (a) `handleServerRoutes`（すべてのドキュメント要求とサーバールート要求 — `/storage/$` のアバター配信を含む）と (b) `handleRedirectResponse`（**未解決 redirect の解決時**）で呼ぶ。(b) は現状どの server function も redirect を throw しないので発火していないが、ステップ 3 で `renderNoteList` / `renderNoteDetail` が redirect を throw するようになると、**未サインインの断片要求のたびにルーターツリー構築 + `resolveAppConfig()` → `getContainer()` が走る**。いずれも `storage.run(...)` の内側なので動作はするが、上のトレードオフの適用範囲が広がる。
- **`router.tsx` はクライアントバンドルにも入る。** `@repo/core/application/di/containerStore` を静的 import すると サーバー DI グラフがクライアントへ漏れる。`createIsomorphicFn().server(...)` の中で動的 import する形を崩さないこと。
- **`head` の `matches` 配列はロード前のスナップショット**（`router-core` の `stores.pendingMatches.get()` を `loadMatches` が握り続け、`updateMatch` は各 match ストアに新しいオブジェクトを書く）。子ルートの `head` から root の `loaderData` は読めない。今回 root を `loader` へ移さない理由がこれで、**将来 `head` を `({ matches })` ベースで書き直そうとしたら同じ罠を踏む**。
- **`dehydrate: () => ({ config })` は、未サインインの公開ページを含む全ページの SSR ペイロードに `AppConfig` 全体を無条件で載せる。** 露出量そのものは現状の `loadAppContext` と同じでこの計画で増えるわけではないが、「`AppConfig` に秘密を入れない」が**転送の前提になる**。`AppConfig` を拡張する人がここに気づける形にしておく（ADR-001 Consequences）。
- **ガードを `loader` へ移すと、既定では `staleTime` と match の生存に鮮度が支配される。** 対処として `shouldReload` を入れる（ADR-003）。**`shouldReload` を入れ忘れると 2 つの形で壊れる**: (a) 本番（`staleTime: Infinity`）で既訪 match へ戻るとガードが再判定されない（AC-6b 不合格）、(b) `/settings` レイアウト match は子ルート間遷移で `cause: "stay"` かつ `previousRouteMatchId === match.id` になるため、**DEV（`staleTime: 0`）でもレイアウトの loader が再実行されない**（AC-3b・AC-6b 不合格）。
- **`shouldReload` は `preloadStaleTime` も一緒に無効化する。関数形で抑止できるのは cached match だけで、`/settings` レイアウトには効かない。** `shouldReload: true`（真偽値）だと、`defaultPreload: "intent"` の下で**読み込み済み**の `/notes/` `/notes/$noteId` にホバーするたび要求が飛ぶ。これは `shouldReload: ({ cause }) => cause !== "preload"` の関数形で閉じる。ただし `resolvePreload`（`src/load-matches.ts:53-55`）は `inner.preload && !router.stores.matchStores.has(matchId)` で、`matchStores` は**アクティブ match のプール**（`src/stores.ts:125,259-267`。cached は `cachedMatchStores` に分かれている）なので、`/settings/profile` にいる状態で `/settings/auth` を preload すると `/settings` レイアウト match はアクティブ → `preload = false` → `getLoaderContext`（同 620,635）が渡す `cause` は `"preload"` ではなく `"stay"` になる。**`LoaderFnContext` には他に preload を見分ける手掛かりが無い**（`preload` フィールドも同じ `resolvePreload` 由来）。したがってタブにホバーするたびレイアウトのガード要求が 1 本飛ぶ。**これは後退ではない** — `executeBeforeLoad`（同 388-531）にキャッシュ判定は無く、`handleBeforeLoad` も `shouldSkipLoader` しか見ないので、現行の `beforeLoad` ガードも今すでにホバーのたび飛んでいる（ADR-003）。
- **ホバー中のクリックはガードの再実行を 1 回落とす。** preload が in-flight のまま同じリンクをクリックすると、`loadRouteMatch`（`src/load-matches.ts:893-904`）が `prevMatch._nonReactive.loaderPromise` を見て `status === 'success' && !sync && !prevMatch.preload && shouldReloadInBackground` で早期 return するため、その遷移ではガードが再判定されない。ガード自体は preload 側の背景ロードで走り、redirect も同 843-847 が `router.navigate` で拾うので挙動は壊れないが、**AC の本数は 1 本ずれる**。受け入れ基準の前置きで「preload が完了してからクリックする」を計測条件に固定してあるのはこのため。
- **`/settings` のガードを loader へ移すと、未サインインでも子の断片 loader が並列に発火して 401 を 1 本無駄に打つ。** `loadMatches` は走査順（親が index 0）で redirect を先に throw するので遷移としては正しく `/signin` へ行くが、Network には 401 が 1 本残る。
- **未サインインで `/settings/*` を SSR 直開きする経路は、現状は起きていない組み合わせになる。** 子の断片 loader が親のガードと並列に走り、`renderProfileForm` が `ValidationError("UNAUTHENTICATED")` を投げて `errorResponseMiddleware` が `setResponseStatus(401)` を呼ぶ。実装上 `executeRouter` は `routerInstance.state.redirect`（307 の `Response`）をそのまま返すので ALS 側の 401 はドキュメント応答に出ないはずだが、**実機で「HTML 応答が 307 であり 401 でないこと」を 1 回確認する**（テスト方針 → 手動 7）。
- **`SIGNED_OUT_PATH` の分岐は、`loader` へ移すと判定のタイミングが変わる。** `beforeLoad` はナビゲーションごとに必ず走るが、`loader` は match 単位でしか走らない。`shouldReload` を入れれば再実行はされるが、**「パスが変われば再判定される」と読める書き方をしない**こと（ADR-002 Consequences / steps.md ステップ 4）。
- **server function からの `throw redirect` には制約がある**（`start-server-core` の `handleRedirectResponse`）。`to` は絶対パスで、`search` は関数ではなく静的な値でなければならない。`search: { redirect: safeRedirectPath(...) }` は満たすが、将来ここを関数形にすると SSR 側で throw する。
- **`docs/frontend_implementation_example.md` L.113 の「ルートガードは redirect、ハンドラーは 401 の二重化」が事実と食い違う。** `/notes` 系では二重化が 1 本になるので、記述を直さないとドキュメントが嘘になる（AC-13）。
- **`routeTree.gen.ts` は自動生成**（`@ts-nocheck` 付き）。root を `createRootRouteWithContext` にしたら `pnpm dev` か `pnpm build` で再生成し、差分をコミットに含める。

## テスト方針

### 自動

- `pnpm typecheck`（`Register.router` の型崩れ・`exactOptionalPropertyTypes` 違反はここで出る）
- `pnpm lint:fix` / `pnpm format`
- `pnpm test`（既存のユニットテストに退行がないこと。`presentation/__tests__/redirect.test.ts` の `safeRedirectPath` は今回サーバー側へ移る判定の中核であり、ADR-004 で中身を `SameOriginPolicy.isSameOriginPath` へ委譲するので、**既存ケースがそのまま通ることが委譲の回帰網**になる）

### 手動（往復数の観測）

計測手順を `.thread/13/` の実装フェーズ成果物（testing.md）に落とす。骨子は次のとおり。

1. **変更前の実測を先に取る。** `main` で `pnpm dev` → サインイン → DevTools Network を開き、フィルターに `_serverFn` を入力、"Preserve log" を有効化、**`Start Time` 列を表示**。
2. 次の遷移を **アプリ内リンク／ブラウザ戻る**（フルリロードではない）で行い、各遷移ごとに要求本数と `Start Time` を記録する。**リンクはホバーしてから preload の `_serverFn` が完了するのを待ってクリックし、preload 分と クリック以降の分を欄を分けて数える**（前置きの「preload 要求の扱い」を参照。`defaultPreload` は外さない）。遷移が終わるたびに **HAR を書き出して `.thread/13/` に保存**する。
   - `/notes` → `/notes/:noteId` → 戻る（AC-1 / AC-2）
   - `/notes` → `/settings/profile`（**外から入る** — AC-3a）
   - `/settings/profile` → `/settings/auth`（**タブ間** — AC-3b）
   - `/settings/profile` → `/settings/danger`（**タブ間・loader なし** — AC-3c）
   - `/notes` → サインアウト → `/signin` → `/signup` → `/terms`（AC-4）
   - **未サインインで** `/signin` → `/`（`AuthLayout` のロゴリンク。スコープ外の記録項目: 1 本）。サインイン済みの `/notes` → `/` では測らない — `AppShell` に `/` へのリンクが無く、`routes/index.tsx` の `beforeLoad` が `/notes` へ redirect し返すので 1 本にならない
3. ブランチで同じ手順を実行し、AC-1〜AC-4 の数値と突き合わせる。**変更前 / 変更後の表を残す**。
4. `<head>` の一致（AC-5）は、代表 7 ルート（`/`, `/signin`, `/terms`, `/notes`, `/notes/:id`, `/settings/profile`, 未サインインの `/settings/danger`）について変更前後の `<head>` を保存して差分を取る。SSR 初期 HTML とクライアント遷移後 DOM の両方。
5. 未サインイン経路（AC-6a / AC-11）はブラウザで直接 URL を叩いて確認する。`/settings` 直開きの `?redirect=` が `/settings/profile` になることも見る。
6. **別タブサインアウト（AC-6b）**: タブ A で `/notes` → `/notes/:id` と遷移して**両方を訪問済みにする** → **そのあとで**タブ B でサインアウト → タブ A でブラウザ戻る（または `ReaderShell` の「ノート一覧」リンク）。**DEV と本番ビルドの両方**で `/signin?redirect=/notes` に着くこと。**サインアウトの位置を先頭に戻さないこと** — `/notes/$noteId` は `/notes/` の子ではなく兄弟ルート（`routes/notes/route.tsx` は存在しない）なので、先にサインアウトすると `/notes/:id` は新規 match として `shouldReload` を参照せずに loader が走り、`/signin?redirect=/notes/$noteId` に着いて `shouldReload` の有無を判別できない。観測したいのは**既訪の `/notes` match へ戻る**経路（`status: "success"` / `cause: "enter"` → `shouldReload` → 背景再取得 → redirect を `router.navigate` が拾う）。`/notes` → `/terms` → `/notes` でも同じ。**判別が成立するのは本番側**で、DEV は `cause === "enter"` だけで再取得されるため `shouldReload` の有無で差が出ない（DEV 実行は環境差が消えたことの確認）。`shouldReload` を分けるもう 1 つの観測点は `/settings` タブ間の AC-3b（こちらは DEV で差が出る）。
7. **未サインインで `/settings/profile` を SSR 直開き**し、HTML 応答のステータスが **307**（401 ではない）であることを DevTools Network の Doc 要求で確認する。
8. open-redirect（AC-7）は `renderNoteList` のブリッジ要求を DevTools の "Copy as fetch" で取り出し、`redirect` 入力を差し替えて未サインイン状態で再送する。**弾かれる（`/notes` に倒れる）ことを見る検体は `//evil.example` / `https://evil.example` / `/\evil.example` と生の LF を含む `"/\n/evil.example"`**、**そのまま通ることを見る検体は `"/%0Aevil"`**（述語はパーセントエンコードを復号しないので同一オリジンパス）。2049 文字の検体の期待値は **422**（400 ではない）。
9. 本番ビルド（AC-8）: `pnpm build && pnpm start` で `/notes` → `/notes/:id` → 戻る。要求 1 本・スケルトンに戻らない・一覧が表示されたまま置き換わることを見る。
10. **スケルトンの出るタイミング（AC-9a / AC-9b）**: `/notes` へのクライアント遷移ではブリッジ応答の**断片部分が届く前**に URL 確定 + スケルトン、`/settings/profile` ではレイアウトのガード応答の**あと**に URL 確定 + 子断片スケルトン。**どちらもガード 1 往復ぶんはブロックする**ので、その応答が 200ms を超えれば両方に `defaultPendingComponent` が挟まりうる。挟まったことを退行として記録しない。
11. **上部バーの表示（AC-12）**: `/notes` と `/settings/*` の `AppShell` に表示名とアバターが従来どおり出ること（`user` の供給源が `routeContext` → `loaderData` に移っても壊れていない）。
12. **失効後の `/settings/*` を 2 経路で見る**（AC を持たない回帰項目）: サインイン済みで `/settings/profile` に居る状態で別タブサインアウトし、(a) タブ列に**ホバーだけ**しても `/signin` へナビゲートしないこと（`main` と同じ挙動であること）、(b) タブを**クリック**したら `/signin?redirect=/settings/auth` に着き、設定カラムに `ServerErrorState` が閃かないこと。レイアウトのガードをブロッキングにしていない場合はどちらも落ちる。

### 回帰

`spec/manual-tests/account.md` には「未サインインで `/settings/danger` を開く」手順が**実在しない**（TC-14 手順 1 はサインイン済みで開く、L.80 はサインアウト状態で `/settings/profile` を開く）。したがって既存手順を指すのはやめ、**AC-11 の 2 つの経路（未サインイン直開き / 削除受理直後のリロード）を `.thread/13/testing.md` に手順として書き下ろす**。ガードを `beforeLoad` から `loader` へ移す唯一の分岐条件がここにあるため、必須級の回帰項目として扱う。

あわせて `spec/manual-tests/account.md` の TC-12（サインアウト）・TC-14（アカウント削除）は既存手順のまま通す。

## 未解決事項

**なし。**

計画レビューは 3 周（上限）で終了した。3 周目の指摘 6 件（coverage P-301 / S-301 / S-302、arch P-401 / S-401 / S-402）はすべて反映済みで、見送った指摘は 1 周目の cov S-005（削除予定の足場 `research.md` への転記）1 件のみ、これは計画の実行に影響しない。3 周目のアーキ視点レビューはステップ 1〜5 のコード例を作業ツリーへ実際に適用して `pnpm exec tsgo --noEmit` rc=0 と `redirect.test.ts` 7 passed を確認しており（適用後 revert 済み）、型・依存順・フレームワーク挙動の前提は実測で裏が取れている。

残る不確実性は**実装時に実測で解消する性質のもの**であり、計画の未解決事項ではない — 具体的には (a) 受け入れ基準の「変更前」列（`main` での実測値に置き換える）、(b) 未サインインで `/settings/*` を SSR 直開きしたときの HTML 応答が 307 であること（現状は起きていない組み合わせ・手動 7）、(c) `spec/presentation/index.md` / `CLAUDE.md` への昇格可否（片付けフェーズの昇格ゲートで判定、スコープ外と明記済み）の 3 点。いずれも手順とその根拠が本計画に書き下ろされている。
