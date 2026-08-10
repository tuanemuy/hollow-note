# Review 002 — Frontend

対象: PR #12（issue/1/account-to-blank-note-skeleton, base: main）
観点: コンポーネント設計・状態管理・UX・ビューとロジックの切り分け
参照: CLAUDE.md Frontend 節 / spec/pages/index.md（P-01/02/03/10/11/46/47・L-01/02/03）/ spec/design/index.md §9・§10 / spec/design/tokens.md §10 / spec/design/pages/P10-notes-empty.html / .thread/1/plan.md（AC-15〜19）/ .thread/1/review/triage.md
前提: 2 ラウンド目のフルレビュー。台帳で判定済みの Key（B-001 / W-014 / W-015〜W-021 ほか）は再審議しない。

## ラウンド 1 指摘の修正確認

いずれも **修正済みを確認**。B-001 は挙動をライブラリ実装まで降りて検証した。

- **B-001（invalidate 皆無 + `staleTime: Infinity`）— 解決**。
  - `CreateNoteButton/index.tsx:34-35` が `await router.invalidate()` → `navigate` の順で走る。`@tanstack/router-core@1.171.15` の `router.js:683-700` で `invalidate` は `matches` / **`cachedMatches`** / `pendingMatches` の全件に `invalid: true` を立て、`load-matches.js:430-450` の `loaderShouldRunAsync = status === "success" && (invalid || …)` により **staleTime を無視して loader が再実行**される。作成 → 詳細 → 一覧の復帰で新規ノートが出る（AC-18 が本番ビルドでも成立）。
  - `AccountMenu/index.tsx:47` は `window.location.assign("/")` のフル遷移。router インスタンスごと破棄されるため、前利用者の RSC ペイロードが次の利用者に配られる経路は塞がっている。
  - `SignInForm/index.tsx:113` はサインイン成功直後に `router.invalidate()` を挟んでから `history.push`。同一 router を跨ぐケースもキャッシュが破棄される。
  - 併せて確認: `load-matches.js:287-303` の `handleBeforeLoad` は `staleTime` の影響を受けず毎ロード実行されるため、`/notes` の `requireAuthenticated` ガードがキャッシュで素通りすることはない（W-009 の代償はある）。
- **W-015（SignInForm の Phase 直和化）— 解決**。`Phase` 単一直和 + `deadline` からの導出（`index.tsx:32-39, 129-143`）。待機明けは `waiting` の反転で入力が自動復帰し、`waitSeconds` の parse 失敗時は 60 秒を捏造せず秒数なし文言へ縮退（`:58-68, 219-224`）。
- **W-016（NoteBody の promoted フラグ）— 解決**。`useState(promoted)` で `<template>` を描画から落とす形になり、`template.remove()` の手動削除は消えた（`NoteBody/index.tsx:71, 77-87, 135`）。既存 shadowRoot の再利用分岐も残っている。
- **W-017（AccountMenu の disclosure 化）— 解決**。`role="menu"/"menuitem"` を撤去し `aria-expanded` のみ（`AccountMenu/index.tsx:56-63`）。outside-pointerdown / Escape の後始末も cleanup 付き。
- **W-018（P-10 空状態のパレット案内）— 解決**。`NoteList/index.tsx:105-117` に teach ブロック（`⌘K` + 準備中）を追加。モック `P10-notes-empty.html:205-219` の縮退として妥当。
- **W-019（aria-live 常設）— 解決**。`VerifyEmailPanel/index.tsx:61-65` が `role="status" aria-live="polite"` の常設コンテナになり、phase の入れ替えが中身の差し替えになった。
- **W-020（P-46 再試行の button 化）— 解決**。`ErrorState/index.tsx:87-99` が `<button type="button" onClick={() => window.location.reload()}>`。
- **W-021（RSC 断片の redaction boundary）— 解決**。`presentation/serverFragment.tsx` が `renderServerComponent` の内側に `RedactionBoundary` を敷き、system/unknown をサーバーログへ、クライアントへは `redactForClient` のみを流す。`notes/-action.tsx` の 2 断片が両方これを経由している。

### Blockers

なし

### Warnings

- **[W-001]** P-02 でドメインの英語原文 message がそのまま画面に出る — 場所: `apps/web/app/components/auth/SignInForm/index.tsx:80, 253-258`（`classify` の `generic` 分岐 → `displayError`）/ 理由: SignInForm はメール形式のクライアント検証を持たず（`:153` の `noValidate` で native 検証も無効）、送信スキーマも `z.string().min(1).max(254)` だけ（`components/auth/schema.ts:18-21`）。したがって `hello` のような値は素通りし、`signInWithPassword.ts:98` の `Email.create` が `BusinessRuleError(INVALID_EMAIL, "Invalid email address")` を投げる。`errorDisplay.renderErrorMessage` の `business` 分岐は `error.message` をそのまま返すため、アラート本文に **"Invalid email address" が英語のまま**表示される。spec/design/index.md §9 の「内部 stack / 原文 message / 内部エラーコードは UI に出さない」と §10（文言は日本語の説明文に統一）に真正面から反する。同型は SignUpForm（`index.tsx:166-170`）・CreateNoteButton（`:71-75`）・AccountMenu（`:86-90`）にもあり、`validation` 分岐は `field: message`（英語の zod 文言 + 内部フィールド名）を出す。/ 提案: 表示は code → 日本語文言の辞書（spec/design/index.md §10 が言う「文言辞書 1 箇所」）で引き、辞書にない code は共通文言へ倒す。最低限、P-02 に P-01 と同じメール形式のクライアント検証を入れて `INVALID_EMAIL` が届かないようにする。
- **[W-002]** ミューテーション成功後の遷移まで `try` に含めており、遷移側の失敗が「操作の失敗」として表示される — 場所: `apps/web/app/components/note/CreateNoteButton/index.tsx:27-39`、`apps/web/app/components/auth/SignInForm/index.tsx:107-121` / 理由: `create()` / `signIn()` が成功した後の `router.invalidate()` / `navigate()` / `history.push()` が同じ `try` の中にある。invalidate は `router.load()` を返すため、root の `loadAppContext` が一時失敗するだけで catch に落ち、ノートは作成済み・セッション Cookie は発行済みなのに「作成できませんでした」「サインインできませんでした」と出る（利用者は再送信して二重作成する）。成功／失敗の直和が遷移の成否と混線している。/ 提案: `try` はサーバー関数呼び出しだけに絞り、成功後の reconcile / 遷移は `try` の外へ出す（遷移失敗はログと現在位置の維持で足りる）。
- **[W-003]** 認証状態を変えるミューテーションのうち verify-email だけ reconcile がない — 場所: `apps/web/app/components/auth/VerifyEmailPanel/index.tsx:38-44` / 理由: `verifyEmailFn` は成功時にセッション Cookie を焼く（`action.ts:26-31`）という点でサインインと同格の認証状態変更なのに、`router.navigate({ to: "/notes" })` の前に `router.invalidate()` がない。B-001 の修正が 3 箇所に入って 4 箇所目だけ抜けた形で、CLAUDE.md の「Every mutation reconciles with `router.invalidate()`」から外れる。メールリンクからの到達はフル遷移なので現状の被害は限定的だが、規律の穴が残ると次のスライスで同じ経路が増える。/ 提案: `setPhase({kind:"succeeded"})` の後、`navigate` の前に `await router.invalidate()` を入れる（サインインと同じ形）。
- **[W-004]** 4 つのルートが P-46 共通表示を使わず独自の errorComponent を持つ — 場所: `apps/web/app/routes/index.tsx:26-33`、`routes/signin.tsx:27-36`、`routes/signup.tsx:18-27`、`routes/verify-email.tsx:26-35` / 理由: `__root.tsx:57-64` と `routes/notes/*` は `ServerErrorState` / `NotFoundState`（P-46）に収斂させているのに、この 4 本だけ `<div role="alert">エラーが発生しました` + `sanitizeRouteError(error)` の素の div。P-46 の目的は「到達できない URL と想定外の失敗を一貫して扱う」であり、再試行導線もトップ/一覧への導線もないこの分岐は AC-19 の「共通表示」から外れる。しかも `sanitizeRouteError` は `renderErrorMessage` をそのまま返すので W-001 の原文 message がここにも出る。`terms.tsx` / `privacy.tsx` は errorComponent を持たず root に委譲していて、そちらが正しい形になっている。/ 提案: 4 本の errorComponent を削除して root に委譲するか、`AuthLayout` で包んだ `ServerErrorState` に統一する。
- **[W-005]** 秒読みを assertive live region（`role="alert"`）の中で毎秒書き換えている — 場所: `apps/web/app/components/auth/SignInForm/index.tsx:151, 219-225` + `components/ui/Alert/index.tsx:58-62`（`role` 既定値が `"alert"`）/ 理由: THROTTLED のアラート本文が「あと N 秒」を含み、`now` が 1 秒ごとに更新されるため、支援技術は 1 秒おきに割り込み読み上げを繰り返す。spec/design/index.md §9 は「状態遷移・完了・失敗は `polite`、即時に伝えるべきエラーのみ `assertive`」と定めており、待機案内は assertive に当たらない。加えて `useEffect(…, [deadline, now])`（`:137-141`）は `now` を依存に含むため毎秒 interval を張り直しており、状態遷移の副作用としては過剰。/ 提案: `Alert` に `role="status"` を渡す（既に prop はある）か、秒数だけを live region の外の `<span>` に切り出す。interval の依存は `deadline` だけにして関数更新（`setNow(Date.now())`）で回す。
- **[W-006]** W-019 で確立した「aria-live は常設」の原則が他の 3 箇所に適用されていない / 項目エラーが入力に結び付いていない — 場所: `apps/web/app/components/auth/SignUpForm/index.tsx:189-193, 233-241, 262-266`（項目エラー）、`components/note/CreateNoteButton/index.tsx:71-75`、`components/layout/AccountMenu/index.tsx:86-90` / 理由: いずれも `aria-live="polite"` を持つ要素自体を条件付きで**マウント**しており、領域が存在しない状態から現れるため多くのスクリーンリーダーで読み上げられない（VerifyEmailPanel で直したのと同じ構造）。さらに SignUpForm の項目エラーは `id` を持たず、入力側にも `aria-describedby` がないため、`aria-invalid` だけが伝わって理由が伝わらない（AC-16「項目エラー」の支援技術での成立が半分）。ついでに `NoteListSkeleton/index.tsx:18-24` と `NoteDetailSkeleton/index.tsx:9-15` は `<main role="status">` で main ランドマークを潰している。/ 提案: 各エラーの器を常設し中身だけ差し替える。項目エラーには `id={`${emailId}-error`}` を振って入力へ `aria-describedby` を張る。スケルトンは `role="status"` を内側の `<div>`（または sr-only の span）へ移す。
- **[W-007]** LOCKED のアラートが解除時刻を過ぎても「停止しています」のまま残る — 場所: `apps/web/app/components/auth/SignInForm/index.tsx:226-234` / 理由: throttled は `phase.until !== null && !waiting` で自分を消す（`:218`）のに、locked には同じ扱いがなく、`waiting` が false になって入力とボタンが復帰した後も「◯月◯日 ◯◯:◯◯ まで停止しています」が出続ける。画面の主張と操作可能状態が矛盾する（直和に畳んだ利点が表示側で活かされていない）。/ 提案: throttled と同じく `!waiting` で消すか、「再度お試しいただけます」に文言を差し替える。
- **[W-008]** ナビゲーションごとに RPC が 3 往復し、streaming の「即座に settle」を相殺している — 場所: `apps/web/app/routes/__root.tsx:43-44`（`staleTime: Infinity` + `beforeLoad: () => loadAppContext()`）、`routes/notes/index.tsx:16-19` / 理由: `beforeLoad` は staleTime の対象外で毎ロード実行される（router-core `load-matches.js:287-303`。B-001 の検証で確認）。したがって `/notes` へのクライアント遷移ごとに root の `loadAppContext`（不変のサイト設定）→ `/notes` の `sessionUserFn` → loader の `renderNoteList` が**直列**で走る。`beforeLoad` は親から順に await されるため、断片のリクエストが飛び始めるのは 2 往復後。root の `staleTime: Infinity` は loader を持たない root には効かない。/ 提案: `config` は root の `loader`（staleTime が効く）か SSR 時 1 回のハイドレーションに移す。セッション検証は残すが、`renderNoteList` 側が `requireSession` を持つ以上、ガードの往復と断片の往復を 1 つにまとめられる余地がある（断片が 401 を返す設計は既にある）。
- **[W-009]** 到達しない表面が残っている — 場所: `apps/web/app/components/layout/PublicShell/index.tsx:12-16, 29-51`（`signedIn`）、`components/auth/formStyles.ts:15`（`fieldHintClass`）、`apps/web/app/presentation/pagination.ts`（消費者ゼロ）/ 理由: `signedIn` に `true` を渡す呼び出しは全コードベースに存在せず、`LegalPage` 経由の `/terms` `/privacy` はサインイン済みでも「サインイン / はじめる」CTA を出す（このフラグはまさにそれを直すためのもの）。`pagination.ts` は todo 参照実装の削除で最後の利用者を失った。使われない分岐は仕様と実装のどちらが正か判定できない状態で残る。/ 提案: `signedIn` を実際に配線する（`LegalPage` に `sessionUserFn` の結果を渡す）か prop ごと落とす。`fieldHintClass` / `pagination.ts` はテンプレート基盤として残すなら「未使用だが基盤」と一行残す、そうでなければ削除。
- **[W-010]** `docs/frontend_implementation_example.md` の機械置換で自己矛盾した記述が 2 箇所 — 場所: `docs/frontend_implementation_example.md:424`（"Input validation uses `.validator(...)`. **Do not use the old API `.validator(...)`.**"）、`:874`（"Server function validation: **`.validator(...)`** (`.validator(...)` is the old API)"）/ 理由: `inputValidator` → `validator` の一括置換が「旧 API 名」側も書き換えたため、同じ API を「使え」「使うな」と両方書いている。実装は `.validator(...)` が正しい（`@tanstack/start-client-core@1.170.14` の `createServerFn.d.ts:80-82` で `inputValidator` が `@deprecated`）ので、誤っているのはドキュメントのみ。この文書は次スライスの実装者が最初に読む規約なので、放置すると逆の実装を生む。/ 提案: 424 行は「`.inputValidator(...)` は旧 API」、874 行も同様に旧 API 名へ戻す。
- **[W-011]** グローバルなフォーカスリングが forced-colors と accent 背景で機能しない — 場所: `apps/web/app/styles/index.css:17-22`（`:focus-visible { outline: none; box-shadow: var(--shadow-focus); }`）、`styles/tokens.css:129`（`--shadow-focus: 0 0 0 2px var(--color-accent)`）/ 理由: (1) `box-shadow` は forced-colors（Windows ハイコントラスト）で描画されないため、`outline: none` と組み合わせるとフォーカス表示が完全に消える。(2) リング色 = `--color-accent` で、`bg-accent` の要素（`submitButtonClass` / `CreateNoteButton` primary / `PrimaryLink` / `ErrorStateLink` primary / `RetryButton`）ではリングがボタンと同色になり、2px 大きく見えるだけでフォーカス位置が判別できない。この画面群はキーボード操作の比重が高いと spec/design/tokens.md §10 自身が書いている。/ 提案: 実装は tokens.md §10 の逐語コピーなので**直しの本体は design 側**。`outline: 2px solid transparent`（forced-colors で復活する）を併記し、accent 背景用に `--shadow-focus` へ 2px のオフセット（bg 色の内側リング）を持たせる方向で spec を改訂したうえで実装を追随させる。

### カバレッジ

変更ファイル一覧（`changed-files-r2.txt` 全 387 行）との対応。

- 確認（本ラウンドで精読）:
  - `apps/web/app/components/auth/**` — `SignInForm/{index.tsx,action.ts}`、`SignUpForm/{index.tsx,action.ts}`、`VerifyEmailPanel/{index.tsx,action.ts}`、`formStyles.ts`、`schema.ts`（8 ファイル）
  - `apps/web/app/components/layout/**` — `AccountMenu/{index.tsx,action.ts}`、`AppShell`、`AuthLayout`、`LegalPage`、`PublicShell`（6 ファイル）
  - `apps/web/app/components/note/**` — `CreateNoteButton/{index.tsx,action.ts}`、`NoteBody`、`NoteDetail/{index.tsx,action.ts}`、`NoteDetailSkeleton`、`NoteList/{index.tsx,action.ts}`、`NoteListSkeleton`（9 ファイル）
  - `apps/web/app/components/ui/**` — `Alert`、`BrandMark`、`ErrorState`、`Skeleton`（変更 4 ファイル）+ 文脈確認で未変更の `Deferred`、`RoutePendingFallback`
  - `apps/web/app/presentation/**` — `appServerErrorAdapter`、`auth`、`clientKey`、`errorResponse`、`errorResponseMiddleware`、`pagination`、`serverErrorLog`、`serverFragment`、`session`、`validator`（変更 10 ファイル）+ 文脈確認で未変更の `errorDisplay`、`serverAction`、`head`
  - `apps/web/app/routes/**` — `__root.tsx`、`index.tsx`、`signin.tsx`、`signup.tsx`、`verify-email.tsx`、`terms.tsx`、`privacy.tsx`、`notes/{index.tsx,$noteId.tsx,-action.tsx}`（10 ファイル）
  - `apps/web/app/styles/{index.css,theme.css,tokens.css}`（3 ファイル、diff + トークン解決順を確認）
  - `CLAUDE.md`（diff）、`docs/frontend_implementation_example.md`（diff 全量）
  - 未変更だが配線検証のため参照: `apps/web/app/router.tsx`、`apps/web/app/start.ts`
  - 検証コンテキスト（被レビュー物ではない）: `spec/pages/index.md`（P-10/P-11/P-46/P-47）、`spec/design/index.md` §9・§10、`spec/design/tokens.md` §10、`spec/design/pages/P10-notes-empty.html`、`.thread/1/{plan.md,review/triage.md,review/review-001-frontend.md}`、`@tanstack/router-core@1.171.15`（`router.js` / `load-matches.js`）、`@tanstack/start-client-core@1.170.14`（`createServerFn.d.ts`）、`@tanstack/react-router` の `link.js`（`"use client"` 確認）、`packages/core/src/{config.ts,domain/identity/valueObject.ts,application/identity/signInWithPassword.ts}`（UI に届くエラーの実体確認）
- スキップ:
  - `.thread/1/**`（10 ファイル）— 本レビューの参照物であり被レビュー物ではない
  - `apps/web/app/components/todo/**`・`apps/web/app/routes/todo/**`（14 ファイル、全て D）— AC-14 の参照実装削除。削除内容の精読は不要
  - `apps/web/app/routeTree.gen.ts` — 自動生成物（新ルート 7 本の登録のみ）
  - `apps/web/app/server.{aws,cloudflare,gcp}.ts`・`server.node.ts`・`worker/**`・`scripts/**`・`vite.config.*`・`wrangler*`・`drizzle*.config.ts`・`Dockerfile.gcp`・`.env.example`（約 30 ファイル）— ランタイム配線（AC-14）でバックエンド観点の担当
  - `packages/core/src/**`（domain / application / adapters / conformance、約 190 ファイル）— ドメイン・ユースケース・アダプター観点の担当。上記「検証コンテキスト」に挙げた 3 ファイルのみ、UI に届く DTO とエラーの形を突き合わせる目的で参照
  - `infra/**`（約 30 ファイル、全て D）— インフラ削除、AC-14 の範囲
  - `.github/workflows/ci.yml`・`biome.json`・`package.json`（root / web / core）・`pnpm-lock.yaml`・`pnpm-workspace.yaml`・`vitest.config*.ts` — ビルド / CI 設定、統合ゲートの担当
  - `docs/{backend_implementation_example,runtime_node,test}.md`・`docs/runtime_{aws,cloudflare,gcp}.md`（D）— バックエンド / テスト観点の担当（`frontend_implementation_example.md` のみ本観点で精読）

### 受け入れ基準の突合（AC-16〜19、再確認分）

- **AC-16**: P-01 の項目エラー（blur 検出・送信抑止）／送信完了／全体エラー、P-02 の共通文言・未確認・待機・ロックの状態分離と相互導線、L-03 レイアウトを再確認。**充足**（状態モデルは W-015 の修正で直和に畳まれた。残る指摘は表示側の W-001 / W-005 / W-006 / W-007）。
- **AC-17**: `/verify-email` の GET 描画 → 自動 POST 消費 → Cookie → `/notes` 着地を再確認。**充足**（告知は W-019 で解決。reconcile の欠落が W-003）。
- **AC-18**: 「新規作成」→ 白紙ノート → 詳細（Shadow DOM・スケルトン・見つかりません）と、**作成後に一覧へ戻る経路**を再確認。`router.invalidate()` の敷設で本番の `staleTime: Infinity` 下でも新規ノートが一覧に出る（B-001 解決）。not-found は断片内解決（`NoteDetail/index.tsx:23-31`）とルート errorComponent（`$noteId.tsx:35-46`）の二段で NOTE_NOT_FOUND に収斂。**充足**。
- **AC-19**: P-46 の共通表示・再試行（button 化済み）・導線と P-47（`/terms` `/privacy`）を確認。**概ね充足**だが、4 ルートが P-46 に収斂していない（W-004）。
- **streaming / Skeleton の使い分け**: `/notes`・`/notes/$noteId` とも loader は `renderServerFragment(...)` の promise を await せず転送し、`Suspense + Deferred` が受ける。スケルトンは実 DOM の写しでレイアウトシフトなし。route-level pending は `router.tsx` の `defaultPendingComponent` のまま（streaming する 2 本では発火しない）。**規律どおり**。ただし beforeLoad の直列往復が「即座に settle」を実質的に打ち消している（W-008）。
- **server fn の side-effect import**: `__root.tsx:19-23` に client island からのみ到達する 5 つの action（SignUp / SignIn / VerifyEmail / AccountMenu / CreateNoteButton）が全て列挙されている。`notes/-action.tsx` は route loader 経由なので不要。**漏れなし**。
- **三層ミューテーション規律**: 本スライスのミューテーションは全て「一覧membership を変えない or 遷移で画面ごと入れ替わる」ため item-local `useOptimistic` の対象がなく、`useActionState` / `useTransition` の pending 表示が三層目を担う形で妥当。`CreateNoteButton` は作成後に詳細へ遷移するため楽観挿入不要という判断もコメントに残っている。
- **NoteBody の SSR/DSD 経路**: `promoted` フラグ化でラウンド 1 の (1)(2)（React 管理 DOM の手動削除・二重管理）は解消。HTML パーサー経路でのハイドレーション整合は台帳 W-016 の判定範囲外として据え置き（`host.shadowRoot` 再利用の分岐は入っている）。
- **CLAUDE.md Frontend 節の todo 参照**: 参照先（`components/todo/`、`routes/todo/index.tsx`、`TodoBoard`、`TodoListSkeleton`）が本 PR で削除され、記述が宙に浮いている。ただし台帳 W-014 で「全面改訂は spec-sync」と判定済みのため本ラウンドでは再指摘しない。
