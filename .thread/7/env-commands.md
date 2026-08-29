# 動作確認コマンド調査 — Issue #7

**調査対象:** Issue #7（ノート編集・メディア・タイトル・ゴミ箱）を実機で確認するために必要な実行コマンド。
プロジェクト全体のセットアップ（依存インストール等）は対象外。

事実収集のみ。すべて実ファイルを Read して確認した内容。

---

## 検証環境の起動

| 用途 | コマンド | 出典 |
| --- | --- | --- |
| 開発サーバー（Node、in-memory アダプター） | `pnpm dev` | root `package.json` `scripts.dev` = `pnpm --filter @repo/web dev`。`apps/web/package.json` `scripts.dev` = `pnpm dev:node` = `vite dev --config vite.config.node.ts`。既定 URL は `http://localhost:3000`（README.md「Quick Start」/ `.env.example` `APP_URL=http://localhost:3000`） |
| 開発サーバー（明示的に node ターゲット） | `pnpm dev:node` | root `package.json` `scripts.dev:node` = `pnpm --filter @repo/web dev:node` |
| 本番ビルド | `pnpm build`（= `pnpm build:node`） | root `package.json` `scripts.build` / `scripts.build:node` = `pnpm --filter @repo/web build[:node]`。`apps/web/package.json` `scripts.build:node` = `vite build --config vite.config.node.ts` |
| 本番起動 | `pnpm start`（= `pnpm start:node`） | root `package.json` `scripts.start` / `scripts.start:node` = `pnpm --filter @repo/web start[:node]`。`apps/web/package.json` `scripts.start:node` = `tsx scripts/listen.node.ts` |

起動後の待ち受け URL は `.env` の `APP_URL` で決まる（`docs/runtime_node.md`「`vite dev` binds to this URL's port」/ `.thread/21/testing.md` の実測でも `APP_URL=http://localhost:3100` のとき `pnpm dev` は `:3100` で待ち受けることを確認済み）。既定値は `http://localhost:3000`（`.env.example` の `APP_URL` コメント行）。

本番起動時の待ち受け URL 確認方法: 起動ログの `[listen.node] listening on ...` 行（`.thread/1/testing.md` に記載、`apps/web/scripts/listen.node.ts` を出典として明記）。

## 必要な事前準備

1. `.env` のコピー: `cp apps/web/.env.example apps/web/.env`（README.md「Quick Start」/ `docs/runtime_node.md`「Quick start」の両方に同一コマンドあり）
2. `APP_URL` の設定（必須項目。`.env.example` 冒頭「Required」セクション）
3. サインイン用 identity provider を**どちらか一方**設定しないと boot が失敗する（`.env.example` / `docs/runtime_node.md`「Choosing an OAuth identity provider」）。
   - ループバック dev IdP: `apps/web/.env` に `OAUTH_DEV_MODE=true` を設定（コメントアウトを外す）。**`NODE_ENV=development` のときのみ受理される**（`vite dev` = `pnpm dev` がこれを設定する）。同意画面は `/dev/oauth/authorize`。Google 資格情報なしで OAuth 往復を確認できる。
   - 実 Google: `.env` に `GOOGLE_OAUTH_CLIENT_ID` と `GOOGLE_OAUTH_CLIENT_SECRET` を設定（`OAUTH_DEV_MODE` はコメントアウトのまま）。redirect URI は `${APP_URL}/auth/callback/google`。
4. （任意・メール確認リンクを画面操作なしで取得したい場合）`.env` に `MEMORY_MAIL_LOG_ACTION_URL=true` を設定すると、`pnpm dev` のターミナルログの `mail.sent` 行に `actionUrl`（確認リンクの実 URL、生トークン付き）が出力される（`.env.example`「Optional: local mail debugging」/ `docs/runtime_node.md`「Persistence model」）。既定は無効（トークン漏洩を避けるため）。
5. `pnpm start`（本番ビルド）でのループバック IdP 利用は不可: `OAUTH_DEV_MODE` は `NODE_ENV=development` でしか受理されず、`vite dev` 以外はこの値を設定しない（`docs/runtime_node.md`「Choosing an OAuth identity provider」に「Running the production build against the dev IdP is deliberately awkward: it takes an explicit `NODE_ENV=development 	pnpm start`」の記載あり）。

Node バージョン要件: `package.json` の `engines.node` は `>=22.12.0`、`engines.pnpm` は `11.1.2`。

## シードデータの用意

**該当なし。** 以下を確認した上での事実:

- root / `apps/web` / `packages/core` いずれの `package.json` にも `seed` を含む script キーは存在しない（`scripts` セクション全項目を確認済み。下記「テスト実行コマンド」節に全項目を列挙）。
- `apps/web/scripts/` には `listen.node.ts`（本番起動ランチャー）のみが存在し、シード用スクリプトは無い。
- 永続化は in-memory アダプター（`packages/core/src/adapters/memory/`）で、プロセス再起動でデータが全て消える（`docs/runtime_node.md`「Persistence model」/ `CLAUDE.md`「there is no database to provision and nothing to migrate before `pnpm dev`」）。
- 検証用データは UI 操作（サインアップ → メール確認 → ノート作成等）で都度作成する運用が既存の `.thread/*/testing.md`（例: `.thread/1/testing.md`「テストユーザーは都度サインアップで作成する」、`.thread/21/testing.md`「マイグレーション・シード」節「不要」）でも一貫して採られている。

## テスト実行コマンド

root `package.json` の `scripts` 全項目（`pnpm test` 系のみ抜粋。他項目は別セクション参照）:

| コマンド | 内容 | 出典 |
| --- | --- | --- |
| `pnpm test` | `pnpm test:unit` の別名 | root `package.json` `scripts.test` = `"pnpm test:unit"` |
| `pnpm test:unit` | 全プロジェクト（node + workers）を vitest run | root `package.json` `scripts.test:unit` = `"vitest run"` |
| `pnpm test:node` | node プロジェクトのみ | root `package.json` `scripts.test:node` = `"vitest run --project node"` |
| `pnpm test:workers` | workers プロジェクトのみ（Cloudflare アダプター、workerd 内） | root `package.json` `scripts.test:workers` = `"vitest run --project workers"` |

部分実行（ファイル・ディレクトリ指定、`docs/test.md`「Commands」節に記載）:

- 特定ディレクトリのみ: `pnpm exec vitest run packages/core/src/application/identity`
- 特定の Cloudflare ファイルのみ: `pnpm exec vitest run --project workers packages/core/src/adapters/cloudflare/__tests__/conformance/identity.test.ts`
- `--reporter=verbose` を付けると `describe`/`it` 名を1行ずつ出力（`.thread/21/testing.md` で使用実績あり。テスト名は `TC-xxx-nnn` の台帳 ID を先頭に持つ）

## 静的検証コマンド（root `package.json` `scripts` 全項目のうち test 以外）

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsgo && pnpm -r typecheck`（root の tsgo に加え、各パッケージの `typecheck` script を再帰実行。`apps/web/package.json` の `typecheck` = `tsgo`、`packages/core/package.json` の `typecheck` = `tsgo && tsgo -p tsconfig.cloudflare.json`） |
| `pnpm lint` | `biome lint` |
| `pnpm lint:fix` | `biome check --write` |
| `pnpm format` | `biome format --write` |
| `pnpm format:check` | `biome format` |

`CLAUDE.md`「After changes」節に定める変更後ルーチン: `pnpm typecheck && pnpm lint:fix && pnpm format`

## デプロイ方法

**なし。** 参照ランタイムは Node.js + in-memory アダプターの1本のみ（`CLAUDE.md`「Reference runtime」/ `README.md`「Reference runtime」/ `docs/runtime_node.md` 冒頭）。デプロイ設定ファイル（`wrangler.toml`、`vercel.json`、`netlify.toml` 等）はリポジトリルート・`apps/web/`・`packages/core/` のいずれにも存在しない。`packages/core/wrangler.test.jsonc` のみ存在するが、これは `workers` vitest プロジェクトのテスト用設定であり本番デプロイ設定ではない（`docs/test.md`「Fake policy」/ `docs/runtime_node.md` 冒頭に明記）。

CI（`.github/workflows/ci.yml`）は3ジョブ構成で、いずれもデプロイではなく検証:
- `lint-typecheck-unit`: `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test:node`
- `unit-tests-workers`: `pnpm test:workers`
- `build`: `pnpm build:node`

## 見つからなかったもの

- 要確認: Issue #7 固有のシード投入手順・サンプルメディアファイルの用意方法（package.json / scripts/ のいずれにも存在せず、UI操作での都度作成が前提と見られるが、Issue #7 の実装内容（メディアアップロード）に応じてテスト用画像ファイル等の準備手順が別途必要になる可能性がある。今回の調査範囲では実在するコマンド・スクリプトを確認できなかった）
- 要確認: `apps/web/CLAUDE.md` および `packages/core/CLAUDE.md` は存在しない（ルートの `CLAUDE.md` のみ確認）
- 要確認: `Makefile` は存在しない
- 要確認: Issue #7 の内容そのもの（`.thread/7/` ディレクトリは今回の調査開始時点で存在せず、`plan.md` 等の関連ドキュメントは未確認。本調査は環境・コマンドの事実収集のみを対象としたため、Issue #7 の具体的な受け入れ基準・対象機能の詳細とは突き合わせていない）
