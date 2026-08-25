# PR Review #001 — [adapter] Cloudflare D1・Durable Objects・R2 アダプターを追加する

**PR:** #46
**Date:** 2026-08-26
**Round:** 1回目

## Summary

- Blockers: 7
- Warnings: 53
- Verdict: **BLOCKED**

## レイヤー別ファイル

- UoW / 実行機構・SQL 土台: review-001-uow.md（B: 1 / W: 10）
- Identity / directory / operation（D1 control plane）: review-001-identity.md（B: 1 / W: 10）
- Routing / outbox / scope インフラ: review-001-routing.md（B: 3 / W: 10）
- Scope business / 投影・全文検索 / R2: review-001-scope.md（B: 1 / W: 13）
- 合成・スキーマ・テストハーネス・spec/docs: review-001-composition.md（B: 1 / W: 10）

## カバレッジ

- 確認申告ゼロのファイル: なし（109 ファイルすべてに 1 体以上の「確認」申告あり）

## 指摘一覧

### Blockers

- [B-001] `do/repositories/scopeTaskScheduler.ts:claimDue` — 条件付き UPDATE の結果を見ずに全候補を返し、並行 claim が同じ行を 2 度配る（uow / routing の両方が独立に指摘）
- [B-002] `d1/repositories/{noteRouteStore,outboxRepository,idempotencyStore,noteRouteFanOutReader}.ts` + `scopeTaskQueue`/`scopeRouter`:エラー翻訳 — 駆動エラーを翻訳しておらず生の D1 エラーが application 層へ抜ける（routing）
- [B-003] `do/scopeObject.ts` + `do/alarm.ts` + `di/cloudflareRuntime.ts`:AC-6 前提 — DO Alarm turn と中央 runner の 2 writer を既定で出荷し ADR-019 の単一 writer 前提が崩れる。空のハンドラ表で claim するため中央 runner が飢餓する（routing）
- [B-004] `globalMaintenanceRunStore.ts:235,311,280,581`:並行制御 — lease・lane の条件付き更新に `_occ_guard` が無く「lease 保持者だけが進める」契約が成立しない。`PRUNE_WORKER_ID` がプロセス定数のため全 Worker が同一 owner を名乗る（identity）
- [B-005] `spec/platform/index.md:154` + `do/scopeObject.ts:126`:AC-5 — `4n + 3` は DO 内の実 SQL 文数ではない（`bind()` が全 RPC で +2 文、実際は約 `8n + 9`）（scope）
- [B-006] 本番ソース 21 箇所:spec-canon — `.thread/11/adr.md` を `spec/adr/` と衝突する「ADR 001〜004」番号で参照。有効な判断が canon に無い（composition）
- [B-007] （B-001 と同一問題を routing が独立に検出。台帳では 1 件として扱う）

### Warnings

**UoW / SQL 土台**
- [W-U01] `do/alarm.ts:runScopeAlarmTurn` — ハンドラ失敗の try/catch と backoff が無く `attempts` が永久に増えない。ハンドラ経路はテスト 0 件
- [W-U02] `execution/scopeUnitOfWork.ts` / `sql/errors.ts` — scope 平面の `_occ_guard` → `OPTIMISTIC_LOCK_FAILURE` 翻訳が未検証
- [W-U03] `do/scopeObject.ts` / `do/scopeStub.ts` / `sql/executor.ts` — bound parameter 100 の検査が scope 平面で効いていない（`createStorageExecutor` が死にコード）
- [W-U04] `do/scopeObject.ts:bind` — 全 RPC で INSERT+SELECT を撃ち読み 1 回が 3 文になる。`scopeColumnsFromName` が死にコード
- [W-U05] `do/dueIndex.ts` — due index 再公開が scope 全タスク数に比例し無界
- [W-U06] `sql/session.ts:readRows` — staged 削除 + LIMIT で件数を取りこぼす。`matches` が optional で型に守られていない
- [W-U07] `execution/writeSet.ts` ほか — 呼び出し元 0 の export が 6 つ。`markTouched` 未使用が「`opaque` で `scheduled_tasks` を触ると index publish と alarm 再武装が黙って飛ぶ」穴を不可視にしている
- [W-U08] `scopeTaskScheduler.ts:queryCandidates` — staged で候補読みがオーバーレイを通らず読みの一貫性が割れている
- [W-U09] `execution/globalUnitOfWork.ts` — 1 commit の文数に上限が無く D1 の invocation 予算が守られていない
- [W-U10] `di/cloudflareRuntime.ts` — 鍵束の既定値が isolate ごとに変わる

**Identity / directory**
- [W-I01] `0001_global_schema.sql:110` — spec が要求する `auth_tokens` の pending 部分 UNIQUE が無い。`findPendingByUserAndPurpose` も `ORDER BY` 無しで非決定
- [W-I02] `0001_global_schema.sql:229,275` — `account_deletion_manifest_items` / `global_maintenance_run_lanes` が spec の物理配置表にも列定義にも無い
- [W-I03] `0001_global_schema.sql:142,71` — `user_version`（読み手なし）・`(user_id, kind)` 索引（使用箇所なし）の追加、`created_at` の欠落
- [W-I04] `0001_global_schema.sql:51` — identities 8 件上限の `BEFORE INSERT` トリガー省略が未記録
- [W-I05] `globalMaintenanceRunStore.ts:363` — 同一 hour bucket に completed run が残っていると PK 違反で `SystemError`。memory は `started` を返し観測が割れる
- [W-I06] `cloudflareRuntime.ts:131` ほか — `DEFAULT_MAINTENANCE_TABLES` の実体が 3 コピー（composition W-C05 と同一）
- [W-I07] `accountDeletionManifestStore.ts:257`, `identityRemovalReceiptStore.ts:62` — `DO NOTHING` の文に `upsert` の行像を添えており read-your-writes が嘘をつく
- [W-I08] `__tests__/` — 一意性予約・distributed operation の `_occ_guard` 発火を観測する実バインディングテストが無い
- [W-I09] `pendingPorts.ts:1`, `conformance/identity.test.ts:12` ほか — 完了した並列委譲の足場とコメントが残存（composition W-C01 と同一）
- [W-I10] `identityUniqueDirectory.ts:278` — `operation_id UNIQUE` により「全部か無か」ループが 1 行しか回らない

**Routing / outbox / scope インフラ**
- [W-R01] `do/alarm.ts` — per-task の try/catch と backoff が無い（W-U01 と同一）
- [W-R02] `do/scopeObject.ts:applyWriteSet` — `publishDueIndex` 失敗時に `rescheduleAlarm` が走らず ADR-003 の前提が崩れる
- [W-R03] `do/alarm.ts` — CPU budget が打ち切るのは claim だけで、AC-6 の `leaseMs` 下限論拠が担保されていない
- [W-R04] `__tests__/lease.test.ts:150` — 「exactly one of two writers」を名乗るが二重 claim を観測できない
- [W-R05] `d1/repositories/outboxRepository.ts` — `claimPending`/`pruneProcessed` が staged セッションで黙って write-set を素通りする
- [W-R06] `__tests__` — `NoteRouteStore` の `_occ_guard` を発火させるテストが無い
- [W-R07] `do/dueIndex.ts` — due index 行に名前空間が乗らず ADR-004 の分離がこの表だけ効かない
- [W-R08] `do/scheduledTasks.ts` + `outboxRepository.ts` — スライス全体／バッチ全体を 1 binding に畳み 2MB 上限に無防備
- [W-R09] `do/repositories/scopeTaskScheduler.ts:write` — scope commit 成功後の D1 失敗を「書き込み失敗」として返す
- [W-R10] `spec/database/index.md` — `scope_task_due_index` の節が autocommit 経路の publish（ADR-020）を書いていない

**Scope business / 投影・検索 / R2**
- [W-S01] `d1/repositories/publicNoteQueryService.ts:36` — `public_note_search` に private 本文まで投影され可視性が read 側フィルタ頼み
- [W-S02] `localNoteQueryService.ts:130`, `publicNoteQueryService.ts:133` — `SELECT ns.*` が `text`（最大 800KB）を全行ぶん運ぶ
- [W-S03] `noteRevisionRepository.ts:91` — 削除のためだけに `html` 全列を読み、削除は 1 行 1 文
- [W-S04] `storedFileRepository.ts:263`, `noteRepository.ts:298` — `readForUpdate` の事前読みが契約上不要で `4n+3` の `2n` を作っている
- [W-S05] `search/highlight.ts:54` — `mapPositions` の 1 文字単位 NFKC が全体 NFKC と一致しない
- [W-S06] `projection/searchClauses.ts:54` — `tagNames` の重複で 0 件になる
- [W-S07] `localNoteQueryService.ts:145` — `listMonthsWithNotes` が所有者の全 active ノートを引き上げる
- [W-S08] `r2/objectStorage.ts:116` — `deleteMany` が 1,000 key 上限を確認しない
- [W-S09] `projection/snapshotWriter.ts:195` — `redactAuthor` が 0 行更新でも `true` を返し overlay を無条件に書く
- [W-S10] `spec/platform/index.md:154` — アダプターの実装内訳を予算文書に書いており ADR 056 の決定 3 に反する
- [W-S11] `spec/database/index.md:20` — scope 検証の縮小が canon に反映されず、`llm_usages` は ADR-024 の列挙にも無い
- [W-S12] `r2/objectStorage.ts:28` ほか — production の JSDoc が作業ファイル `.thread/11/adr.md` を参照（B-006 と同根）
- [W-S13] `cursor.ts:40` — ポートが言う "signed" になっていない

**合成・スキーマ・ハーネス・spec/docs**
- [W-C01] `__tests__/pendingPorts.ts` ほか 12 ファイル — `PENDING_PORTS` が空で機構が到達不能、コメントは偽情報＋作業指示が残存
- [W-C02] `d1/schema.ts` / `do/schema.ts` — `GLOBAL_MIGRATION_VERSION`/`SCOPE_MIGRATION_VERSION` が未参照の死に定数、かつ spec の不変条件を破ったまま守っていると書いている
- [W-C03] `d1/migrations/` — 未適用スキーマに対し `0003` が `0001` の索引を DROP して作り直し、`0002` は欠番
- [W-C04] `d1/schema.ts:51` — `GLOBAL_TABLES_IN_WIPE_ORDER` は手書き二重管理で漏れ検知テストが無い
- [W-C05] `di/cloudflareRuntime.ts:131` / `conformanceBackend.ts:294` — `DEFAULT_MAINTENANCE_TABLES` の 3 つ目のコピー
- [W-C06] `conformanceCoverage.test.ts` — 集合の相対比較のみで、スイート本体と呼び出しを同時に消すと緑のまま契約が 1 本消える
- [W-C07] `vitest.config.ts` / `vitest.workers.config.ts` — include の和集合が全体を覆っておらず `.test.ts` が漏れる窓がある。`CLOUDFLARE_ADAPTER_GLOB` は未使用 export
- [W-C08] `.github/workflows/ci.yml`（未変更） — workers 追加で実測 +107s、`timeout-minutes: 10` が逼迫
- [W-C09] `docs/test.md:39` — 「nothing is stubbed」が実態と食い違う
- [W-C10] `spec/platform/index.md:152` — 「往復」の語で契約文と実測が同じ節に並ぶ
