# 動作検証レポート — Issue #11: Cloudflare D1・Durable Objects・R2 アダプターを追加する

**Issue:** #11
**PR:** #46
**実行日:** 2026-08-26
**検証サイクル:** 1 周目（変更起因の FAIL なし）

---

## サマリー

| 区分 | 件数 |
|---|---|
| 確認項目 | 8 |
| エッジケース・異常系 | 3 |
| 既存機能への影響確認 | 1 |
| **合計** | **12** |
| PASS | 12 |
| FAIL | 0 |

**起票した Issue:** なし

## 内訳

| # | 項目 | 手段 | 判定 | 観測 |
|---|---|---|---|---|
| 1 | Cloudflare アダプターが共有ポート適合スイートを全件パスする | api | PASS | `--project workers` = 22 files / 368 passed / 0 skipped / 0 failed（exit 0）。`conformance/` の 7 ファイルすべて実行。`harness.test.ts` の全ケース緑 |
| 2 | 適合スイート呼び出し集合の一致 | api | PASS | 両プロジェクト = 99 files / 1352 passed / 3 skipped。`git diff origin/main...HEAD -- packages/core/src/adapters/conformance/` は空。未実装マーカーは実質 0 件（下記の注記参照） |
| 3 | transaction / 再試行 / 冪等性 / lease 回収の統合確認 | api | PASS | (a)〜(d) の全ケースが実在し緑 |
| 4 | `deleteFilesByOwner` の SQL 文数の実測 | api | PASS | `AC-5:` の 4 ケースが緑。`spec/platform/index.md:155` が `4n + 3` を記載 |
| 5 | `ScopeTaskScheduler` の fencing 決着が記録されている | api | PASS | ADR-019 / 085 / 094 が実在。ポート JSDoc・`spec/platform`「Scope Alarm」・`scopeObject.ts` の 3 か所が一致。`conformance/` の差分は空（契約無変更）。`alarm.test.ts` の 3 ケースが緑 |
| 6 | 既存 Node 参照ランタイムの回帰（自動テスト・静的検査） | api | PASS | node = 77 files / 984 passed / 3 skipped。`pnpm test` = 99 files / 1352 passed / 3 skipped。typecheck / lint / format:check すべて exit 0。`git diff origin/main...HEAD -- packages/core/src/adapters/memory apps/web` は空。TZ ピンは `vitest.config.ts:40` に維持 |
| 7 | 既存 Node 参照ランタイムの回帰（アプリの起動と主要動線） | browser | PASS | 下記に詳細 |
| 8 | 新規に決めた物理スキーマと spec の一致 | api | PASS | spec 差分 21 ファイル。`_occ_guard` / `scope_task_due_index` とも `spec/database/index.md` に節がある。migration は `0001` 1 ファイル、`CREATE TABLE` 21 件 |
| E1 | D1 の bound parameter 上限（100）と大きな `resolveMany` | api | PASS | `support.test.ts` の 4 ケースが緑（500 件 / 100 件の一括解決、上限超過の拒否を含む） |
| E2 | 適合スイート間の相互汚染（fresh backend 契約） | api | PASS | 2 回連続実行で最終サマリーが同一。`harness.test.ts` の分離 2 ケースが緑 |
| E3 | 全文検索（FTS5 + bigram）と memory 実装の契約差 | api | PASS | `localNoteQueryService` / `publicNoteQueryService` の適合スイート（ADP-note-021〜027）が memory / cloudflare の両バックエンドで緑 |
| — | ビルド | api | PASS | `pnpm build:node` exit 0（`✓ built in 407ms`） |

## 項目 7（browser）の観測

- **起動:** `VITE v8.1.5 ready in 1344 ms` / `➜ Local: http://localhost:3000/`。初回リクエストで `[server.node] worker runner started`、`[outbox] pruned 0 processed event(s)`
- **トップ:** タイトル `Hollow`、`heading "チームのための ひとつのノート。"`、`link "無料ではじめる"`
- **サインイン:** 「無料ではじめる」→ `/signup`（`heading "アカウントを作る"`）→「Google で続ける」→ `/dev/oauth/authorize?client_id=dev-google&redirect_uri=...`（`heading "開発用 ID プロバイダー"`）→「許可する」→ `http://localhost:3000/notes`（`heading "個人"` / `button "アカウントメニュー"`）。アカウントは `manual-test-11@example.com` / `Manual Test 11`
- **ノート作成:** 「白紙から書く」→ `http://localhost:3000/notes/01a03c63-42b4-737b-b3dc-426232b760a0`。詳細に `非公開·2026年8月26日` / `# 無題` / `このノートは白紙です。`。一覧に `link "無題 非公開。 更新 8月26日 13:45 8月26日"`。一覧から再度開いても同じ URL・同じ本文
- **Cloudflare 関連のエラー・警告:** なし。サーバーログ全文への `grep -inE "wrangler|workerd|miniflare|cloudflare|d1|durable|r2|binding|ERROR|WARN|error:"` が 0 件
- **ブラウザコンソールの新規エラー:** なし（`[vite] connecting/connected` と React DevTools の案内のみ）

## 注記

- **項目 2 の未実装マーカー検索が 1 件ヒットした。** `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts:31` の JSDoc にある「a backend answering with an empty array **has not implemented it**」で、ポート契約の文言を引用した散文。未実装の印ではないため PASS と判定した
- **`pnpm lint` が `Found 2 infos` を出す。** biome.json のスキーマバージョン不一致と非推奨フィールド `recommended` に関する情報メッセージで、エラーは 0 件。本 PR の変更に由来しない既存事象
- **node プロジェクトの 3 skipped** は資格情報の無い `adapters/oauth` の実 API ケースで、変更前から skip されている
