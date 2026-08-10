# 検証環境

- URL: http://localhost:3000
- 起動コマンド: `MEMORY_MAIL_LOG_ACTION_URL=true PORT=3000 pnpm dev`
- PID ファイル: /tmp/manual-test-server.pid
- サーバーログ: /tmp/manual-test-server.log
- 永続化: in-memory（プロセス再起動で全データ消失）。全テストを 1 プロセス内で通す
- 確認メールの URL: サーバーログに `actionUrl` として出力（`MEMORY_MAIL_LOG_ACTION_URL=true` で有効化）
