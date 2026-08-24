# PR Review #002 — fix(identity): 保守スイープの表順を run.tables に一本化する

**PR:** #45
**Date:** 2026-08-25
**Round:** 2回目

## Summary

- Blockers: 5
- Warnings: 12
- Verdict: **BLOCKED**

## レイヤー別ファイル

- Use Case / ポート契約: review-002-usecase.md（B: 1 / W: 3）
- Adapter / 適合スイート: review-002-adapter.md（B: 3 / W: 3）
- Spec canon: review-002-spec.md（B: 1 / W: 6）

## カバレッジ

- 確認申告ゼロのファイル: `.thread/16/review/review-001.md` / `review-001-usecase.md` / `review-001-adapter.md`
  - 追加レビュアーは立てない。前ラウンドのレビュー記録そのもので、Phase 7 で削除される中間成果物であり、コードの正しさに影響しない（3体とも「前ラウンドの記録」を理由にスキップ申告済み）

## 指摘一覧

- [B-001] `conformance/globalMaintenanceRunStore.ts + ports:asOf/契約の欠落・形骸化` — 返る lane の asOf が run 固定値であることが未拘束（usecase / adapter が同一問題を指摘）
- [B-002] `conformance/globalMaintenanceRunStore.ts:262-281 / 未拘束の契約節` — 次表へ進めた position の cursor が null であることが未拘束（adapter）
- [B-003] `conformance/globalMaintenanceRunStore.ts:237-260 / 未拘束の契約節` — 自動 claim が永続化済みの表を返すことが未拘束（adapter）
- [B-001] `spec/adr/061:22-23 / 契約2・3(b)` — ポート JSDoc の是正が ADR 側に反映されず記述が偽（spec）
- [W-001] `conformance/backend.ts:144 / 適合スイートの拘束力` — 契約1の実行形が任意フック依存（usecase / adapter 双方）
- [W-002] `pruneExpiredAuthState.ts:121 ↔ :265 / 記述の矛盾` — claimed 残存 lane の回収可否が併存（usecase）
- [W-003] `pruneExpiredAuthState.ts:119-122, terminalPrune.ts:68-71 / 契約記述と実態の乖離` — 継続 turn の引き渡しが実行不能（usecase）
- [W-002] `memory/__tests__/conformanceBackend.ts:158-163 / production 型への依存` — フックがレコード値の可変性に依存（adapter）
- [W-003] `ports/globalMaintenanceRunStore.ts:78-83 / 契約とスイートの幅ずれ` — 契約3(b) が自動 claim だけを名指す（adapter）
- [W-001] `spec/inventory/*.md:3 / 台帳ヘッダー` — 最終同期日が据え置き（spec）
- [W-002] `spec/adr/062:41 / 継続経路の記述` — 型が保証しないことを保証として記述（spec）
- [W-003] `spec/database/index.md:161 / 表を進める主体` — 同段落内で衝突（spec）
- [W-004] `.thread/16/testing.md:131-132,257 / 検証手順` — 移動済みの拘束と古い適合ケース数（spec）
- [W-005] `spec/adr/061:46-47 / 影響節` — 作業指示形が canon に残存（spec）
- [W-006] `spec/testcases/identity/pruneExpiredAuthState.md:34 ほか / テスト条件` — コード基準の条件定義（spec）
