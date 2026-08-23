# レビュー 002 — 認証・セッション

対象: PR #36 / round 002（1 ラウンド目の指摘 16 件反映後）
差分: `.thread/13/` を除く変更ファイル 17 件すべてをゼロベースで確認した。

## 総評（先に結論）

- **1 ラウンド目の修正で新しいバイパス経路は生まれていない。** `/settings` の `loader` オブジェクト形 + `staleReloadMode: "blocking"`、`boundedRedirectSource` の clamp、`signInRedirectOptions` の純関数化、`resolveAppConfig` の `undefined` 返し — 4 つとも実装を `@tanstack/router-core@1.171.15` のソースと突き合わせて検証し、ガードのスキップ・二重リダイレクト・オープンリダイレクトのいずれも作っていないことを確認した（下の「確認して問題が無かった点」に検証根拠を残す）。
- **追加テストは実際にオープンリダイレクトを守っている。** `safeRedirectPath` から `SameOriginPolicy.isSameOriginPath(...)` の呼び出しを外した変異版を作業ツリーに当てて `pnpm vitest run apps/web/app/presentation/__tests__/redirect.test.ts` を実行し、**12 passed → 6 failed / 6 passed** になることを実測した（`//evil.example` が `redirect` にそのまま乗る差分で落ちる）。変異は revert 済み（`git diff --stat` 空）。
- **Blocker は無い。** 残る 4 件はいずれも「今は安全だが、次に触る人が同じ判断を再現できない／片方だけ直っている」種類の Warning。

## Blockers

なし。

## Warnings

- **[W-001]** `/settings` のガードだけが `signInRedirectOptions` を通らず、`/signin` への行き先を自前で組み立てている
  - 場所: `apps/web/app/routes/settings/route.tsx:48-51` / `apps/web/app/presentation/redirect.ts:39-44`
  - 理由: 1 ラウンド目の修正で `signInRedirectOptions`（`safeRedirectPath` を必ず通す純関数）が新設され、`presentation/sessionGuard.ts:16` はそれを使うようになった。目的は「`/signin` の行き先を組む場所を 1 つにして、ユニットテストで固定できるようにする」ことで、実際に `redirect.test.ts:57-92` はその 1 本だけを固定している。ところが `/signin` への redirect を投げる箇所は**リポジトリに 2 つ**（`sessionGuard.ts` と `settings/route.tsx`）あり、テストで固定されていないほうが `SIGNED_OUT_PATH` の分岐を抱えた条件付きの側である。
    - 今日の時点では両方とも `safeRedirectPath` を通っているので**バイパスは無い**。問題は、集約の目的が半分しか達成されていないこと — 次に「弾いたときの倒し先」や `search` の形を変える人は `redirect.ts` とそのテストを直して満足でき、`settings/route.tsx` の 1 本が取り残される。ADR-004 が `SameOriginPolicy` への委譲でわざわざ潰した「同じ判断が 2 か所にあって片方だけ更新される」形が、1 段上（行き先の組み立て）でそのまま残っている。
  - 提案: `throw redirect(signInRedirectOptions(location.href));` に置き換える。`SIGNED_OUT_PATH` の分岐はそのまま `handler` 側に残る（`signInRedirectOptions` は「行き先の組み立て」しか持たない）ので、分担は崩れない。

- **[W-002]** 転送境界の 2048 という上限が、定数化されたあとも `signin.tsx` では即値のまま残っている
  - 場所: `apps/web/app/routes/signin.tsx:11`（`z.string().max(2048)`）/ `apps/web/app/presentation/redirect.ts:23`（`REDIRECT_MAX_LENGTH = 2048`）
  - 理由: 本 PR は `REDIRECT_MAX_LENGTH` を新設し、`routes/notes/-action.tsx:17` の `redirectField` と `boundedRedirectSource` の clamp をその 1 つの値に束ねた。`signin.tsx` は**同じモジュール（`@/presentation/redirect`）から `safeRedirectPath` を既に import している**のに、上限だけ即値で持っている。この値は `redirect` の一生（loader の clamp → ブリッジの `.validator` → `/signin` の `validateSearch`）を通して同じでなければ意味を持たない鎖の一部で、`signin.tsx` 側だけが小さいと **`/settings` 経由で来た長い `redirect` が黙って `catch(undefined)` → `/notes` に倒れる**（`/settings` のガードは clamp を通さないので長い値がそのまま来うる）。今は 3 つとも 2048 なので実害は無い。
  - 提案: `import { REDIRECT_MAX_LENGTH, safeRedirectPath } from "@/presentation/redirect";` にして `.max(REDIRECT_MAX_LENGTH)` にする。1 行で鎖が閉じる。

- **[W-003]** `/settings` の `shouldReload` コメントが preload について絶対形で書かれているが、`/settings` の**外**からのホバーでは実際にガードがスキップされる
  - 場所: `apps/web/app/routes/settings/route.tsx:30-31`（「`cause !== "preload"` が preload を弾けるのは cached match だけなので、このレイアウト match に対しては実質いつも真になる」）
  - 理由: この記述が成立するのは**利用者が既に `/settings/*` に居るとき**だけである。`resolvePreload`（`load-matches.js:19`, `inner.preload && !matchStores.has(matchId)`）が false になるのは `/settings` レイアウト match が**アクティブ**なときで、`/notes` から `AccountMenu`（`components/layout/AccountMenu/index.tsx:11` → `SETTINGS_TABS[0].href` = `/settings/profile`）にホバーした場合はレイアウト match がアクティブではないので `preload = true` → `getLoaderContext` が渡す `cause` は `"preload"` → `shouldReload` は **false** を返す。そのレイアウト match が cached（`status: "success"`）なら、その preload ではガードが**走らない**。
    - **挙動としては無害**である（preload は何も描画しないし、クリック時は `cause: "enter"` になって blocking で必ず走り直す。ADR-003 の目的「毎ナビゲーション再判定」は保たれている）。問題は、ADR-003 Consequences が「`shouldReload` は書いた人にしか意味が伝わらないので、3 ルートに添えるコメントは *preload で抑止できるのは cached match だけ* まで書く」と要求した精度が、この 1 文だけ逆向きに落ちていること。`/notes` 系の 2 ファイル（`notes/index.tsx:14-15` / `$noteId.tsx:14-15`）は「cached match だけ」と正しく書いているのに、`/settings` 側だけが「実質いつも真」と読める。
  - 提案: 「**`/settings` に居るあいだは**このレイアウト match がアクティブなので実質いつも真になる（外から入る preload では `cause: "preload"` になり、cached なら走らない — クリック時に blocking で走り直すので判定は落ちない）」まで書く。

- **[W-004]** `spec/adr/030` に足した 1 文が、同 ADR 自身が課題に挙げた「**前の利用者**のデータが画面に出る」形の残り方を覆えていない
  - 場所: `spec/adr/030-auth-state-transition-transport.md:33` / `apps/web/app/routes/notes/index.tsx:19-23,38-40`
  - 理由: 追記された文は残存窓を「失効 → 直前の `loaderData` を 1 往復表示 → `/signin` へ遷移」と書いており、**redirect で終わる経路**だけを説明している。しかし同じ背景枝は redirect で終わらない形でも開く:
    1. 利用者 A が `/notes`（既訪 match）に居て、サーバー側でセッションが失効する
    2. 次のナビゲーションで背景ガードが redirect → `router.navigate('/signin?redirect=/notes')`（**SPA 遷移**なので `/notes` match は `cachedMatches` に残る）
    3. その端末で**利用者 B** がサインインする。`SignInForm`（`components/auth/SignInForm/index.tsx:138-146`）は `await router.invalidate()` のあと `router.history.push(redirectTo)` で `/notes` へ SPA で戻る
    4. `/notes` は cached match（`status: "success"` / `invalid: true`）なので `loaderShouldRunAsync` が真になり、`staleReloadMode` を持たない `/notes` では**背景枝**に落ちる → 利用者 B の画面に**利用者 A のノート一覧が 1 往復ぶん表示される**。ここに redirect は無いので、追記文の説明はこの経路に当たらない
    - ノート一覧が 1 往復残ること自体は本 PR の退行ではない（変更前も `staleTime: Infinity` + `invalid` で同じ背景枝に落ちた）。**本 PR で新しく増えたのは上部バーの本人表示**である — `user` の供給源が `beforeLoad`（ブロッキング。変更前は利用者 B の値が先に入っていた）から同じ background loader の `loaderData` へ移ったため（`notes/index.tsx:38-40`）、表示名とアバターまで 1 往復ぶん利用者 A のものが出る。
    - ADR 030 の課題欄が名指ししているのはまさに「サインアウト後に**前の利用者**のデータが画面に出うる」であり、追記文はその課題に対する現在の答えとしては不完全。共有端末での「別の人がサインインし直す」は、この ADR が最初に想定した状況そのものである。
  - 提案: 追記文に 1 節足す。例:「同一タブで**別の利用者**がサインインし直した場合も同じ背景枝を通る — `router.invalidate()` は cached match を invalid にするだけでブロッキングにはしないので、`/notes` では前の利用者の一覧と上部バーの本人表示が 1 往復ぶん残る」。挙動側で閉じるなら `/notes` 系にも `staleReloadMode: "blocking"` を置く選択肢があるが、それは AC-8（スケルトンに戻らない・遷移が即座に settle する）と正面から衝突するので、canon に書き切るのが本筋だと考える。

## 認証観点で確認して問題が無かった点（検証根拠つき・記録）

`@tanstack/router-core@1.171.15` の `dist/esm/load-matches.js` / `router.js` を読んで確認した。

- **`/settings` の `loader` オブジェクト形は正しく効いている。** `shouldReloadInBackground`（`load-matches.js:458`）は `typeof routeLoader === "function" ? undefined : routeLoader?.staleReloadMode` で読むので、オブジェクト形でのみ `"blocking"` が届くというコメントの主張は事実。`RouteLoaderObject`（`route.d.ts:156-159`）も `{ handler, staleReloadMode }` で型が合っている。
- **blocking にしたことでホバー由来の実ナビゲーションは起きない。** blocking だと `load-matches.js:436-449` の背景枝（`catch` で `router.navigate` する側）に落ちず `await runLoader(...)` になり、redirect は `loadMatches` を抜けて `preloadRoute` の `catch`（`router.js` `preloadRoute`）に届く。そこは `isRedirect(err)` を**再 preload**（`this.preloadRoute({...err.options})`）に変換するだけで `navigate` しない。`settings/route.tsx:34-38` のコメントは実装と一致する。
- **blocking はガードのバイパスを 1 つ塞いでいる。** `load-matches.js:469` の早期 return（`prevMatch.status === "success" && !sync && !prevMatch.preload && shouldReloadInBackground` で `prevMatch` をそのまま返す = preload in-flight 中のクリックでガードが 1 回落ちる経路）は `shouldReloadInBackground` が偽なので `/settings` では成立しない。この穴は `/notes` 系にだけ残り、plan.md:76 が把握済み・redirect 自体は preload 側の背景ロードが拾うのでバイパスにはならない。
- **blocking は並列性（AC-3a/3b の「1 段」）を壊していない。** `loadMatches`（`load-matches.js:528`）は `for (...) matchPromises.push(loadRouteMatch(inner, matchPromises, i))` で全 match の loader を先に起動してから `Promise.all` するので、レイアウトが blocking でも子の断片 loader は同時に走る。blocking が変えるのは「その match の再実行を背景枝へ逃がすか」だけ。
- **未サインインで `/settings/*` を開いたとき、子断片の 401 ではなく親の redirect が勝つ。** `Promise.allSettled` のループ（同 530-539）は `isRedirect(reason)` を見つけた時点で即 `throw` し、それ以外は `firstUnhandledRejection ??=` に溜めてループ後に投げるので、順序に関わらず redirect が優先される。`ServerErrorState` が閃く経路は無い。
- **二重リダイレクトは AC-6a が受容済みの 1 件だけ。** 未サインインの `/settings` 直開きは `/settings/` index の `beforeLoad`（`routes/settings/index.tsx:10-12`）→ `/settings/profile` → レイアウトの `loader` → `/signin?redirect=/settings/profile` の 2 段。レイアウトから `beforeLoad` が消えたので、レイアウト自身が 2 回判定する形にはなっていない。
- **`boundedRedirectSource` は切り詰めではなく置換である。** `redirect.ts:31-33` は `href.length <= MAX ? href : "/notes"`。テスト（`redirect.test.ts:79-92`）が境界ちょうど 2048 を通し、2049 を `/notes` に倒すことを固定しており、`slice` 実装ならこのテストは落ちる。倒し先の `/notes` は `safeRedirectPath` の既定と同じで、認証必須ルートなので未サインインでも `/signin` へ戻るだけ。網は緩んでいない — clamp は**クライアント側の DoS 回避**であって、値の安全はサーバー側の `safeRedirectPath` が無条件に見る。
- **`location.href` はオリジンを含まない。** `router.js:167` が `href: pathname + searchStr + hash`、同 183 が `url.href.replace(url.origin, "")` を作るので、`safeRedirectPath` の「先頭 `/`」判定が絶対 URL で誤爆する経路は無い。`getLoaderContext`（`load-matches.js`）が渡す `location` は**遷移先**の location なので、`/settings` の `SIGNED_OUT_PATH` 分岐も `boundedRedirectSource(location.href)` も正しい値を見る。
- **`safeRedirectPath` を迂回できる呼び出し方は無い。** `redirect` 入力の消費点は `sessionGuard.requireSessionOrRedirect`（`.validator` 済みの値 → `signInRedirectOptions` → `safeRedirectPath`）と `settings/route.tsx`（`safeRedirectPath(location.href)`）の 2 つだけ。最終消費点の `signin.tsx:32` でも `safeRedirectPath(redirect)` を再度通しており、`SignInForm` は生文字列を `router.history.push` するだけなのでパーセントエンコードの復号は起きない（AC-7 の `/%0Aevil` が通るのが正、という前提のまま）。
- **`resolveAppConfig` の `undefined` 返しで認証・セッションに関わる値が欠ける経路は無い。** `AppConfig` の消費点はリポジトリ全体で `head` の 17 箇所だけ（`match.context?.config` を grep して確認）で、すべて `if (!config) return {}`（root は `return { links: baseLinks }`）を持つ。認証に関わる `container.config.appUrl` を読むのは `routes/settings/-action.tsx:51` と `routes/dev/-action.tsx` で、そちらは従来どおり `getContainer()`（要求スコープ外なら throw）経由なので、silent-undefined の影響を受けない。`getInstalledStore()?.getStore()?.config` の型も `ContainerStore.getStore(): RequestContainer | undefined` と一致している。
- **`dehydrate` / `hydrate` はフレームワークの SSR ペイロードと衝突しない。** `router.d.ts:212-226` のとおり利用者向けフック（`TDehydrated` 専用スロット）で、match の dehydration とは別経路。`router.update({ context })` はルーターコンテキスト全体を差し替えるが、そこに載っているのは `config` 1 つだけなので落ちるものは無い。
- **`sessionGuard.ts` はクライアントグラフへ漏れない**（`./session` は動的 import のまま）。`presentation/auth.ts` は `sessionUserFn` だけになり、`AuthenticatedUserView` は戻り値型注釈で使われ続けている（未使用 import ではない）。
- **`requireSessionOrRedirect` が「セッション無し → redirect」以外を返す経路は無い。** `authenticateSession.ts:20-21,51-66` がすべての失敗を `ValidationError("UNAUTHENTICATED")` に潰し、`sessionUserOrNull`（`session.ts:126-138`）がそれだけを `null` にする。1 ラウンド目 W-002 の指摘どおり `routes/notes/-action.tsx:8-15` と `docs/frontend_implementation_example.md` の「2 系統」記述は事実に修正されている。
- **クライアントから直接叩ける経路の網は保たれている。** `createServerFn` は 24 本。`/notes` 系の 2 本は `requireSessionOrRedirect`、`/settings` の断片 3 本とミューテーション群は `requireSession()`、`sessionUserFn` は `null` を返す設計、`getDeletionStatusFn` は ticket が主体（`-action.tsx:397-405` の JSDoc どおり）。本 PR が触っていない `auth/-action.tsx` / `dev/-action.tsx` も未変更。
- **`useRouteContext` / `requireAuthenticated` / `loadAppContext` の参照はソースツリーに 0 件**（ヒットするのは `apps/web/dist/` のビルド成果物と `.thread/` の記録のみ）。AC-14 は満たされている。
- **`DeleteAccountPanel` の `useLoaderData({ from: "/settings" })` は AC-11 を壊さない。** 未サインイン直開きではレイアウトの `loader` が `{ user: null }` を返して同じ値になる。削除受理直後にタブへホバーしても、preload の `updateMatch` は**アクティブ match についてはローカル配列だけを更新する**（`router.js` `preloadRoute` の `updateMatch`）ので、ストア側の `loaderData` は書き換わらず島は remount しない。
- **`spec/` 側で本 PR が偽にした記述は見当たらない。** `spec/` に `beforeLoad` / ルートガードへの言及は 0 件、`spec/presentation/index.md:196,213` の 401 マッピングは「エラーが境界へ出たときの状態」の話なので畳み込み後も真。`spec/adr/051` の影響欄「3 つの回避形が 1 箇所でしか判定されなくなり」は ADR-004 の委譲で**再び真に戻っている**。`AppConfig` 節の矛盾は triage 済み（defer / #38）。

## カバレッジ

- 確認: `apps/web/app/components/settings/DeleteAccountPanel/index.tsx`, `apps/web/app/presentation/__tests__/redirect.test.ts`, `apps/web/app/presentation/appConfig.ts`, `apps/web/app/presentation/auth.ts`, `apps/web/app/presentation/redirect.ts`, `apps/web/app/presentation/sessionGuard.ts`, `apps/web/app/router.tsx`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/notes/$noteId.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/settings/-action.tsx`, `apps/web/app/routes/settings/route.tsx`, `apps/web/app/routes/signin.tsx`, `docs/frontend_implementation_example.md`, `packages/core/src/application/di/types.ts`, `spec/adr/030-auth-state-transition-transport.md`
- スキップ: なし（変更ファイル 17 件すべてを認証・セッション観点で確認した）
- 差分外で判断材料として読んだもの: `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/validator.ts`, `apps/web/app/routes/index.tsx`, `apps/web/app/routes/settings/index.tsx`, `apps/web/app/routes/settings/danger.tsx`, `apps/web/app/components/auth/SignInForm/index.tsx`, `apps/web/app/components/layout/AccountMenu/index.tsx`, `apps/web/app/components/layout/SettingsTabs/index.tsx`, `packages/core/src/domain/identity/services/sameOriginPolicy.ts`, `packages/core/src/application/identity/authenticateSession.ts`, `packages/core/src/application/di/containerStore.ts`, `spec/presentation/index.md`, `spec/adr/051-same-origin-url-predicate.md`, `.thread/13/plan.md`, `.thread/13/adr.md`, `.thread/13/review/triage-keys.md`, `.thread/13/review/review-001-auth.md`, `@tanstack/router-core@1.171.15`（`load-matches.js` / `router.js` / `route.d.ts` / `router.d.ts`）

### 実行した検証

- `pnpm vitest run apps/web/app/presentation/__tests__/redirect.test.ts` → **12 passed**
- 変異テスト: `safeRedirectPath` から `SameOriginPolicy.isSameOriginPath(...)` を外した版で同テスト → **6 failed / 6 passed**（`//evil.example` が `search.redirect` に素通りして落ちる）。**変異は revert 済み**で、`git -C . diff --stat` は空。
