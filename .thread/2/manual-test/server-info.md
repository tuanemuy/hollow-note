# サーバー情報

- URL: http://localhost:3100
- PID: 記録は /tmp/manual-test-server.pid
- 起動コマンド: `pnpm exec vite dev --config vite.config.node.ts --port 3100`（`apps/web` 内）
- ログ: /tmp/manual-test-server.log
- 環境変数（`apps/web/.env`、検証用に一時差し替え。終了時に復元）:
  - `APP_URL=http://localhost:3100`
  - `OAUTH_DEV_MODE=true`
  - `MEMORY_MAIL_LOG_ACTION_URL=true`
- ポート 3000 は別セッションの古い dev サーバーが占有していたため 3100 を使用（占有プロセスには触れていない）
- 永続化は in-memory のため、全テストを 1 プロセス内で通しで実行する
- エッジケース 5 / 6 の実行でサーバーを 3 回再起動した（`OAUTH_DEV_MODE` なし → Google dummy 資格情報 → 元の `.env` に復元）。`.env` は復元済み・サーバーは起動中（PID は `/tmp/manual-test-server.pid`）だが、**in-memory データはすべて消えている**
