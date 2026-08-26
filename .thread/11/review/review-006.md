# PR Review #006 — [adapter] Cloudflare D1・Durable Objects・R2 アダプターを追加する

**PR:** #46
**Date:** 2026-08-26
**Round:** 6回目

## Summary

- Blockers: 0
- Warnings: 8
- Verdict: **APPROVED**（Blocker ゼロ）。完了判定は台帳の `fix` ゼロなので、Warning を仕分けて処理する

## レイヤー別ファイル

- UoW / 実行機構・SQL 土台: review-006-uow.md（B: 0 / W: 3）
- Identity / directory / operation（D1 control plane）: review-006-identity.md（B: 0 / W: 1）
- Routing / outbox / scope インフラ: review-006-routing.md（B: 0 / W: 2）
- Scope business / 投影・全文検索 / R2: review-006-scope.md（B: 0 / W: 0）
- 合成・スキーマ・テストハーネス・spec/docs: review-006-composition.md（B: 0 / W: 2）

## カバレッジ

- 確認申告ゼロのファイル: なし（181 ファイルすべてに 1 体以上の「確認」申告あり）

## 受け入れ基準の実測（composition が確認）

- AC-7: `git diff origin/main...HEAD -- packages/core/src/adapters/memory apps/web` は空
- `pnpm test:node` 77 files / 983 passed・3 skipped（memory 側の既知 skip）
- `pnpm test:workers` 22 files / 363 passed・skip 0
- typecheck / lint / format:check はエラー 0
- `grep -rn "\.thread" packages apps spec docs README.md` は 0 件

## 指摘一覧

### Blockers

なし

### Warnings

**UoW / SQL 土台**
- [W-U01] `do/scopeObject.ts:armAndPublishNow` — turn 出口の publish 失敗 → 再武装（唯一の非自然回復方向）が観測されていない
- [W-U02] `__tests__/unitOfWork.test.ts:391` — `_occ_guard` が行を残さない主張が `beforeEach` の wipe で無条件に通る
- [W-U03] `__tests__/alarm.test.ts:765` — `drops the alarm once nothing is scheduled` が一度も張らない alarm の `null` を確認しており、名前・経路とも現行設計とずれている

**Identity / directory**
- [W-I01] `spec/database/index.md:180,207` + `spec/usecases/identity.md:827` + `spec/testcases/identity/deleteAccount.md:70` vs `accountDeletionManifestStore.ts:768-780` / `0001_global_schema.sql:267` — `pruneTerminal` の keyset は `operation_id` 単独（`retain_until <= asOf` は絞り込み）だが、canon 4 か所は `(retainUntil, operationId)` の複合 keyset だと約束したまま。本 PR は identity 系の索引記述だけを新設の「有界な掃引 / 削除」規約へそろえ、`account_deletion_manifests` を取り残している

**Routing / outbox / scope インフラ**
- [W-R01] `d1/repositories/outboxRepository.ts:pruneProcessed` — scope 平面では `applyCounted` が無く実行不能なのに、canon が「plane を問わず撃つ」を根拠に scope 側の部分索引を正当化している
- [W-R02] `do/scopeObject.ts:leaseMs` — object 駆動 turn が `SCOPE_TASK_LEASE_MS` 定数を直読みしており、AC-6 の決着が配備に委ねた唯一のつまみを CF 側だけ回せない

**Scope business / 投影・検索 / R2**

なし（新規に立てた指摘 0 件）

**合成・スキーマ・ハーネス・spec/docs**
- [W-C01] `adapters/__tests__/conformanceCoverage.test.ts:84-108` — 適合ハーネスが `ConformanceBackend` の任意メンバー（`seedMembershipEdges`）を落としても、スイート名集合しか固定していないため 3 ケースが静かに skip されて緑のまま通る
- [W-C02] `.thread/11/testing.md:37` — 確認項目 1 の期待結果が、7 ファイルへ分割済みで存在しない `__tests__/conformance.test.ts` を名指ししている
