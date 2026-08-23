# レビュー 002 — ノート閲覧のフロントエンド体験・ドキュメント整合

**PR:** #36 / **ベース:** main / **ラウンド:** 2（ゼロベース）
**契約:** `.thread/13/plan.md` / **既出判定:** `.thread/13/review/triage-keys.md`

## 前提の確認（受け入れ基準のうち本観点に関わるもの）

| AC | 判定 | 根拠 |
|---|---|---|
| AC-9a（`/notes` 系の断片ストリーミング） | 満たす | `routes/notes/index.tsx:20-23` / `$noteId.tsx:20-26` の loader はブリッジの promise をそのまま返し、`renderServerFragment(...)` は `-action.tsx:30,49` で未解決のまま返る。`<Suspense fallback={<NoteListSkeleton/>}>` + `Deferred` は無傷 |
| AC-9b（`/settings/*` はブロッキング） | 満たす | `settings/route.tsx:33-53` はオブジェクト形 + `staleReloadMode: "blocking"`。`router-core@1.171.15` `load-matches.js:458` が `typeof routeLoader === "function" ? void 0 : routeLoader?.staleReloadMode` を読むので、オブジェクト形でのみ有効という主張は実物どおり。子の断片ルート（`settings/profile.tsx:18-21` ほか）は従来どおり未解決 promise を転送しており、設定画面の体感は退行していない（`main` の `beforeLoad` も `sessionUserFn()` を await してブロックしていた／今は子断片と並列に走るぶん短くなる方向） |
| AC-12（上部バーの表示） | 満たす | `/notes` は `Route.useLoaderData()` から `user` を取り（`notes/index.tsx:38`、ブリッジが `-action.tsx:29` で `user` を返す）、`/settings` は `settings/route.tsx:68` の `useLoaderData()`。`SettingsTabs` は元々 `user` を読んでいない（`components/layout/SettingsTabs/index.tsx` は `useRouterState` のパス名だけ）ので供給源変更の影響なし |
| AC-11（未サインインの `/settings/danger`） | 満たす | `settings/route.tsx:45-47` の `SIGNED_OUT_PATH` 分岐は `loader` へ移っても残り、`DeleteAccountPanel/index.tsx:111-112` は `useLoaderData({ from: "/settings" })` で `user?.userId ?? null` を維持。ticket 復帰の `currentUserId` 依存（同 148-154）も同値 |
| AC-13 / AC-14（doc の二重化記述・`requireAuthenticated`） | 満たす | `docs/frontend_implementation_example.md` から「guard は redirect / handler は 401」の二重化は L.117-126・L.567 の記述へ置き換わり、`requireAuthenticated` はリポジトリ全体（`.thread/` を除く）で 0 件 |
| スコープ逸脱 | なし | 17 ファイルすべてが plan のステップ 1〜6 と round 001 triage の `fix` 行に対応する。`spec/adr/030` の改訂は plan.md:62 が除外した「本 Issue の設計判断の昇格」ではなく「本 PR が偽にした既存 canon の訂正」で、triage の判断どおり |

補助的に `pnpm typecheck`（rc=0）と `vitest run apps/web/app/presentation/__tests__/redirect.test.ts`（12 passed）を実行した。作業ツリーへの変更は加えていない。

## Blockers

なし。

## Warnings

- **[W-001]** `docs` が `boundedRedirectSource` を「上限まで切り詰める（clamp）」と説明しているが、実装は**遷移元の値を丸ごと `/notes` に差し替える**。読者が別実装を書く。
  - 場所: `docs/frontend_implementation_example.md:86-88`（「`boundedRedirectSource` clamps `location.href` to the same ceiling the bridge's validator enforces」）/ 同 `:426-428`（「it is bounded here (the same ceiling the loader clamps to)」）/ 実装は `apps/web/app/presentation/redirect.ts:31-33`
  - 理由: `clamp to the ceiling` は自然に `href.slice(0, REDIRECT_MAX_LENGTH)` と読める。実際の `boundedRedirectSource` は `href.length <= REDIRECT_MAX_LENGTH ? href : "/notes"` で、**上限を 1 文字でも超えたら遷移元の情報を全部捨てる**。UX 上も「サインイン後に元の場所へ戻る」が「`/notes` に着く」へ変わる、観測可能な差である。doc の言い方に従って truncate 実装に書き換えると、切り詰めた壊れたパスが `safeRedirectPath` を通ってしまう（`/notes?q=…` の途中で切れた文字列は同一オリジンパスなので弾かれない）ため、誤読は実害に直結する。コード側の JSDoc（`redirect.ts:26-30`）は「倒し先は `safeRedirectPath` が弾いたときと同じ `/notes`」と正しく書けているので、ずれているのは doc だけ
  - 提案: 2 箇所とも「clamp」をやめ、`falls back to the default destination (`/notes`) when `location.href` exceeds the ceiling the bridge's validator enforces — the return path is dropped, not truncated` の意で書き直す

- **[W-002]** round 001 が塞ごうとした「`safeRedirectPath` を通さずに `/signin` の options を組み立てる」形が `/settings` レイアウトにそのまま残っており、そこだけテストの網の外にある。
  - 場所: `apps/web/app/routes/settings/route.tsx:48-51` / 対比: `apps/web/app/presentation/sessionGuard.ts:16-18`, `apps/web/app/presentation/redirect.ts:39-44`
  - 理由: triage の fix #25（`routing W-005 / note-docs W-006`）の動機は「将来 `search: { redirect: redirectTo }` に書き換えられても CI が緑のまま通りオープンリダイレクトが復活する」だった。その対策として `signInRedirectOptions` を切り出して `redirect.test.ts:56-89` で固定したのは正しいが、**同じ options を組み立てるもう 1 箇所（`/settings` レイアウトのガード）は素の `redirect({ to: "/signin", search: { redirect: safeRedirectPath(location.href) } })` のまま**で、`signInRedirectOptions` を経由していない。結果として (a) リポジトリ内に「サインインへ戻す」書き方が 2 通り存在し、(b) 塞いだはずの書き方の実例がコード上に残り（次に真似される形がこちら）、(c) この経路だけ単体テストが 1 件も掛かっていない。`docs/frontend_implementation_example.md:547` の表は `redirect.ts` を「Pure functions the decision is made of」と説明しており、決定が 2 系統ある現状と食い違う
  - 提案: `settings/route.tsx` を `throw redirect(signInRedirectOptions(location.href));` に寄せる（`safeRedirectPath` の直接 import も落ちる）。倒し先の既定を変えたくない事情は無い（どちらも `/notes`）

- **[W-003]** `/signin` の `validateSearch` が `2048` を素の数値で持ったままで、本 PR が導入した `REDIRECT_MAX_LENGTH` と静かにドリフトしうる。
  - 場所: `apps/web/app/routes/signin.tsx:11`（`z.string().max(2048).optional().catch(undefined)`）/ 定数は `apps/web/app/presentation/redirect.ts:23`
  - 理由: 本 PR は `signin.tsx` の import 行を `@/presentation/auth` → `@/presentation/redirect` に付け替えており、**同じモジュールから定数を引ける状態になっているのに数値リテラルを残した**。失敗経路は具体的で、`REDIRECT_MAX_LENGTH` を 4096 に上げると、ブリッジの `.validator`（`routes/notes/-action.tsx:17`）は 3000 文字の `redirect` を受理して `/signin?redirect=<3000 文字>` へ飛ばすが、`signin.tsx` の `.max(2048).catch(undefined)` が**エラーも出さず握り潰す**ので `safeRedirectPath(undefined)` → `/notes` になり、「サインイン後に元の場所へ戻る」が無言で壊れる。`.catch(undefined)` があるぶん検知が効かない
  - 提案: `signin.tsx` で `REDIRECT_MAX_LENGTH` を import して `.max(REDIRECT_MAX_LENGTH)` にする。`docs/frontend_implementation_example.md:333` が `paginationSearchSchema` / `paginationSchema` について「both `.pipe(...)`-derived from the same field-level validators so the ceilings cannot drift between a route and a server function」と書いている方針とも揃う

- **[W-004]** doc が `REDIRECT_MAX_LENGTH` の出所を一度も書いていない。掲載されている import ブロックにも、モジュール表にも無い。
  - 場所: `docs/frontend_implementation_example.md:415-430`（`-action.tsx` の import ブロックを 5 行すべて列挙したうえで L.429 が `REDIRECT_MAX_LENGTH` を、L.456-461 が `boundedRedirectSource` を、import 無しで使う）/ 同 `:547`（`presentation/redirect.ts` の Exports 欄が `safeRedirectPath`, `signInRedirectOptions`, `boundedRedirectSource` の 3 つで、`REDIRECT_MAX_LENGTH` が抜けている）
  - 理由: doc は冒頭 L.3 で「Every path and identifier below points at real code」と宣言しており、import ブロックを省略記号なしで全量掲載している以上、そこに無い識別子は読者から見て出所不明になる。実物 `apps/web/app/routes/notes/-action.tsx:4` は `import { REDIRECT_MAX_LENGTH } from "@/presentation/redirect";` を持つ。あわせて、doc は同一ファイル（`notes/-action.tsx`）を L.53-69 と L.415-446 の 2 箇所で抜粋しながら `z.string().min(1).max(REDIRECT_MAX_LENGTH)` を 2 度インラインで書いているが、実物は `const redirectField`（同 17）を 2 つのスキーマで共有している — 「上限は 1 箇所で定義する」という W-003 と同じ意図が、doc からだけは読み取れない
  - 提案: L.418-422 の import ブロックに `REDIRECT_MAX_LENGTH` を足し、L.547 の Exports 欄に定数を加える。可能なら doc 側も `redirectField` を共有する形に合わせる

- **[W-005]** `spec/adr/030` の追記が「失効後は前の `loaderData` が出る」を無条件の事実として書いており、実際より広い。canon として過剰。
  - 場所: `spec/adr/030-auth-state-transition-transport.md:33`
  - 理由: 背景枝に落ちるのは `load-matches.js:435-436` の `status === "success" && (invalid || shouldReload)` を満たす match、すなわち**既訪（キャッシュ済み）の match だけ**である。`/notes` から未訪問の `/notes/:noteId` へ初めて入る遷移は `status !== "success"` なので同 450 の `await runLoader` を通り、直前の `loaderData` を描画しないまま `/signin` へ抜ける。ADR の現文は「別タブでのサインアウトとサーバー側の失効は…その 1 往復のあいだ直前の `loaderData` が表示されてから `/signin` へ遷移する」と読め、初回遷移でも窓が開くと誤読させる。同じ性質を `routes/notes/index.tsx:16-18` と `$noteId.tsx:16-18` のコメントは「**既訪** match の再実行は背景枝に落ちるので」と正確に限定して書けており、canon 側だけが緩い。さらに、この挙動を決めた ADR は `.thread/13/adr.md` の ADR-003 で `spec/` に無いため、読者は「なぜこの窓を許容したのか」へ辿れない
  - 提案: 「`/notes` `/notes/:noteId` の**既訪 match** へ戻る遷移では…」と限定する（初回遷移はブロッキングで窓が開かないことも 1 句添える）。昇格ゲート（plan.md:62 / Phase 7）で ADR-003 を `spec/adr/` に上げる案件として拾えるよう、triage に載せておくとよい

- **[W-006]** doc の「Every `head` must stay written as `if (!config) return {}`」が root の実装と一致しない。
  - 場所: `docs/frontend_implementation_example.md:945` / 実装は `apps/web/app/routes/__root.tsx:40-43`
  - 理由: root の `head` は `if (!config) return { links: baseLinks };` で、config が引けなくてもスタイルシートと favicon のリンクは出す（出さないと未スコープ要求の SSR がスタイル無しで描かれる）。doc の言い方をそのまま守ると root の分岐を `return {}` に「直す」改変を誘発し、`appCss` と `SITE_ASSET_LINKS` が落ちる。守らせたい不変条件は「`config` が `undefined` のときに `config` を触らないこと」であって「`{}` を返すこと」ではない
  - 提案: 「Every `head` must keep its `if (!config)` early return（root だけは baseLinks を返す）」の意に直す

## カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`
- スキップ: なし

差分外で参照したもの: `apps/web/app/routes/settings/{index,profile,danger}.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`, `packages/core/src/application/di/containerStore.ts`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`, `spec/adr/051-*.md`, `node_modules/@tanstack/router-core@1.171.15` の `load-matches.js` / `ssr/ssr-client.js` / `router.js`。

## 蒸し返しを避けた既出項目

- `routes/notes/{index,$noteId}.tsx` の `/settings` 固有の但し書き複製（note-docs W-004 / wont-fix・ADR-003 が要求した内容）— 本ラウンドでも指摘しない
- `CLAUDE.md` の load-bearing files に `sessionGuard.ts` / `appConfig.ts` が未掲載（note-docs W-008 / wont-fix）
- `<link rel="canonical">` の重複（routing W-007 / defer・#37）、`spec/presentation/index.md` の `AppConfig` 節の矛盾（auth W-003 (2) / defer・#38）
- 手動検証の実行証跡（auth W-005 / wont-fix・Phase 4 の担当）

## 検証済みで問題なしと判断した点（記録）

- **doc の識別子突き合わせ**: `signInRedirectOptions` / `boundedRedirectSource` / `REDIRECT_MAX_LENGTH` / `requireSessionOrRedirect` / `sessionUserFn` はいずれも実在し、doc の説明と実装のシグネチャが一致（例外は W-004 の出所欠落と W-001 の語義）。`getInstalledStore()?.getStore()?.config` は `containerStore.ts:25-27` の実物どおりで、`getContainer()` が throw する（同 39-57）ため `getRouter()` の全要求経路で使えないという doc L.342 の理由づけも正しい
- **`staleReloadMode: "blocking"` / `shouldReload` の記述**: `load-matches.js:430-436,458` で裏取り済み。`shouldReload ?? staleMatchShouldReload` が右辺へ落ちないので `staleTime` / `preloadStaleTime` が死ぬという doc L.122・L.499 の主張は正確
- **`hydrate` が `matchRoutes` より前**: `ssr/ssr-client.js:44-45` が `await router.options.hydrate?.(...)` → `router.matchRoutes(...)` の順。`router.tsx:16` のコメントと doc L.927-928 は正しい
- **並列化の主張**: `load-matches.js:527-529` が `matchPromises.push(loadRouteMatch(...))` → `Promise.all` なので、doc L.120 の「`loader`（run through `Promise.all`）」は正確。redirect は index 順の settled 走査で親（index 0）が先に throw される（同 530-540）
- **preload でのホバー時ナビゲート**: `router.js:742-778` の `preloadRoute` は redirect を受けても `navigate` せず遷移先を再 preload するだけなので、未サインインでノートカードにホバーしても `/signin` へ実ナビゲートしない（`/settings` 側の同種の退行は round 001 B-001 で修正済み）
- **`redirect.test.ts` の実効性**: 12 件 pass。`atLimit` = 2048 / `overLimit` = 2049 の境界計算も正しい（`"/notes?q="` は 9 文字）。敵性値ループは `//evil.example` / `https://…` / バックスラッシュ / 生 LF / `javascript:` / `undefined` / `null` を網羅し、`/%0Aevil` が通ることも AC-7 の期待どおり固定している
- **残すべきでないコメント**: コード側に修正の経緯・弁明は残っていない。ルートのコメントはいずれも WHY（`shouldReload` の関数形の理由、効能の範囲、`staleReloadMode` がオブジェクト形でしか読まれないこと）で、ADR-003 が明示的に要求した内容
