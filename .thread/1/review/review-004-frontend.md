# ラウンド4 レビュー — Frontend

対象 PR: #12（`issue/1/account-to-blank-note-skeleton` → `main`）
契約: `.thread/1/plan.md`（AC-16〜19）／`spec/pages/index.md`／`spec/design/index.md` §9・§10・§11
既出（`.thread/1/review/triage.md` の Key 一致分）と Issue #13 defer 分は再審議していない。

## 最重要の検証対象（ラウンド3 修正の退行チェック）

| # | 対象 | 判定 |
| --- | --- | --- |
| 1 | `router.tsx` の `defaultErrorComponent` / `defaultNotFoundComponent` | **問題なし**。root は自前の `errorComponent` / `notFoundComponent` を持つため既定は適用されず二重ラップは起きない。子ルートの既定は `RootComponent` の `<Outlet/>` 配下、つまり `RootDocument` の内側で描画されるので `<html>` の入れ子も起きない。未マッチ URL は root マッチに落ちるので `RootDocument` 付きの `NotFoundState` になる |
| 2 | `empty:hidden` → `not-empty:*` | **問題なし**。tailwindcss 4.3.3 で実コンパイルして確認（`not-empty:mt-2` → `.not-empty\:mt-2:not(:empty){margin-top:...}`）。空時は `display:none` にならず a11y ツリーに残り、空ブロックの高さは 0 なのでレイアウトも従前と同じ |
| 3 | 常設 `role="status"` + `role="note"` | **問題なし**。`Alert` は `role === "note"` のとき `role` 属性そのものを落とすため、常設 live region の内側に live region が入れ子にならない。告知の重複はない（**欠落**は W-001 参照） |
| 4 | メール正規表現・`trim()` | **問題なし**。`schema.ts` の `EMAIL_PATTERN` / `EMAIL_MAX_LENGTH` はドメイン `Email`（`packages/core/src/domain/identity/valueObject.ts:45-48`）と完全一致。`trim()` も `Email.create` の正規化と一致し、送信値は `signInSchema` / `signUpSchema` の `.trim()` が同じ正規化をかける |
| 5 | `VerifyEmailPanel` の新 phase と `attempt` カウンター | **問題なし**。`started = useRef(-1)` と `attempt` の一致判定により StrictMode の二重 effect でも POST は 1 回。ref は StrictMode の疑似アンマウントを跨いで保持されるため成立する。`retry` のみが `attempt` を進めるので再 POST は明示操作のときだけ。消費済みトークンの再 POST は `verifyEmail` が `alreadyVerified: true`（エラーではない）を返すので「確認済み・サインインへ」に正しく倒れる |
| 6 | `SignUpForm` 完了パネルのフォーカス移動 | **問題なし**。`useEffect` は早期 return より前に宣言されておりフック順序は安定。`state.done` の描画で `doneHeadingRef` が付いた後に effect が走るのでフォーカスは確実に h1 へ移る |

## Blockers

なし

## Warnings

- **[W-001]** THROTTLED の待機秒数が支援技術にまったく伝わらず、待機解除も告知されない — `apps/web/app/components/auth/SignInForm/index.tsx:269-276`（`<span aria-hidden="true">（あと N 秒）</span>`）と `:151-168` / `:180-182`。
  - 理由: `spec/pages/index.md` P-02 の待機中は「**待機秒数を示し**、待てば再試行できることを案内する」。ラウンド3 の R3-FE-W-002 対応で秒読みを `aria-hidden` に移した結果、秒数が a11y ツリーから完全に消え、視覚利用者にしか届かなくなった。さらに `waiting` が false になると `PhaseAlert` が `null` を返して領域が空になるだけで、「もう一度試せる」ことは何も告知されない。このときフォーカスは空になった `role="status"` の div に残ったままで、入力欄は `disabled` が外れているのに利用者はそれを知る手段がない。結果としてスクリーンリーダー利用者は「どれだけ待つのか」も「いつ再開できるのか」も得られない。tick ごとの再告知を避ける意図は正しいが、手段が過剰。
  - 提案: 秒読みの `<span>` を `aria-hidden` ではなく `aria-live="off"`（live 継承の打ち切り）にして a11y ツリーに残す。加えて `waiting` が false に落ちた遷移で領域を空にせず、「もう一度お試しいただけます」相当の一文へ差し替える（`role="status"` に載るので 1 回だけ polite 告知される）。

- **[W-002]** LOCKED で最大 15 分フォーム全体が `disabled` になり、別アカウントへの切り替え手段が再読み込みしかない — `apps/web/app/components/auth/SignInForm/index.tsx:140-161`（`deadline` に `phase.unlockAt` を含めて `disabled` を導出）。
  - 理由: `LoginThrottlePolicy.lockDurationMs` は 15 分（`packages/core/src/domain/identity/services/loginThrottlePolicy.ts:36`）で、THROTTLED の上限 60 秒（`maxDelayMs`）とは桁が違う。ロックのキーは `signIn:${email}:${clientKey}` なので**別のメールアドレスならサーバーは受け付ける**のに、UI はメール欄ごと 15 分間塞ぐ。しかもこの `disabled` はコンポーネント state なのでページ再読み込みで即座に解除され、防御としては何も担保していない（サーバー側が正）。「利用者だけが損をして防御はしていない」状態。
  - 提案: `deadline` を THROTTLED（`phase.until`）だけに使い、LOCKED では入力を塞がずアラート表示に留める。押下は 429 が返るだけで安全（`errorResponse.ts` の `LOCKED → 429` マッピングどおり）。

- **[W-003]** `--color-ink-tertiary`（3.6:1）を本文・リンクラベルに使用している — `spec/design/index.md` §11 が「**本文とボタンラベルには使わない**。メタ・プレースホルダー専用」と明示している。
  - 該当箇所:
    - `apps/web/app/components/note/NoteDetail/index.tsx:92`「このノートは白紙です。」— **本スライスの終着画面（AC-18）で唯一表示される本文**がこの色。
    - `apps/web/app/components/note/NoteDetail/index.tsx:97-99`「本文を準備しています。…」— 状態を伝える本文。
    - `apps/web/app/components/auth/SignUpForm/index.tsx:252-254` パスワード条件の補足文 — 入力を助ける本文。
    - `apps/web/app/routes/notes/$noteId.tsx:61`「ノート一覧」— 有効なリンクのラベル（disabled ではない）。
    - `apps/web/app/components/layout/PublicShell/index.tsx:42-50` フッターの利用規約 / プライバシーポリシーリンク — P-01 の同意対象への導線でありラベル。
  - 除外（妥当な使用）: 一覧の更新時刻・件数、詳細の kicker、`LegalPage` の改定日、`AccountMenu` の表示名、`AppShell` の disabled パレットトリガー（無効コントロールは WCAG 対象外）。
  - 提案: 上記 5 箇所を `text-ink-secondary`（5.0:1）へ。

- **[W-004]** `prefers-reduced-motion: reduce` の全体規則がない — `apps/web/app/styles/index.css`（`@layer base` に `body` と `:focus-visible` のみ）。
  - 理由: `spec/design/index.md` §11 は「`prefers-reduced-motion: reduce` で**全** transition / animation を 0.01ms にする」と規定している。実装は `Skeleton`（`motion-reduce:animate-none`）と `VerifyEmailPanel` の Spinner の 2 箇所を個別対応しているだけで、`transition-colors`（フォーム・ボタン・リンクほぼ全て）、`NoteBody` の `group-open:rotate-90`、`transition-transform` は対象外のまま。個別対応方式は新しいコンポーネントが増えるたびに漏れる。
  - 提案: `index.css` の `@layer base` に `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }` を追加（`NoteBody` の `scrollIntoView({behavior:"smooth"})` も同時に無効化できる）。

## AC 検証（画面系）

| AC | 判定 | 根拠 |
| --- | --- | --- |
| AC-16 | 充足 | P-01: 項目エラー（`SignUpForm` の email/password/displayName + 規約同意で送信抑止）／送信完了パネル／全体エラー Alert／`/signin` 導線。P-02: `invalidCredentials`（共通文言）・`emailNotVerified`・`throttled`・`locked` を `Phase` 直和で分離、`/signup` 導線。両者とも `AuthLayout`（L-03: マークのみのバー + 中央 1 カラム + フッターなし）。Google / 再送 / 再設定の導線は plan.md の見送りどおり出していない |
| AC-17 | 充足 | `/verify-email` は GET 描画のみ、`VerifyEmailPanel` がマウント後に POST（ADR-007）。同一ブラウザーなら `hollow_pending_verification` の `userId` 一致でセッション発行 → `router.invalidate()` → `/notes` へ遷移。別ブラウザーは `verifiedSignInRequired`（「メールアドレスを確認しました / サインインすると使い始められます」）へ倒れ、ADR-038 の縮退どおり |
| AC-18 | 充足 | `CreateNoteButton` → `createBlankNoteFn` → `router.invalidate()` → `/notes/$noteId`。詳細は Shadow DOM 描画（`NoteBody`）・per-fragment streaming のスケルトン（`NoteListSkeleton` / `NoteDetailSkeleton`）・`NOTE_NOT_FOUND` の `NotFoundState`。`staleTime: Infinity` 下で invalidate が入っている |
| AC-19 | 充足 | P-46: `ErrorState` が存在と権限を区別しない共通文言、再試行は `window.location.reload()`（安全な GET）、トップ / 一覧の導線。`router.tsx` の既定 + root + `/notes` + `/notes/$noteId` の 4 経路がすべて P-46 に落ちる。P-47: `/terms` `/privacy` が `LegalPage`（L-02）で静的表示 |

補足（指摘ではない）:
- `PAGE-p46-003`「session の有無に応じて P-40 または P-10 へ遷移する」は、実装が両導線を常に出す形で代替している。未認証で「ノート一覧へ」を押しても `requireAuthenticated` が `/signin` へ倒すため到達不能にはならない。AC-19 の記述（「トップ/一覧への導線」）は満たしている。
- `PAGE-p46-001` の「rate limit を区別」は `RATE_LIMITED` 自体が本スライス外（plan.md スコープ外）のため対象外。

## カバレッジ

変更ファイル一覧 408 行に 1 対 1 で対応。

### 確認（Frontend 観点で差分・実装を読んだもの）

- `apps/web/app/router.tsx`
- `apps/web/app/routes/__root.tsx` / `index.tsx` / `signin.tsx` / `signup.tsx` / `verify-email.tsx` / `terms.tsx` / `privacy.tsx`
- `apps/web/app/routes/notes/index.tsx` / `$noteId.tsx` / `-action.tsx`
- `apps/web/app/components/auth/schema.ts` / `fieldValidation.ts` / `formStyles.ts`
- `apps/web/app/components/auth/SignInForm/{index.tsx,action.ts}`
- `apps/web/app/components/auth/SignUpForm/{index.tsx,action.ts}`
- `apps/web/app/components/auth/VerifyEmailPanel/{index.tsx,action.ts}`
- `apps/web/app/components/layout/AppShell/index.tsx` / `PublicShell/index.tsx` / `AuthLayout/index.tsx` / `LegalPage/index.tsx`
- `apps/web/app/components/layout/AccountMenu/{index.tsx,action.ts}`
- `apps/web/app/components/note/NoteList/{index.tsx,action.ts}` / `NoteListSkeleton/index.tsx`
- `apps/web/app/components/note/NoteDetail/{index.tsx,action.ts}` / `NoteDetailSkeleton/index.tsx`
- `apps/web/app/components/note/NoteBody/index.tsx`
- `apps/web/app/components/note/CreateNoteButton/{index.tsx,action.ts}`
- `apps/web/app/components/ui/Alert/index.tsx` / `ErrorState/index.tsx` / `BrandMark/index.tsx` / `Skeleton/index.tsx`
- `apps/web/app/presentation/errorDisplay.ts` / `errorResponse.ts` / `errorResponseMiddleware.ts` / `appServerErrorAdapter.ts` / `validator.ts` / `pagination.ts` / `redirect.ts` / `auth.ts` / `session.ts` / `clientKey.ts` / `serverFragment.tsx` / `serverErrorLog.ts`
- `apps/web/app/styles/index.css` / `tokens.css` / `theme.css`
- 削除された `apps/web/app/components/todo/**`（9 ファイル）と `apps/web/app/routes/todo/**`（4 ファイル）— 参照残りがないことを確認（`apps/web/app/` 内に `todo` への実参照なし）

補助的に参照（判定の根拠として読んだ、Frontend 以外の既存ファイル）: `packages/core/src/domain/identity/valueObject.ts`、`packages/core/src/domain/identity/services/loginThrottlePolicy.ts`、`packages/core/src/application/identity/{verifyEmail,signInWithPassword}.ts`。

### スキップ

- `apps/web/app/presentation/__tests__/**`（3 ファイル）— テスト観点（review-004-test）の担当。実装の回帰固定として存在することのみ確認。
- `apps/web/app/routeTree.gen.ts` — 自動生成。ルート追加/削除の反映のみで手書き差分なし。
- `apps/web/app/server.node.ts` / `apps/web/app/worker/node/runner.ts` / 削除された `server.{aws,cloudflare,gcp}.ts` / `worker/{aws,cloudflare,gcp}/**` — ランタイム entry・ワーカー。Frontend 観点の対象外。
- `apps/web/{package.json,vite.config.node.ts,.env.example,Dockerfile.gcp,drizzle*.config.ts,scripts/**,wrangler*}` および削除された `vite.config.{aws,cloudflare,gcp}.ts` — ビルド／ランタイム設定。Frontend 観点の対象外。
- `packages/core/**`（domain / application / adapters / conformance / di / config、追加・削除・変更すべて）— domain / usecase-adapter / test 観点の担当。
- `infra/aws/**` / `infra/cloudflare/**` / `infra/gcp/**` — インフラ定義。Frontend 観点の対象外。
- `docs/**` / `README.md` / `CLAUDE.md` — ドキュメント。CLAUDE.md の todo 参照残りは triage の W-014 で spec-sync 送りが確定済みのため再指摘しない。
- `.thread/1/**`（adr / plan / progress / steps / testing / review 各ファイル）— レビュー成果物そのもの。
- `.github/workflows/ci.yml` / `biome.json` / `package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml` / `vitest.config*.ts` — リポジトリ横断ツーリング。Frontend 観点の対象外。
