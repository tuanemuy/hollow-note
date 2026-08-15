# エッジケース 5: `OAUTH_DEV_MODE` が偽のとき dev IdP のルートが 404 になる

**結果**: PASS
**対応する受け入れ基準**: ADR-003 / ADR-021

## 実行ログ

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| 1 | 他のすべての確認（項目 1〜28・エッジケース 1〜4）の完了を確認 | — | 完了済み。`.env` を退避して実行 | PASS |
| 2 | `apps/web/.env` から `OAUTH_DEV_MODE=true` を削除し、`GOOGLE_OAUTH_CLIENT_ID=dummy` / `GOOGLE_OAUTH_CLIENT_SECRET=dummy` を追加して dev サーバーを再起動 | サーバーが起動する（Google アダプターが選択される） | 起動成功。`GET /` は **200**、サーバーログにエラー・警告 0 件 | PASS |
| 3 | `http://localhost:3100/dev/oauth/authorize?...`（正規のクエリー一式）を開く | 404 相当の「見つかりません」表示。同意画面は描画されない | `curl` の HTTP ステータスが **404**。ブラウザ表示は「このページは見つかりません／URL が変わったか、削除された可能性があります。／ノート一覧へ／トップへ」。同意フォーム（メールアドレス・表示名・許可する）は一切描画されない | PASS |
| 4 | `.env` を元（`OAUTH_DEV_MODE=true`、Google の 2 行を削除）に戻して再起動 | 元の状態に戻る | `.env` は `APP_URL` / `OAUTH_DEV_MODE=true` / `MEMORY_MAIL_LOG_ACTION_URL=true` の 3 行に復帰。`GET /` は 200、ログにエラー無し | PASS |

## 補足の検証（`OAUTH_DEV_MODE` も Google 資格情報も無い状態）

| # | 操作 | 期待結果 | 実際の結果 | 判定 |
|---|------|---------|-----------|------|
| A | `.env` を `APP_URL` / `MEMORY_MAIL_LOG_ACTION_URL` のみにして再起動し `GET /` | 起動そのものが失敗し、`.env` に `OAUTH_DEV_MODE=true` を足す旨の案内が出る | 起動時の環境変数検証（`readNodeServerEnv` / `serverNode.ts:175`）が ZodError で落ち、案内文は `No OAuth identity provider is configured: add \`OAUTH_DEV_MODE=true\` to apps/web/.env and run \`pnpm dev\` (NODE_ENV=development), or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET`。`GET /` は **500** | PASS |

- 注記: `pnpm dev`（vite dev）では vite のプロセス自体は立ち上がり、アプリの boot がリクエスト時に失敗して 500 になる（`server.node.ts` の `getOrStartBoot` 経由）。「起動そのものが失敗する」は**アプリの boot が失敗し全リクエストが 500 になる**という形で現れる。案内文の内容は ADR-003 規則 3 のとおり。

## 失敗詳細

なし。
