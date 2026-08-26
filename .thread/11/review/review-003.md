# PR Review #003 — [adapter] Cloudflare D1・Durable Objects・R2 アダプターを追加する

**PR:** #46
**Date:** 2026-08-26
**Round:** 3回目

## Summary

- Blockers: 2
- Warnings: 19
- Verdict: **BLOCKED**

## レイヤー別ファイル

- UoW / 実行機構・SQL 土台: review-003-uow.md（B: 1 / W: 2）
- Identity / directory / operation（D1 control plane）: review-003-identity.md（B: 1 / W: 5）
- Routing / outbox / scope インフラ: review-003-routing.md（B: 0 / W: 3）
- Scope business / 投影・全文検索 / R2: review-003-scope.md（B: 0 / W: 4）
- 合成・スキーマ・テストハーネス・spec/docs: review-003-composition.md（B: 0 / W: 5）

## カバレッジ

- 確認申告ゼロのファイル: なし（159 ファイルすべてに 1 体以上の「確認」申告あり）

## 受け入れ基準の実測（composition が確認）

- AC-7: `adapters/memory` / `apps/web` の差分ゼロ。`pnpm test:node` 77 files / 981 passed（main の 76 / 978 に対し増分は新規テストのみ、脱落なし）
- AC-2 / AC-3: `pnpm test:workers` 22 files / 328 passed / skip ゼロ。30 スイート全件が実 D1 / DO / R2 に対して実行され、3 平面の名前空間分離を `harness.test.ts` が直接観測
- AC-9: migration 22 表と `do/schema.ts` 15 表がいずれも `spec/database/index.md` の物理配置表と 1 対 1
- `grep -rn "\.thread" packages apps spec docs README.md` は 0 件

## 指摘一覧

### Blockers

- [B-U01] `do/scopeObject.ts:armAndPublish` — due index の publish 失敗が「ハンドラレジストリ空」の既定配備で永久に治らない（alarm が常に削除されるため ADR-060 の「互いの保険」と canon の「Alarm が治す」が成立しない）（uow）／routing W-001 と同一
- [B-I01] `spec/usecases/identity.md` + `spec/domains/index.md` + `spec/testcases/identity/deleteAccount.md` — account deletion manifest header の状態語彙が canon 内で自己矛盾（`preparing` / `committing` / `compactingRejected` が残存。`spec/database/index.md` は 5 値へ改訂済み・実装も 5 値）（identity）

### Warnings

**UoW / SQL 土台**
- [W-U01] `sql/session.ts:readRows` — `compare` の並べ替えでページ外へ押し出された行をガードが見ておらず、中身の違うページが黙って返りうる（現行の呼び出し地点はすべて安全と確認済み）
- [W-U02] `__tests__/sessionOverlay.test.ts:112` — 「以前のガードはこれを通していた」という修正の経緯がテストコメントに残っている

**Identity / directory**
- [W-I01] `identityUniqueDirectory.ts:417:beginRelease` — guard 敗北が `OPTIMISTIC_LOCK_FAILURE`。ポート JSDoc は「一致しない行は no-op」と明示
- [W-I02] `identityUniqueDirectory.ts:147:activateLoss` — 同一 operation の並行リプレイに負けた場合も `OPTIMISTIC_LOCK_FAILURE`（読み経路の答えは成功）
- [W-I03] `distributedOperationStore.ts:180:beginOrResume` — `unique` 違反を一律 `ALREADY_RUNNING` に倒し、同一 request key のリプレイが `resumed: true` を受け取れない
- [W-I04] `sessionRepository.ts:57` — 削除済みの `(user_id, token_hash)` 索引を実在するものとして名指し
- [W-I05] `accountDeletionManifestStore.ts:238:writeHeader` — 追加した状態 guard に観測が無い

**Routing / outbox / scope インフラ**
- [W-R01] `do/scopeObject.ts:armAndPublish` + `do/dueIndex.ts` JSDoc + `spec/database/index.md:1089` — B-U01 と同一
- [W-R02] `application/workers/scopeTaskRunner.ts:claim catch` — `isConflictError` で全 `ConflictError` を握り潰し、ポートが唯一許した `OPTIMISTIC_LOCK_FAILURE` 以外も無言スキップする
- [W-R03] `d1/repositories/noteRouteFanOutReader.ts:page` — `state <> 'reserved'` + `ORDER BY note_id` が canon 索引 `(created_by, state, note_id)` で順序を取れず、1 page のコストが著者の route 総数に比例する

**Scope business / 投影・検索 / R2**
- [W-S01] `__tests__/searchEdges.test.ts:166-213` — bigram 索引テキストの打ち切りを観測するテストが無く、それを主張するコメントが算術的に誤っている（境界アサーションは `MAX_INDEX_TEXT_BYTES` を外しても通る）
- [W-S02] `spec/platform/index.md:### Scope DO` — `spec/adr/056` の「決定 3」を、その決定が述べていない主張の根拠として引用し、同 ADR の「決定 2」と食い違う。実測値 `4n + 3` は canon のどこにも残っていない
- [W-S03] `search/bigram.ts:119-133:bigramIndexText` — 予算がトークン粒度で、非 CJK の「トークン」は run 全体。NFKC 展開で 1 run が予算を越えるとその列の索引が空になり、spec「既知の限界」の「頭からは引ける」が成り立たない
- [W-S04] `d1/repositories/publicNoteQueryService.ts:133-140` — public 検索の並び順が `note_id` 昇順固定で spec の `updatedAt DESC` / FTS 順位 RRF と食い違う（本 PR の退行ではなく memory も同型だが、当該 spec 段落を書き換えた際に記録が残っていない）

**合成・スキーマ・ハーネス・spec/docs**
- [W-C01] `spec/adr/021:41` + `spec/adr/063:42` — ADR 021 の書き換えが ADR 063 の適用範囲を越え、063 の影響節を同一 PR が反証している
- [W-C02] `CLAUDE.md` — README・`docs/test.md` と同じ主張を持つ CLAUDE.md だけが「CF アダプターはこれから追加する」「vitest は 1 プロジェクト」のまま取り残されている
- [W-C03] `spec/database/index.md` — 新設した列表が、表自身にも migration にも無い制約を「制約」列に宣言（`note_routes.migration_id` は本文と矛盾、`scope_task_due_index.lease_expires_at` は存在しない `status` 列を参照）
- [W-C04] `do/schema.ts:249` vs `0001_global_schema.sql:404` — scope 平面の `outbox_events` にだけ processed 索引が無く、両平面で同一の `OutboxRepository.pruneProcessed` が将来全表走査になる
- [W-C05] `adapters/__tests__/conformanceCoverage.test.ts:80` — 呼び出し名の集合と絶対数（30/31）は固定するが**実引数を見ない**ので、CF スイートが memory ファクトリーを渡しても緑のまま通り AC-3 が静かに崩れる
