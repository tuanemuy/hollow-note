# REGRESSION: 既存機能への影響確認

**結果**: PASS
**目的**: 本 Issue の変更（Node ランタイム一本化・in-memory 化・todo 参照実装削除）が既存機能を壊していないこと（AC-14、AC-20、plan.md リスク欄）

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | `pnpm typecheck` | 成功 | 終了コード 0。`tsgo`（root）、`packages/core`、`apps/web` すべて `Done` | PASS |
| 2 | `pnpm lint` | 成功 | 終了コード 0。`Checked 248 files … No fixes applied. Found 2 infos.`（info は biome 設定スキーマの移行案内 `biome migrate` のみで、コード起因の lint 違反は 0 件） | PASS |
| 3 | `pnpm format:check` | 成功 | 終了コード 0。`Checked 260 files … No fixes applied.`（未整形ファイルなし） | PASS |
| 4 | `pnpm test:unit` | 成功 | 終了コード 0。`Test Files 28 passed (28)` / `Tests 466 passed (466)` | PASS |
| 5 | `pnpm build` | 成功 | 終了コード 0。`✓ built in 670ms`。ログ中の `error` / `warn` 一致は出力ファイル名（`ErrorState-*.js` 等）のみで、実エラー・警告は 0 件 | PASS |
| 6 | `pnpm start`（本番ビルド）を起動 | `[listen.node] listening on ...` で待ち受ける | `[listen.node] listening on http://0.0.0.0:3100` を出力（dev サーバーと衝突させないため `PORT=3100 APP_URL=http://localhost:3100` で起動）。`GET /` が 200 | PASS |
| 7 | 本番ビルドで公開トップ `/` を表示 | 公開トップが表示される | 「チームのための / ひとつのノート。」＋「無料ではじめる」「サインイン」「利用規約」「プライバシーポリシー」を表示 | PASS |
| 8 | 本番ビルドで `/signup` から `prod@example.com` / `Passw0rd123` / `Prod User` をサインアップ | **404 にならず**送信完了状態になる | 「確認メールを送信しました／prod@example.com 宛に…」。ログに `mail.sent { to: 'prod@example.com', template: 'emailVerification', actionUrl: 'http://localhost:3100/verify-email?token=MDE5ZmViMjgt….IGBKFNQctYGD2uVmNbgljEq7-0HYMRfCt5zxAgxHU64' }` | PASS |
| 9 | 本番ビルドで確認 URL を同一ウィンドウで開く（verify server function） | **404 にならず** `/notes` へ着地しサインイン状態になる | `POST /_serverFn/d39111775ae…` が **200**。`http://localhost:3100/notes` へ遷移し、空状態「0 件のノート／最初のノートを作る／白紙から書く」を表示 | PASS |
| 10 | 本番ビルドで「白紙から書く」＝ createBlankNote | **404 にならず**ノートが作成され詳細へ遷移 | `POST /_serverFn/586d36ac024…` が **200**。`http://localhost:3100/notes/019feb28-85be-7510-9a70-d0c1548dedcd` へ遷移し「非公開 · 2026年8月10日 / 無題 / このノートは白紙です。」を表示 | PASS |
| 11 | 本番ビルドで `/notes` に戻り一覧を確認 | 作成したノートが 1 件表示される | 「1 件のノート／無題／非公開。／更新 8月10日 19:12」 | PASS |
| 12 | 本番ビルドでサインアウト（signout server function） | **404 にならず**未認証へ戻る | `POST /_serverFn/5d4d6d3bdbc…` が **200**。`http://localhost:3100/` の公開トップへ着地 | PASS |
| 13 | 本番ビルドで `/signin` から再サインイン（signin server function） | **404 にならず** `/notes` へ着地 | `POST /_serverFn/6ddf522d4ef…` が **200**。`http://localhost:3100/notes` へ着地 | PASS |
| 14 | 本番ビルドで `/todo` を開く | 旧 UI が存在せず P-46 の共通表示 | HTTP **404**。旧 todo UI は表示されない | PASS |
| 15 | 本番ビルドで `/terms` のレスポンスヘッダーを確認 | セキュリティヘッダーが付く | `HTTP/1.1 200 OK` / `x-content-type-options: nosniff` / `referrer-policy: strict-origin-when-cross-origin` | PASS |
| 16 | dev サーバーで `/todo` を開く | P-46 の共通表示になり旧 UI が残っていない | HTTP **404**。画面は「このページは見つかりません／URL が変わったか、削除された可能性があります。／ノート一覧へ／トップへ」。todo の一覧・追加フォーム等は一切存在しない | PASS |
| 17 | dev サーバーの起動ログを確認 | libSQL / `DATABASE_URL` / wrangler 関連のエラー・警告が出ない（AC-14） | 起動ログは `VITE v8.1.5 ready in 1275 ms` ＋ Local/Network URL ＋ `[vite] (ssr) connected.` / `[vite] (rsc) connected.` のみ。ログ全体を `libsql\|DATABASE_URL\|wrangler\|d1\|error\|warn\|deprecat` で grep してヒット 0 件 | PASS |
| 18 | 本番ビルドの起動ログを同条件で grep | 同上 | ヒット 0 件（`[listen.node] listening on …` と `mail.sent` / `[queue] received …` のみ） | PASS |
| 19 | 検証後に作業ツリーが汚れていないことを確認 | コード変更なし | `git status --porcelain` は `?? .thread/1/manual-test/`（本テストの結果ファイル）のみ。ソースは無変更 | PASS |

## 巡回した URL 一覧

dev サーバー（`http://localhost:3000`）:

| URL | ステータス | 備考 |
|---|---|---|
| `/` | 200 | 公開トップ |
| `/signin` | 200 | サインイン（見送り UI なし） |
| `/signup` | 200 | サインアップ（見送り UI なし） |
| `/terms` | 200 | 静的ページ |
| `/privacy` | 200 | 静的ページ |
| `/notes` | 307 | 未認証は `/signin?redirect=%2Fnotes` へリダイレクト |
| `/notes/019feb0e-e2a8-7703-b022-9a8f8745dafd` | 200（認証時） | user-a のノート詳細（EDGE-4 の復帰先） |
| `/notes/does-not-exist` | 307 | 未認証はサインインへ（認証時は P-46） |
| `/verify-email?token=…`（使用済み / 改竄 / 不正形式 / 他人のトークン） | 200 | 各状態表示。EDGE-2 / EDGE-3 参照 |
| `/todo` | 404 | 削除済み。P-46 の共通表示 |

本番ビルド（`http://localhost:3100`、`pnpm build` → `pnpm start`）:

| URL | ステータス | 備考 |
|---|---|---|
| `/` | 200 | 公開トップ（サインアウト後の着地先でもある） |
| `/signup` | 200 | サインアップ送信 → 200 |
| `/verify-email?token=…` | 200 → `/notes` | 自動サインイン成立 |
| `/notes` | 200 | 空状態 → 1 件 |
| `/notes/019feb28-85be-7510-9a70-d0c1548dedcd` | 200 | 作成した白紙ノート詳細 |
| `/signin` | 200 | 再サインイン成功 |
| `/terms` | 200 | `nosniff` / `referrer-policy` 付与 |
| `/todo` | 404 | 旧 UI なし |

## 補足・観測メモ（失敗ではない）

- **server function の side-effect import 漏れは発生していない**。本番ビルドで signup / verify / createBlankNote / サインアウト / signin の 5 本すべてが `POST /_serverFn/<hash>` で **200** を返し、1 本も 404 にならなかった（plan.md リスク欄の gotcha は再現せず）。
- `pnpm lint` の 2 件の info は Biome 2.x の設定スキーマ移行案内（`biome migrate`）で、本 Issue の変更とは無関係かつ終了コードは 0。
- ローカルの `apps/web/.env` は旧世代の内容（`DATABASE_URL=file:./data/app.db` などの libSQL 記述）が残っているが、`.gitignore` 済み・未追跡のローカルファイルであり、リポジトリに追従している `.env.example` は in-memory 前提の新しい内容に更新済み。なお旧 `DATABASE_URL` が環境に残ったままでも dev / 本番とも libSQL 関連の警告・エラーは一切出ず、他ランタイム削除が完了していることの傍証になっている。
- 本番ビルドで作成した白紙ノートの詳細ページでは Shadow DOM ホストが 0 件だったが、本文が空（「このノートは白紙です。」のプレースホルダー表示）のケースであり、本文があるノートでの Shadow DOM 描画は TC-4 で確認済みのため本項目では失敗と判定していない。
- 検証用に起動した本番サーバー（ポート 3100）は確認完了後に停止済み。**dev サーバー（ポート 3000）は起動したまま維持**している。

## 失敗詳細

なし。
