# PR Review #001 — fix(identity): 保守スイープの表順を run.tables に一本化する

**PR:** #45
**Date:** 2026-08-25
**Round:** 1回目

## Summary

- Blockers: 4
- Warnings: 12
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Use Case / ポート契約: review-001-usecase.md（B: 1 / W: 3）
- Adapter / 適合スイート: review-001-adapter.md（B: 1 / W: 4）
- Spec canon: review-001-spec.md（B: 2 / W: 5）

## カバレッジ

- 確認申告ゼロのファイル: なし（usecase / spec とも 21/21 を確認申告）

## 指摘一覧

- [B-001] `pruneExpiredAuthState.test.ts:683 / test-coverage` — 未知表を failures に数えないことが観測されていない（usecase）
- [B-001] `adapters/conformance/globalMaintenanceRunStore.ts:292-301 / 適合スイート` — 自動 claim の lane の asOf 未検証で AC-8 未達（adapter）
- [B-001] `spec/usecases/identity.md:879 / 表名ベースの checkpoint` — 書き換えた当の文に旧記述が残る（spec）
- [B-002] `spec/usecases/job.md:551 / 変更されなかった spec の偽記述` — jobTombstonePrune 分岐が旧契約のまま（spec）
- [W-001] `ports/globalMaintenanceRunStore.ts:57 / port-contract` — 契約2の next: null 列挙に正常系が欠落（usecase）
- [W-002] `adapters/conformance/globalMaintenanceRunStore.ts:47 / port-contract` — 契約1に適合ケースが無い（usecase）
- [W-003] `pruneExpiredAuthState.ts:154 / contract-completeness` — 未知表 skip が runContinuation に無い（usecase）
- [W-001] `ports/globalMaintenanceRunStore.ts:48-52 / 契約の実行形` — 契約1の実行形が無い（adapter）
- [W-002] `ports/globalMaintenanceRunStore.ts:64-70 / 契約とスイートの両方向` — 契約3(a) の列挙不足と virgin lane 被覆の消失（adapter）
- [W-003] `ports/globalMaintenanceRunStore.ts:54-62 / 契約の網羅` — 契約2の null 列挙欠落と適合ケース 0 件（adapter）
- [W-004] `adapters/conformance/globalMaintenanceRunStore.ts:207-219 / 台帳対応` — 解放の実行形が 028 にあり 029 から辿れない（adapter）
- [W-001] `spec/platform/index.md:207 / 正典間の不整合` — checkpoint 内容に table が残る（spec）
- [W-002] `di/types.ts:200-205 / canon と JSDoc の乖離` — AuthStateTable の JSDoc が ADR 062 の残存条件と逆（spec）
- [W-003] `spec/testcases/identity/pruneExpiredAuthState.md:20 + spec/inventory/test.md:306 / 本文と写しの条件スコープ` — TC-identity-165 の条件が実装とずれる（spec）
- [W-004] `ports/globalMaintenanceRunStore.ts + pruneExpiredAuthState.ts / ADR 参照` — 昇格した 061/062 をコードから引いていない（spec）
- [W-005] `spec/usecases/identity.md:860,864 / 残債の追跡先` — 4種/4表表記と新表記の混在（spec）
