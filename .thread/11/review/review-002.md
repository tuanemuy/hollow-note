# PR Review #002 — [adapter] Cloudflare D1・Durable Objects・R2 アダプターを追加する

**PR:** #46
**Date:** 2026-08-26
**Round:** 2回目

## Summary

- Blockers: 9
- Warnings: 26
- Verdict: **BLOCKED**

## レイヤー別ファイル

- UoW / 実行機構・SQL 土台: review-002-uow.md（B: 1 / W: 7）
- Identity / directory / operation（D1 control plane）: review-002-identity.md（B: 3 / W: 5）
- Routing / outbox / scope インフラ: review-002-routing.md（B: 2 / W: 5）
- Scope business / 投影・全文検索 / R2: review-002-scope.md（B: 1 / W: 4）
- 合成・スキーマ・テストハーネス・spec/docs: review-002-composition.md（B: 2 / W: 5）

## カバレッジ

- 確認申告ゼロのファイル: なし（123 ファイルすべてに 1 体以上の「確認」申告あり）

## 指摘一覧

### Blockers

- [B-U01] `do/scopeObject.ts:applyWriteSet` — commit 済みの scope UoW が commit 後の alarm 再武装・due index publish の失敗で「失敗」として返る（`scopeTaskScheduler.write` は逆の方針で非対称）（uow）／routing W-001 と同一
- [B-I01] `d1/repositories/accountDeletionManifestStore.ts:acknowledgeReceipt` — receipts の JSON read-modify-write で並行 ack が 1 件消え、account deletion が恒久停止する（identity）
- [B-I02] `d1/repositories/identityUniqueDirectory.ts:activate` — guard も UPDATE も予約行の同一性を持たず、失効予約を奪った別 operation の行を active 化して鍵をリークさせる（identity）
- [B-I03] `domain/identity/ports/authTokenRepository.ts:findPendingByUserAndPurpose` — spec を「部分 UNIQUE を置かない」へ改訂したのにポート JSDoc が旧記述のまま（identity）／composition B-002 と同根
- [B-R01] `application/ports/scopeTaskScheduler.ts:153` + `do/repositories/scopeTaskScheduler.ts:201` — `claimDue` の競合時 `ConflictError` がポートのエラー契約に無く、`runDueScopeTasks` が捕まえないので tick 全体が落ちる（routing）
- [B-R02] `d1/migrations/0001_global_schema.sql:201-202` — `note_routes` の新設列 `migration_id` / `last_migration_id` が spec にも adr.md にも無い（routing）
- [B-S01] `projection/snapshotWriter.ts:replace` / `d1/publicNoteProjection.ts:replaceSnapshotIfNewer` — 世代ベクトルの条件付き書き込みになっておらず、並行度 4 の public consumer で lost update と contentless FTS 索引の破損が起きる（scope）
- [B-C01] `domain/note/ports/publicNoteQueryService.ts` — cursor の「署名付き」契約を JSDoc だけで撤回し、`spec/domains` / `database` / `platform` / `inventory` が旧い約束のまま（composition）／scope W-004 と同一
- [B-C02] `domain/identity/ports/authTokenRepository.ts` — spec・ポート JSDoc・適合スイート・memory / Cloudflare の観測が四者で割れている（composition）／identity B-003 と同根

### Warnings

**UoW / SQL 土台**
- [W-U01] `do/scopeObject.ts:alarm()` — turn の例外で `rescheduleAlarm` に到達せず、object が武装されないまま残る
- [W-U02] `execution/{scope,global}UnitOfWork.ts:post-commit kick` — kick が開いた UoW の ALS 文脈の内側で走り、トリガ実装がインラインで UoW を開くと nesting 判定で落ちる
- [W-U03] `sql/session.ts:readRows` — LIMIT ガードが staged 削除しか見ておらず、「述語から外れる staged 更新」で短いページが静かに返る
- [W-U04] `d1/repositories/globalMaintenanceRunStore.ts:761,782` — 生の NUL バイトが埋まっており `grep` がこのファイルを飛ばす（`sql/row.ts` の `compositeKey` が名指しで避けよと書いている）
- [W-U05] `d1/repositories/userBatchReader.ts:resolveMany` — `session.readRows` を直接叩きながら翻訳を持たない唯一のファイル
- [W-U06] `sql/session.ts:createAutocommitSession.write` — `MAX_STATEMENTS_PER_COMMIT` が autocommit の 1 batch に掛かっていない
- [W-U07] `do/schema.ts:9`, `sql/session.ts:ALL_ROWS` — 存在しない `applyScopeSchema` を名指し、`matches` が optional である前提の記述が残る

**Identity / directory**
- [W-I01] `accountDeletionManifestStore.ts:writeHeader` — 本束で唯一 guard 皆無の状態機械 store
- [W-I02] `0001_global_schema.sql:distributed_operations` — `request_key NOT NULL` / `terminal_at` が spec の列表に無く、未駆動の 3 列も説明が無い
- [W-I03] `0001_global_schema.sql:索引` — spec に無い索引 3 本、うち `sessions_user_token_idx` は `token_hash UNIQUE` と重複し `auth_tokens` と判断が割れている
- [W-I04] `globalMaintenanceRunStore.ts:beginOrResumeKind` — 新規作成分岐の guard 敗北時に存在しない run の ID を返す
- [W-I05] `identitySupport.ts` — 並列委譲という作業経緯と未実施の予定が JSDoc に残っている

**Routing / outbox / scope インフラ**
- [W-R01] `do/scopeObject.ts:85-99` — B-U01 と同一
- [W-R02] `do/alarm.ts:142-218` — claim 自体が CPU 予算を食い切ると 1 行も訪問せず全 release → 過去 `due_at` で即再武装、進捗ゼロのループ
- [W-R03] `do/alarm.ts:67-83,248-257` + `di/cloudflareRuntime.ts:409` — 「レジストリが writer を決める」が受け渡しになっていない（runner は無条件配線／登録しても既存行は武装されない）
- [W-R04] `__tests__/lease.test.ts:164-215` — per-row 排他の観測が autocommit 経路だけで、実配備が通る staged 経路は未観測
- [W-R05] `d1/repositories/outboxRepository.ts:241-252` — `pruneProcessed` が件数を数えるためだけに全削除行を `RETURNING` で materialize

**Scope business / 投影・検索 / R2**
- [W-S01] `projection/snapshotWriter.ts:ftsMutation` — bigram のバインド値が 2,000,000 バイト上限に無防備
- [W-S02] `__tests__/deleteFilesByOwner.test.ts` / `sql/json.ts` — 本 PR が spec から削除した「3 文の設計目標」を現行 canon として引くコメントが 3 か所、うち 1 つは経緯の弁明
- [W-S03] `__tests__/ports/scopeBusiness.ts` — JSDoc が本 PR の scope 検証の決着と矛盾
- [W-S04] `spec/database/index.md:115,978` / `spec/adr/021:41` — 「cursor は署名しない」決着が canon 3 か所に未反映（B-C01 と同根）

**合成・スキーマ・ハーネス・spec/docs**
- [W-C01] `__tests__/deleteFilesByOwner.test.ts` — AC-5 テストのコメントが本 PR 自身が削除した spec 本文を現在形で引用（W-S02 と同一）
- [W-C02] `vitest.workers.config.ts` / `vitest.shared.ts` — node は拡張子不問で exclude、workers は `.ts` のみ include のため「和集合が全体」が config として未保証
- [W-C03] `README.md` — adapters 台帳に `cloudflare/` が無く、`test:node` / `test:workers` も未掲載
- [W-C04] `spec/inventory/adapter.md` — `ScopeTaskScheduler` 他 4 ポートの ADP 行が 0 件
- [W-C05] `__tests__/runtimeComposition.test.ts` — テスト名の過大主張（網羅性は保証していない）
