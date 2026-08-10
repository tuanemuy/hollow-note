# レビュー 005 — Frontend / Presentation / Security（収束判定ラウンド）

対象: PR #12 / `issue/1/account-to-blank-note-skeleton` → `main`
契約: `.thread/1/plan.md` AC-15〜19、`spec/pages/index.md`、`spec/design/index.md` §9/§11、`.thread/1/adr.md`（ADR-007 / 008 / 038）
既出指摘（`.thread/1/review/triage.md` ラウンド1〜4）および Issue #13 defer 済み項目は再審議していない。

## Frontend / Presentation / Security

### Blockers

なし

### Warnings

なし（**問題点ゼロ**）

出荷を止める基準（セキュリティ上の実害・受け入れ基準の未達・操作不能・ラウンド4修正の退行）に該当する事象は検出できなかった。

## ラウンド4修正の重点検証

実測は `pnpm dev:node`（vite dev, Node ランタイム）に対して行った。server function は seroval で本物のペイロードを組み立てて叩き、Cookie は手動 jar で運搬している。

### 1. `start.ts` の CSRF ミドルウェア登録 — 退行なし

- 登録内容 `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })` は、フレームワークが `createStartHandler.js` で `defaultCsrfMiddleware` として持っている定義と**完全に同一**（`node_modules/.pnpm/@tanstack+start-server-core@1.169.17/.../createStartHandler.js:21`）。`createStart` を作ると `requestMiddleware` が既定を置き換えるため、これは「既定の復元」であってフィルタ範囲の独自判断ではない。
- 判定ロジック（`start-client-core/createCsrfMiddleware.js`）は `Sec-Fetch-Site` → `Origin` → `Referer` の順で同一オリジンを要求し、いずれも無ければ拒否。GET の server function（`sessionUserFn` / `renderNoteList` / `renderNoteDetail`）もフィルタ対象だが、SSR 中は HTTP を経由しない直接呼び出し、クライアント遷移時は同一オリジン fetch なので `Sec-Fetch-Site: same-origin` が付く。
- **実測**:
  - 同一オリジン `signUpFn` POST → 200（正常系は壊れていない）
  - `Origin: https://evil.example` の JSON POST → 403
  - `Content-Type: application/x-www-form-urlencoded` のクロスサイト POST（プリフライトが起きない攻撃形） → 403
  - ヘッダー無し POST → 403
  - `/` `/signin` `/signup` `/terms` `/privacy` `/verify-email` すべて SSR 200、`/notes` は未認証で 307 → `/signin?redirect=%2Fnotes`
- クライアントグラフでも `createCsrfMiddleware` は `@tanstack/react-start` の client index から export されており、`start.ts` のモジュール評価が壊れない（実際に dev サーバーの変換結果で確認）。

### 2. `presentation/verificationSession.ts` — 退行なし

- 型述語 `view is TView & { sessionToken: string }` は `view.sessionToken !== null && pendingUserId === view.userId` と一致しており、`verifyEmailFn` 側の `if (signedIn) { setSessionCookie(view.sessionToken, …) }` が narrowing で通る（typecheck 緑）。
- テスト4件は判定の真理値表を全網羅している（一致+発行 / 別ユーザー（login CSRF）/ Cookie 不在 / `sessionToken === null`）。本質を外していない。
- **実測（ADR-038 の効能そのものを確認）**:
  - 同一ブラウザー: signUp → `hollow_pending_verification` 付与 → 同 jar で verify → `signedIn: true`、`hollow_session` 発行、pending Cookie 破棄。続けて `createBlankNoteFn` 200。AC-17 / AC-18 が e2e で成立。
  - 別ブラウザー（pending Cookie を持たない jar）で同じトークンを verify → 200 かつ `alreadyVerified: false, signedIn: false`、**Set-Cookie ゼロ**。メール確認自体は成立し、セッションは焼かれない = login CSRF は不成立。
- 確認リンクの本文（`actionUrl`）は既定でログに出ない（`MEMORY_MAIL_LOG_ACTION_URL` 未設定時は `mail.sent { to, template }` のみ）。R3-SC-W-301 の処置も現状維持。

### 3. `SignInForm` の THROTTLED / LOCKED — 退行なし

- `Phase.throttled` は `waitSeconds`（スナップショット）と `until`（deadline）を分離して持ち、告知文には `waitSeconds` の固定値、毎秒更新の残り秒は `aria-hidden` の別 span。囲いの live region は1つ（`role="status"`）で、内側の `Alert` はすべて `role="note"` → `role` 属性なしなので**入れ子の live region による二重告知は無い**。
- 待機終了時は領域を空にせず「もう一度お試しいただけます」に差し替える形で、再活性化を告知している（欠落なし）。
- 入力を塞ぐのは `waiting`（= throttled の deadline のみ）で、LOCKED は `disabled` に一切効かない。`LoginThrottlePolicy.maxDelayMs = 60s` なのでモジュール JSDoc の「最大 60 秒」も実装と一致。
- **実測**: 失敗1回目 → 422 `INVALID_CREDENTIALS`、2回目以降 → 429 `THROTTLED` + `fieldErrors.waitSeconds: ["1"]`（文字列配列）。`Number.parseInt` で読む実装と噛み合っている。`AppServerError` のクラスタグ（`$TSR/t/AppServerError`）もシリアライズを生き延びており、クライアントは `kind` / `code` を受け取れる。

### 4. `ink-tertiary` → `ink-secondary` の置換 — 退行なし

- 残存する `text-ink-tertiary` は 8 箇所。内訳は件数表示（`spec/design/index.md` §9 が明示的に `--color-ink-tertiary` を指定）、更新日時・作成日時などのメタ、プレースホルダー、`disabled:` 状態、装飾アイコン、無効化済み（準備中）パレットトリガー。**本文とボタンラベルは 1 箇所も残っていない**（§4.2 / §11 の禁止に抵触しない）。

### 5. `prefers-reduced-motion` の全体規則 — 退行なし

- `styles/index.css` の `@layer base` 内に `*, ::before, ::after` の全体規則。`!important` 宣言はレイヤー順が反転する（先に宣言された `base` が `utilities` に勝つ）ため、Tailwind の `transition-*` / `animate-*` ユーティリティを確実に上書きする。
- dev サーバーが返すコンパイル済み CSS に該当ブロックが出力されていることを実測で確認（`@layer theme, base, components, utilities` の宣言順つき）。`:focus-visible` の透明 outline（forced-colors 対策）も同じレイヤーに出力されている。

## AC-15〜19 の検証結果

| AC | 判定 | 根拠 |
| --- | --- | --- |
| AC-15 | 充足 | Cookie 属性は `HttpOnly` / `SameSite=Lax` / `Path=/` / `Secure`（production のみ、dev 例外は記録済み）/ `Expires = now + Session.ttlMs`。未認証 → `/signin?redirect=…` の 307 を実測。`UNAUTHENTICATED`→401 / `THROTTLED`・`LOCKED`・`RATE_LIMITED`→429 / `NOTE_GONE`→410 は `httpStatusFor` の閉じた例外表 + 単体テストで pin され、429 は実測でも確認。ミューテーションは全て `method:"POST"` の server function、状態変更 GET なし（サインアウトも POST、verify-email のトークン消費も POST）。CSRF は同一オリジン検証として実際に強制されている（上記1）。付随して `Cache-Control: private, no-store` / CSP / `Referrer-Policy` / `nosniff` が全応答に載ることも実測。 |
| AC-16 | 充足 | P-01 は項目エラー（入力隣接・常設 live region）・送信完了パネル（見出しへフォーカス移動）・全体エラー、P-02 は認証失敗共通文言 / 未確認 / 待機中 / ロック中を `Phase` 直和で分離。両者とも L-03（`AuthLayout`）配下で、相互導線あり。SSR 200 を実測。 |
| AC-17 | 充足（ADR-038 の同一ブラウザー条件つき、plan.md の注記どおり） | 上記2の実測。別ブラウザーは `verifiedSignInRequired`（「確認しました → サインインへ」）へ倒れる。 |
| AC-18 | 充足 | `/notes` の空状態 →「白紙から書く」→ `createBlankNoteFn` 200 → `/notes/{id}` が「無題」+「このノートは白紙です」を SSR。存在しない noteId は P-46 の共通表示に収斂（`NOTE_NOT_FOUND`）。スケルトンは per-fragment streaming の Suspense fallback として実 DOM を写した形。 |
| AC-19 | 充足 | P-46 は `router.tsx` の `defaultErrorComponent` / `defaultNotFoundComponent` と root の両方に配線され、存在と権限を区別しない同一文言。再試行は `<button>`（全再読み込み＝安全な GET）。未知 URL は 404 を実測。P-47 は `/terms` `/privacy` が L-02 で 200。 |

## 補足（報告対象外と判断したもの）

出荷を止める基準に達しないため Warning にしていないが、記録として残す。

- 存在しないノートの `/notes/$noteId` は HTTP 200 で P-46 表示を返す（fragment 内で解決するため）。P-46 の要求は表示の共通化であって status ではなく、利用者の操作性にも影響しない。
- LOCKED のアラートは `now` の更新契機が THROTTLED のタイマーしか無いため、解除時刻を過ぎても再描画まで残り続ける。倒れる向きが「注意喚起が残る」側で害が無い。
- `AppShell` の準備中パレットトリガー（`disabled` + `opacity-55`）のラベルが `ink-tertiary`。無効化コントロールはコントラスト要件の対象外で、§11 の禁止（本文・ボタンラベル）の趣旨からも外れる。

## 品質ゲート（実行結果）

- `pnpm typecheck` — 緑（root / `packages/core` / `apps/web`）
- `pnpm test:unit` — 緑（28 files / 466 tests）
- `pnpm dev:node` — 起動・SSR・server function の実測を上記のとおり実施

## カバレッジ

- 確認（`apps/web/` の非削除 66 ファイル中 64、いずれも `git diff origin/main...HEAD` で差分を確認したうえで全文読解）:
  - `apps/web/app/start.ts`
  - `apps/web/app/presentation/{verificationSession,session,auth,redirect,clientKey,serverErrorLog,serverFragment,errorDisplay,errorResponse,errorResponseMiddleware,validator,pagination,appServerErrorAdapter}.ts(x)`
  - `apps/web/app/presentation/__tests__/{verificationSession,errorDisplay,errorResponse,redirect}.test.ts`
  - `apps/web/app/components/auth/{SignInForm,SignUpForm,VerifyEmailPanel}/{index.tsx,action.ts}`、`apps/web/app/components/auth/{fieldValidation,formStyles,schema}.ts`
  - `apps/web/app/components/layout/{AppShell,AuthLayout,PublicShell,LegalPage}/index.tsx`、`apps/web/app/components/layout/AccountMenu/{index.tsx,action.ts}`
  - `apps/web/app/components/note/{NoteList,NoteDetail,CreateNoteButton}/{index.tsx,action.ts}`、`apps/web/app/components/note/{NoteBody,NoteListSkeleton,NoteDetailSkeleton}/index.tsx`
  - `apps/web/app/components/ui/{Alert,BrandMark,ErrorState,Skeleton}/index.tsx`
  - `apps/web/app/routes/{__root,index,signin,signup,verify-email,terms,privacy}.tsx`、`apps/web/app/routes/notes/{index,$noteId,-action}.tsx`
  - `apps/web/app/router.tsx`
  - `apps/web/app/styles/{index,theme,tokens}.css`
  - `apps/web/app/server.node.ts`、`apps/web/vite.config.node.ts`、`apps/web/package.json`、`apps/web/.env.example`
- スキップ:
  - `apps/web/app/routeTree.gen.ts` — ルーター生成物（手書き変更なし）
  - `apps/web/app/worker/node/runner.ts` — ワーカー実行層。core レビュー担当（ラウンド4で審議済み）
  - `apps/web/app/{server.aws,server.cloudflare,server.gcp}.ts`、`apps/web/app/worker/{aws,cloudflare,gcp}/**`、`apps/web/scripts/**`、`apps/web/{drizzle*.config.ts,vite.config.{aws,cloudflare,gcp}.ts,wrangler*,Dockerfile.gcp}`、`apps/web/app/components/todo/**`、`apps/web/app/routes/todo/**` — 全て削除のみ（Node + memory 構成への縮退、ADR-009）
  - `packages/core/**`、`infra/**`、`docs/**`、`.github/workflows/ci.yml`、ルート設定ファイル、`pnpm-lock.yaml` — 本レビュー観点の担当外
