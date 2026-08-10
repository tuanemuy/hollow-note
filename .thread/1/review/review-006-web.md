# レビュー 006 — Frontend / Presentation / Security（最終確認ラウンド）

対象: PR #12 / `issue/1/account-to-blank-note-skeleton` → `main`
契約: `.thread/1/plan.md` AC-15〜19、`spec/pages/`、`spec/design/index.md`、`.thread/1/adr.md`（ADR-007 / 008 / 038）
既出指摘（`.thread/1/review/triage.md` ラウンド1〜5、約100件）および Issue #13 に defer 済みの RPC 3往復は再審議していない。

## 前提の確認

ラウンド5以降の唯一のコミット `e91f274` は `packages/core` のテスト1件のみで、**`apps/web` の差分はラウンド5時点と同一**（`git log faab0f2..HEAD -- apps/web/` が空、`git diff e91f274~1 e91f274 -- apps/web/` が空）。したがって本ラウンドは静的レビューの再走ではなく、**実行時検証による出荷可否の最終判定**に重心を置いた。

## Frontend / Presentation / Security

### Blockers

なし

### Warnings

- **[W-001]** `pnpm build` → `pnpm start`（本番形）で起動したアプリはクライアント JS を1本も配信できず、完全に非インタラクティブになる — 場所: `apps/web/scripts/listen.node.ts` / `apps/web/app/server.node.ts` / `docs/runtime_node.md`（L15-19, L24-25） / 理由: 実測で `/assets/*.js` が**全件 404**（`index-*.js` / `jsx-runtime-*.js` / `react-*.js` / `SignUpForm-*.js` ほか、`favicon.ico` / `site.webmanifest` も 404）。`listen.node.ts` は `booted.fetch` だけを `@hono/node-server` に登録しており、`dist/client` も `public/` も配信する経路が存在しない。結果としてハイドレーションが起きず、`SignUpForm` の送信ボタンは `disabled` のまま（React state が更新されないため `hasFieldError` が真に固定）、サインアップ・サインイン・ノート作成のすべてが実行不能。SSR された HTML は正しく返るため一見しては気づけない。/ 提案: `@hono/node-server/serve-static` 等で `dist/client` と `public/` を配信するか、`docs/runtime_node.md` の「production-shaped build」の記述に前段の静的配信が必須である旨を明記する。

  **これを Blocker にしなかった根拠**（判断が割れうるので明示する）:
  - **本 PR の作り込みではない**。`apps/web/scripts/listen.node.ts` は `origin/main` から**無変更**（`git diff origin/main...HEAD` が空）、静的配信の実装は main / HEAD いずれにも存在しない（`git grep serveStatic|serve-static|sirv` が両方とも 0 件）。`vite.config.node.ts` の差分も libSQL の external 指定を落としただけで、アセット配信には無関係。つまり main の時点で `pnpm start` は同じく壊れていた。
  - **AC-14 の文言は `pnpm dev` / `pnpm build` に限定**されており、両者は緑（build 成功、dev で後述の e2e 全通過）。`pnpm start` は AC の検証対象に入っていない。
  - plan.md のマニュアルテスト方針も `pnpm dev` で実行すると定めている。
  - ただし本 PR は cloudflare / aws / gcp ランタイム（＝プラットフォーム側が静的アセットを配信していた構成）と `pnpm preview` を削除して **Node を唯一のランタイムにした**ため、「本番形で動かす手段が実質存在しない」状態が今回はじめて表面化した。後続スライスへ持ち越す場合は Issue 化が要る。

### カバレッジ

`apps/web` の変更 116 ファイル（新規・変更 66 / 削除 50）。

- **確認（実行時検証を新規に実施）**: `apps/web/` の新規・変更 66 ファイル全体を、ラウンド5の全文読解済みという前提のうえで、本ラウンドでは以下の二重化で確認した。
  - **差分の同一性**を git で機械的に確認（上記「前提の確認」）。ラウンド5の読解結果がそのまま有効であることの根拠。
  - **セキュリティ critical な経路は独立に再読解**: `apps/web/app/start.ts`（CSRF ミドルウェア登録）、`apps/web/app/presentation/{session,verificationSession,redirect,auth}.ts`（Cookie 属性・ADR-038 束縛・オープンリダイレクト防止・認証ガード）、`apps/web/app/components/auth/SignUpForm/index.tsx`（送信ゲート）、`apps/web/app/server.node.ts`（セキュリティヘッダー）、`apps/web/vite.config.node.ts`、`apps/web/scripts/listen.node.ts`。
  - **残余（UI コンポーネント・ルート・スタイル・テスト）はブラウザー実操作で挙動を検証**（下記 e2e）。`components/{auth,layout,note,ui}/**`、`routes/**`、`styles/**` は描画・状態遷移・導線を実画面で確認。
- **スキップ**:
  - `apps/web/app/routeTree.gen.ts` — ルーター生成物（手書き変更なし）
  - `apps/web/app/worker/node/runner.ts` — ワーカー実行層。core レビュー担当（ラウンド4で審議済み）
  - 削除のみの 50 ファイル（`server.{aws,cloudflare,gcp}.ts`、`worker/{aws,cloudflare,gcp}/**`、`scripts/migrate.*`、`drizzle*.config.ts`、`vite.config.{aws,cloudflare,gcp}.ts`、`wrangler*`、`Dockerfile.gcp`、`components/todo/**`、`routes/todo/**`）— Node + memory 構成への縮退（ADR-009）。W-001 の文脈でのみ削除の影響を評価済み。
  - `packages/core/**`、`infra/**`、`docs/**`、ルート設定、`pnpm-lock.yaml` — 本レビュー観点の担当外（`docs/runtime_node.md` は W-001 の根拠としてのみ参照）

## e2e 動線の実測

`pnpm dev:node`（`APP_URL=http://localhost:3111`、`MEMORY_MAIL_LOG_ACTION_URL=true`）に対し、**agent-browser で実ブラウザーから UI を操作**して通した。ラウンド5は HTTP を直接叩く形だったので、UI 操作を介した経路は本ラウンドが初。

| 手順 | 結果 |
| --- | --- |
| `/signup` でフォーム入力 → 送信 | 「確認メールを送信しました」パネルへ遷移。`hollow_pending_verification=019feaf4-…` が付与（ADR-038 の確認待ち Cookie） |
| 確認メールのリンクを**同一ブラウザー**で開く | `/notes` へ着地。`hollow_pending_verification` は破棄され `hollow_session` が発行 = **AC-17 成立** |
| ノート一覧（空状態） | 「0 件のノート」「最初のノートを作る」「白紙から書く」。パレット案内（⌘K・準備中）も表示 |
| 「白紙から書く」 | `/notes/019feaf5-0480-70fd-947b-a13a30927356` へ遷移。「無題」+「このノートは白紙です。」+「非公開」「2026年8月10日」 = **AC-18 成立** |
| 「ノート一覧」へ戻る | 「1 件のノート」に更新（`router.invalidate()` の反映）。ノートカードに「無題 / 非公開 / 更新 8月10日 18:15」 |
| アカウントメニュー → サインアウト | `/` へ遷移し、**Cookie が全消失**（`cookies get` が空） |
| サインアウト後に `/notes` へ | `/signin?redirect=%2Fnotes` へリダイレクト = 認証ガード動作 |
| `/signin` で正しい資格情報 | `/notes` へ着地（`redirect` パラメーターの復帰が機能）= **AC-16 成立** |
| `/signin` で誤ったパスワード | 「メールアドレスかパスワードが違います / 入力内容を確認してもう一度お試しください。」— 利用者列挙にならない共通文言 |
| 誤りを連続送信（3回以上） | 待機状態へ遷移し、待機明けに「もう一度お試しいただけます / 待機時間が終わりました。」へ差し替わる（再活性化の告知が機能） |
| 存在しない `noteId` | 「このページは見つかりません / URL が変わったか、削除された可能性があります。」+「ノート一覧へ」「トップへ」= **AC-19（P-46）** |
| `/terms` `/privacy` | 「利用規約」「プライバシーポリシー」+ 改定日を表示 = **AC-19（P-47）** |
| 未知 URL | HTTP 404 |

本番ビルド（`NODE_ENV=production` の `pnpm start`）でも SSR とヘッダーは実測した:

- `GET /` → 200、`cache-control: private, no-store` / `content-security-policy: frame-ancestors 'self'; form-action 'self'; object-src 'none'; base-uri 'self'` / `referrer-policy: strict-origin-when-cross-origin` / `x-content-type-options: nosniff` が全応答に付与
- `GET /notes`（未認証）→ 307 `location: /signin?redirect=%2Fnotes`
- ただしクライアントアセットは全件 404（W-001）

**起動したプロセスは全て終了済み**（`pnpm start` / `pnpm dev` / agent-browser。ポート 3111 解放を確認）。

## AC-15〜19 の充足判定

| AC | 判定 | 根拠 |
| --- | --- | --- |
| AC-15 | 充足 | Cookie は `HttpOnly` / `SameSite=Lax` / `Path=/` / `Secure`（production のみ、dev 例外は記録済み） / `Expires` = セッション期限。認証ガードの `/signin?redirect=…` 往復とサインイン後の復帰を実測。CSRF は `start.ts` の `createCsrfMiddleware` が全 server function に同一オリジン検証として掛かる（ラウンド5でクロスサイト POST の 403 を実測済み、本ラウンドで登録内容の無変更を確認）。ミューテーションは全て POST、状態変更 GET なし（サインアウトも verify-email のトークン消費も POST）。コード例外マッピング（401 / 429 / 410）は `httpStatusFor` の閉じた表 + 単体テストで pin。 |
| AC-16 | 充足 | P-01 / P-02 を `AuthLayout`（L-03）配下で実操作。項目エラー・送信完了パネル・認証失敗共通文言・待機中とその解除告知・相互導線を全て確認。 |
| AC-17 | 充足（ADR-038 の同一ブラウザー条件つき — plan.md の注記どおり） | 同一ブラウザーで確認リンク → 自動サインイン → `/notes` 着地を実測。別ブラウザーでの `Set-Cookie` ゼロ（login CSRF 不成立）はラウンド5で実測済みで、当該コードは無変更。 |
| AC-18 | 充足 | 空状態 → 「白紙から書く」→ 白紙ノート詳細（「無題」「このノートは白紙です。」）→ 一覧の件数更新までを実操作で通した。 |
| AC-19 | 充足 | P-46 は存在と権限を区別しない共通文言 + トップ / 一覧への導線。P-47 は `/terms` `/privacy` が表示。未知 URL は 404。 |

## 品質ゲート（実行結果）

- `pnpm build` — 緑（`dist/server/server.node.js` 生成、724ms）
- `pnpm typecheck` — 緑（root / `packages/core` / `apps/web`）
- `pnpm test:unit` — 緑（28 files / 466 tests）

## 総括

Blocker はゼロ。AC-15〜19 は実ブラウザー操作による e2e で全て充足を確認した。W-001 は本 PR が作り込んだものではなく（main から無変更）AC の検証対象外だが、Node が唯一のランタイムになったことで顕在化した実在のギャップなので、後続スライスへの持ち越しとして記録する。**この PR は出荷可能。**
